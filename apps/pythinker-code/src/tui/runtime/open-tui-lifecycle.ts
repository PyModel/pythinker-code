import {
  createCliRenderer,
  type CliRendererConfig,
  type ExternalOutputMode,
  type ScreenMode,
} from '@opentui/core';

type OutputWrite = NodeJS.WriteStream['write'];
type WriteCallback = (error?: Error | null) => void;

interface CapturedWrite {
  chunk: string | Uint8Array;
  encoding: BufferEncoding | undefined;
  callback: WriteCallback | undefined;
}

export interface OpenTuiLifecycleRenderer {
  readonly width: number;
  externalOutputMode: ExternalOutputMode;
  screenMode: ScreenMode;
  footerHeight: number;
  on(event: 'resize', listener: () => void): unknown;
  off(event: 'resize', listener: () => void): unknown;
  requestRender(): void;
  idle(): Promise<void>;
  destroy(): void;
}

export interface OpenTuiRetainedSurface {
  invalidate(): void;
  close(): void;
}

export type OpenTuiRendererFactory = (
  config: CliRendererConfig,
) => OpenTuiLifecycleRenderer | Promise<OpenTuiLifecycleRenderer>;

export interface OpenTuiLifecycleOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
  rendererFactory?: OpenTuiRendererFactory;
  footerFactory?: (
    renderer: OpenTuiLifecycleRenderer,
  ) => OpenTuiRetainedSurface | Promise<OpenTuiRetainedSurface>;
}

type LifecycleState = 'idle' | 'starting' | 'running' | 'stopped';

const OPEN_TUI_RENDERER_CONFIG = {
  screenMode: 'split-footer',
  footerHeight: 2,
  externalOutputMode: 'capture-stdout',
  targetFps: 30,
  maxFps: 60,
  useMouse: false,
  enableMouseMovement: false,
  exitOnCtrlC: false,
  exitSignals: [],
  consoleMode: 'disabled',
  openConsoleOnError: false,
  clearOnShutdown: false,
} as const satisfies CliRendererConfig;

function defaultFooter(renderer: OpenTuiLifecycleRenderer): OpenTuiRetainedSurface {
  return {
    invalidate: () => {
      renderer.requestRender();
    },
    close: () => {},
  };
}

export class OpenTuiLifecycle {
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly stderr: NodeJS.WriteStream;
  private readonly rendererFactory: OpenTuiRendererFactory;
  private readonly footerFactory: NonNullable<OpenTuiLifecycleOptions['footerFactory']>;

  private state: LifecycleState = 'idle';
  private stopRequested = false;
  private renderer: OpenTuiLifecycleRenderer | undefined;
  private footer: OpenTuiRetainedSurface | undefined;
  private activeSurface: OpenTuiRetainedSurface | undefined;
  private resizeHandler: (() => void) | undefined;
  private capturedWrites: CapturedWrite[] = [];
  private stdoutWrite: OutputWrite | undefined;
  private stderrWrite: OutputWrite | undefined;
  private outputCaptureInstalled = false;

  constructor(options: OpenTuiLifecycleOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.rendererFactory = options.rendererFactory ?? createCliRenderer;
    this.footerFactory = options.footerFactory ?? defaultFooter;
  }

  async start(onResize: () => void): Promise<void> {
    if (this.state === 'running') return;
    if (this.state !== 'idle') {
      throw new Error(`OpenTUI lifecycle cannot start from ${this.state} state.`);
    }

    this.state = 'starting';
    try {
      const renderer = await this.rendererFactory({
        ...OPEN_TUI_RENDERER_CONFIG,
        stdin: this.stdin,
        stdout: this.stdout,
      });
      this.renderer = renderer;

      if (this.stopRequested) {
        this.shutdown();
        return;
      }

      this.installOutputCapture();
      this.footer = await this.footerFactory(renderer);

      if (this.stopRequested) {
        this.shutdown();
        return;
      }

      this.resizeHandler = () => {
        this.footer?.invalidate();
        this.activeSurface?.invalidate();
        onResize();
      };
      renderer.on('resize', this.resizeHandler);
      this.state = 'running';
    } catch (error) {
      this.rollbackStart();
      throw error;
    }
  }

