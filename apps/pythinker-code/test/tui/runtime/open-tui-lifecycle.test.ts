import { EventEmitter } from 'node:events';

import type { CliRendererConfig, ExternalOutputMode, ScreenMode } from '@opentui/core';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  OpenTuiLifecycle,
  type OpenTuiLifecycleRenderer,
  type OpenTuiRetainedSurface,
} from '#/tui/runtime/open-tui-lifecycle';
import { OpenTuiPresentation } from '../../../src/tui/runtime/open-tui-presentation';
import {
  createFooterState,
  reduceFooterState,
  selectFooterViewModel,
} from '../../../src/tui/runtime/footer/footer-model';

type OutputWrite = NodeJS.WriteStream['write'];

function outputStream(events: string[], name: string): NodeJS.WriteStream {
  const stream = {
    write: ((chunk: string | Uint8Array): boolean => {
      events.push(`${name}:${String(chunk)}`);
      return true;
    }) as OutputWrite,
  };
  return stream as unknown as NodeJS.WriteStream;
}

class FakeRenderer extends EventEmitter implements OpenTuiLifecycleRenderer {
  readonly width = 120;
  private outputMode: ExternalOutputMode = 'capture-stdout';
  private mode: ScreenMode = 'split-footer';
  footerHeight = 4;

  constructor(private readonly events: string[]) {
    super();
  }

  get externalOutputMode(): ExternalOutputMode {
    return this.outputMode;
  }

  set externalOutputMode(mode: ExternalOutputMode) {
    this.events.push(`renderer.output:${mode}`);
    this.outputMode = mode;
  }

  get screenMode(): ScreenMode {
    return this.mode;
  }

  set screenMode(mode: ScreenMode) {
    this.events.push(`renderer.screen:${mode}`);
    this.mode = mode;
  }

  requestRender(): void {
    this.events.push('renderer.render');
  }

  async idle(): Promise<void> {
    this.events.push('renderer.idle');
  }

  destroy(): void {
    this.events.push('renderer.destroy');
  }
}

function surface(events: string[], name: string): OpenTuiRetainedSurface {
  return {
    invalidate: () => {
      events.push(`${name}.invalidate`);
    },
    close: () => {
      events.push(`${name}.close`);
    },
  };
}

function makeLifecycle(
  events: string[] = [],
  overrides: Partial<ConstructorParameters<typeof OpenTuiLifecycle>[0]> = {},
): {
  lifecycle: OpenTuiLifecycle;
  renderer: FakeRenderer;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
} {
  const renderer = new FakeRenderer(events);
  const stdout = outputStream(events, 'stdout');
  const stderr = outputStream(events, 'stderr');
  const lifecycle = new OpenTuiLifecycle({
    stdin: {} as NodeJS.ReadStream,
    stdout,
    stderr,
    rendererFactory: async () => renderer,
    footerFactory: () => surface(events, 'footer'),
    ...overrides,
  });
  return { lifecycle, renderer, stdout, stderr };
}

describe('OpenTuiLifecycle', () => {
  it('creates the renderer with the exact split-footer runtime options', async () => {
    const configs: CliRendererConfig[] = [];
    const events: string[] = [];
    const renderer = new FakeRenderer(events);
    const stdout = outputStream(events, 'stdout');
    const stdin = {} as NodeJS.ReadStream;
    const lifecycle = new OpenTuiLifecycle({
      stdin,
      stdout,
      stderr: outputStream(events, 'stderr'),
      rendererFactory: async (config) => {
        configs.push(config);
        return renderer;
      },
      footerFactory: () => surface(events, 'footer'),
    });

    await lifecycle.start(() => {});

    expect(configs).toEqual([
      expect.objectContaining({
        stdin,
        stdout,
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
      }),
    ]);

    lifecycle.stop();
  });

  it('rolls back every acquired resource when partial start fails', async () => {
    const events: string[] = [];
    const renderer = new FakeRenderer(events);
    const stdout = outputStream(events, 'stdout');
    const stderr = outputStream(events, 'stderr');
    const lifecycle = new OpenTuiLifecycle({
      stdin: {} as NodeJS.ReadStream,
      stdout,
      stderr,
      rendererFactory: async () => renderer,
      footerFactory: () => {
        stdout.write('before failure');
        stderr.write('failure detail');
        throw new Error('footer failed');
      },
    });

    await expect(lifecycle.start(() => {})).rejects.toThrow('footer failed');

    expect(events).toEqual([
      'stdout:before failure',
      'stdout:failure detail',
      'renderer.output:passthrough',
      'renderer.screen:main-screen',
      'renderer.destroy',
    ]);
  });

  it('makes a second stop a no-op', async () => {
    const events: string[] = [];
    const { lifecycle } = makeLifecycle(events);
    await lifecycle.start(() => {});

    lifecycle.stop();
    lifecycle.stop();

    expect(events.filter((event) => event === 'renderer.destroy')).toHaveLength(1);
  });

  it('commits captured stdout and stderr in arrival order', async () => {
    const events: string[] = [];
    const { lifecycle, stdout, stderr } = makeLifecycle(events);
    await lifecycle.start(() => {});
    events.length = 0;

    stdout.write('one');
    stderr.write('two');
    stdout.write('three');
    expect(events).toEqual([]);

    lifecycle.commitCapturedOutput();

    expect(events).toEqual(['stdout:one', 'stdout:two', 'stdout:three']);
    lifecycle.stop();
  });

  it('uses the required six-step shutdown order', async () => {
    const events: string[] = [];
    const { lifecycle, stdout } = makeLifecycle(events);
    await lifecycle.start(() => {});
    lifecycle.setActiveSurface(surface(events, 'active'));
    events.length = 0;
    stdout.write('committed');

    lifecycle.stop();

    expect(events).toEqual([
      'active.close',
      'stdout:committed',
      'footer.close',
      'renderer.output:passthrough',
      'renderer.screen:main-screen',
      'renderer.destroy',
    ]);
  });
});

