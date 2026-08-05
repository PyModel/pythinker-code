import type { CliRenderer } from '@opentui/core';
import { _render, RendererContext } from '@opentui/solid';
import { createSignal, type Accessor, type Setter } from 'solid-js';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  createFooterState,
  selectFooterViewModel,
  type FooterViewModel,
} from './footer/footer-model';
import { OpenTuiComposerPort } from './footer/open-tui-composer-port';
import { SplitFooterView } from './footer/split-footer-view';
import type {
  OpenTuiLifecycleOptions,
  OpenTuiLifecycleRenderer,
  OpenTuiRetainedSurface,
} from './open-tui-lifecycle';
import { OpenTuiLifecycle } from './open-tui-lifecycle';
import type { TuiPresentation } from './contracts';

const TERMINAL_PROGRESS_ACTIVE = '\u001B]9;4;3\u0007';
const TERMINAL_PROGRESS_CLEAR = '\u001B]9;4;0;\u0007';

export class OpenTuiPresentation implements TuiPresentation {
  readonly composerHistory: string[] = [];
  composerFocused = false;

  private readonly lifecycle: OpenTuiLifecycle;
  private readonly composerPort = new OpenTuiComposerPort();
  private readonly composerRevision: Accessor<number>;
  private readonly setComposerRevision: Setter<number>;
  private readonly footerViewModel: Accessor<FooterViewModel>;
  private readonly setFooterViewModel: Setter<FooterViewModel>;
  private startPromise: Promise<void> = Promise.resolve();

  constructor(options: OpenTuiLifecycleOptions = {}) {
    const [composerRevision, setComposerRevision] = createSignal(0);
    const [footerViewModel, setFooterViewModel] = createSignal(
      selectFooterViewModel(
        createFooterState(),
        Date.now(),
        DEFAULT_STATUS_LINE_CONFIG,
      ),
    );
    this.composerRevision = composerRevision;
    this.setComposerRevision = setComposerRevision;
    this.footerViewModel = footerViewModel;
    this.setFooterViewModel = setFooterViewModel;
    const { footerFactory, ...lifecycleOptions } = options;
    this.lifecycle = new OpenTuiLifecycle({
      ...lifecycleOptions,
      footerFactory: footerFactory ?? ((renderer) => this.createFooterSurface(renderer)),
    });
  }

  start(onResize: () => void): void {
    this.startPromise = this.lifecycle.start(onResize);
    void this.startPromise.catch(() => {
      // The synchronous presentation seam cannot surface async renderer setup.
      // Callers that need startup status use ready().
    });
  }

  ready(): Promise<void> {
    return this.startPromise;
  }

  stop(): void {
    this.lifecycle.stop();
  }

  drainInput(): Promise<void> {
    return this.lifecycle.drainInput();
  }

  setTerminalTitle(title: string): void {
    this.lifecycle.writeStdout(`\u001B]0;${title}\u0007`);
  }

  setTerminalProgress(active: boolean): void {
    this.lifecycle.writeStdout(active ? TERMINAL_PROGRESS_ACTIVE : TERMINAL_PROGRESS_CLEAR);
  }

  writeTerminalControl(sequence: string): void {
    this.lifecycle.writeStdout(sequence);
  }

  getComposerText(): string {
    return this.composerPort.getText();
  }

  setComposerText(text: string): void {
    this.composerPort.setText(text);
    this.invalidateComposer();
  }

  focusComposer(): void {
    this.composerFocused = true;
    this.composerPort.focus();
    this.invalidateComposer();
  }

  addComposerHistory(text: string): void {
    this.composerHistory.push(text);
    this.composerPort.addToHistory(text);
    this.invalidateComposer();
  }

  updateFooter(viewModel: FooterViewModel): void {
    this.setFooterViewModel(() => viewModel);
    this.lifecycle.setFooterHeight(viewModel.rows.length);
  }

  notifyIdle(): void {
    this.lifecycle.requestRender();
  }

  setActiveSurface(surface: OpenTuiRetainedSurface | undefined): void {
    this.lifecycle.setActiveSurface(surface);
  }

  private createFooterSurface(renderer: OpenTuiLifecycleRenderer): OpenTuiRetainedSurface {
    const solidRenderer = renderer as unknown as CliRenderer;
    const [width, setWidth] = createSignal(renderer.width);
    let closed = false;
    const dispose = _render(
      () => (
        <RendererContext.Provider value={solidRenderer}>
          <SplitFooterView
            composerPort={this.composerPort}
            composerRevision={this.composerRevision}
            viewModel={this.footerViewModel()}
            width={width()}
          />
        </RendererContext.Provider>
      ),
      solidRenderer.root,
    );
    const invalidate = (): void => {
      if (closed) return;
      setWidth(renderer.width);
      renderer.footerHeight = this.footerViewModel().rows.length;
      renderer.requestRender();
    };

    invalidate();
    return {
      invalidate,
      close: () => {
        if (closed) return;
        closed = true;
        dispose();
      },
    };
  }

  private invalidateComposer(): void {
    this.setComposerRevision((revision) => revision + 1);
  }
}