  stop(): void {
    if (this.state === 'starting') {
      this.stopRequested = true;
      return;
    }
    if (this.state !== 'running') return;
    this.shutdown();
  }

  setActiveSurface(surface: OpenTuiRetainedSurface | undefined): void {
    this.activeSurface = surface;
  }

  commitCapturedOutput(): void {
    const writes = this.capturedWrites;
    this.capturedWrites = [];
    for (const entry of writes) {
      this.flushWrite(entry);
    }
  }

  writeStdout(sequence: string): void {
    this.stdout.write(sequence);
    this.commitCapturedOutput();
  }

  writeStderr(sequence: string): void {
    this.stderr.write(sequence);
    this.commitCapturedOutput();
  }

  requestRender(): void {
    this.renderer?.requestRender();
  }

  setFooterHeight(height: number): void {
    const renderer = this.renderer;
    if (renderer === undefined) return;
    renderer.footerHeight = Math.max(0, Math.trunc(Number.isFinite(height) ? height : 0));
    this.footer?.invalidate();
  }

  async drainInput(): Promise<void> {
    await this.renderer?.idle();
  }

  private installOutputCapture(): void {
    if (this.outputCaptureInstalled) return;
    this.stdoutWrite = this.stdout.write.bind(this.stdout);
    this.stderrWrite = this.stderr.write.bind(this.stderr);
    this.stdout.write = this.captureWrite();
    this.stderr.write = this.captureWrite();
    this.outputCaptureInstalled = true;
  }

  private captureWrite(): OutputWrite {
    return ((
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ): boolean => {
      const encoding =
        typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
      const resolvedCallback =
        typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      this.capturedWrites.push({
        chunk,
        encoding,
        callback: resolvedCallback,
      });
      return true;
    }) as OutputWrite;
  }

  private flushWrite(entry: CapturedWrite): void {
    const write = this.stdoutWrite;
    if (write === undefined) return;
    if (entry.encoding !== undefined) {
      write(entry.chunk, entry.encoding, entry.callback);
      return;
    }
    if (entry.callback !== undefined) {
      write(entry.chunk, entry.callback);
      return;
    }
    write(entry.chunk);
  }

  private rollbackStart(): void {
    try {
      this.shutdown();
    } catch {
      // Preserve the startup error after attempting every restoration step.
    }
  }

  private shutdown(): void {
    if (this.state === 'stopped') return;
    this.state = 'stopped';

    const renderer = this.renderer;
    const errors: unknown[] = [];
    const attempt = (operation: () => void): void => {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    };

    const resizeHandler = this.resizeHandler;
    if (renderer !== undefined && resizeHandler !== undefined) {
      attempt(() => {
        renderer.off('resize', resizeHandler);
      });
    }
    this.resizeHandler = undefined;

    // The order below is the terminal restoration contract. Do not reorder it.
    attempt(() => {
      this.activeSurface?.close();
    });
    this.activeSurface = undefined;

    attempt(() => {
      this.commitCapturedOutput();
    });

    attempt(() => {
      this.footer?.close();
    });
    this.footer = undefined;

    attempt(() => {
      this.restoreOutputPassthrough();
    });
    attempt(() => {
      if (renderer !== undefined) renderer.externalOutputMode = 'passthrough';
    });

    attempt(() => {
      if (renderer !== undefined) {
        renderer.screenMode = 'main-screen';
      }
    });

    attempt(() => {
      renderer?.destroy();
    });
    this.renderer = undefined;

    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private restoreOutputPassthrough(): void {
    if (!this.outputCaptureInstalled) return;
    if (this.stdoutWrite !== undefined) {
      this.stdout.write = this.stdoutWrite;
    }
    if (this.stderrWrite !== undefined) {
      this.stderr.write = this.stderrWrite;
    }
    this.stdoutWrite = undefined;
    this.stderrWrite = undefined;
    this.outputCaptureInstalled = false;
  }
}