describe('OpenTuiPresentation', () => {
  it('updates the mutable renderer footer height from the shared footer model', async () => {
    const events: string[] = [];
    const renderer = new FakeRenderer(events);
    const presentation = new OpenTuiPresentation({
      stdin: {} as NodeJS.ReadStream,
      stdout: outputStream(events, 'stdout'),
      stderr: outputStream(events, 'stderr'),
      rendererFactory: async () => renderer,
      footerFactory: () => surface(events, 'footer'),
    });
    const compact = selectFooterViewModel(
      createFooterState(),
      0,
      DEFAULT_STATUS_LINE_CONFIG,
    );
    const active = selectFooterViewModel(
      reduceFooterState(createFooterState(), {
        type: 'activity.updated',
        activity: {
          phase: 'thinking',
          label: 'Thinking',
          spinnerActive: true,
          spinnerFrame: '⠋',
        },
      }),
      0,
      DEFAULT_STATUS_LINE_CONFIG,
    );

    presentation.start(() => {});
    await presentation.ready();
    events.length = 0;

    presentation.updateFooter(compact);
    expect(renderer.footerHeight).toBe(2);
    expect(events).toEqual(['footer.invalidate']);

    events.length = 0;
    presentation.updateFooter(active);
    expect(renderer.footerHeight).toBe(3);
    expect(events).toEqual(['footer.invalidate']);
    presentation.stop();
  });

  it('invalidates only the footer and active retained surface on resize', async () => {
    const events: string[] = [];
    const onResize = vi.fn();
    const renderer = new FakeRenderer(events);
    const presentation = new OpenTuiPresentation({
      stdin: {} as NodeJS.ReadStream,
      stdout: outputStream(events, 'stdout'),
      stderr: outputStream(events, 'stderr'),
      rendererFactory: async () => renderer,
      footerFactory: () => surface(events, 'footer'),
    });

    presentation.start(() => {
      onResize();
    });
    await presentation.ready();
    presentation.setActiveSurface(surface(events, 'active'));
    events.length = 0;

    renderer.emit('resize');

    expect(events).toEqual(['footer.invalidate', 'active.invalidate']);
    expect(onResize).toHaveBeenCalledOnce();
    presentation.stop();
  });

  it('keeps terminal writes ordered and composer state minimal', async () => {
    const events: string[] = [];
    const renderer = new FakeRenderer(events);
    const presentation = new OpenTuiPresentation({
      stdin: {} as NodeJS.ReadStream,
      stdout: outputStream(events, 'stdout'),
      stderr: outputStream(events, 'stderr'),
      rendererFactory: async () => renderer,
      footerFactory: () => surface(events, 'footer'),
    });

    presentation.start(() => {});
    await presentation.ready();
    events.length = 0;
    presentation.setTerminalTitle('Session');
    presentation.setTerminalProgress(true);
    presentation.writeTerminalControl('\u001B[?25h');
    presentation.setComposerText('draft');
    presentation.focusComposer();
    presentation.addComposerHistory('previous');
    presentation.notifyIdle();

    expect(presentation.getComposerText()).toBe('draft');
    expect(presentation.composerFocused).toBe(true);
    expect(presentation.composerHistory).toEqual(['previous']);
    expect(events).toEqual([
      'stdout:\u001B]0;Session\u0007',
      'stdout:\u001B]9;4;3\u0007',
      'stdout:\u001B[?25h',
      'renderer.render',
    ]);

    presentation.stop();
  });
});
