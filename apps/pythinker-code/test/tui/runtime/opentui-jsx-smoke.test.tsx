/*
 * Proves the OpenTUI + Solid path actually executes, not merely typechecks.
 *
 * Everything else in `runtime/` is unit-tested through pure exports, so no test
 * had ever compiled the JSX or built a real renderer. Run with
 * `pnpm test:opentui`; without `--experimental-ffi` the native binding is
 * unavailable and this skips rather than failing for an unrelated reason.
 */

import type { BaseRenderable } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import { runOpenTuiProbe } from '../../../src/tui/runtime/open-tui-probe';
import { OpenTuiPresentation } from '../../../src/tui/runtime/open-tui-presentation';
import { PythinkerTUI } from '../../../src/tui/pythinker-tui';
import {
  createFooterState,
  foldFooterEvents,
  selectFooterViewModel,
  type FooterStatus,
} from '../../../src/tui/runtime/footer/footer-model';

const ffiEnabled =
  process.execArgv.some((arg) => arg.includes('experimental-ffi')) ||
  (process.env['NODE_OPTIONS'] ?? '').includes('experimental-ffi');

function descendants(root: BaseRenderable): readonly BaseRenderable[] {
  return root.getChildren().flatMap((child) => [child, ...descendants(child)]);
}

function inertOutput(): NodeJS.WriteStream {
  return {
    write: (() => true) as NodeJS.WriteStream['write'],
  } as unknown as NodeJS.WriteStream;
}

function makeStartupInput() {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      rewindFiles: undefined,
      yolo: false,
      auto: false,
      plan: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
    },
    tuiConfig: {
      theme: 'dark' as const,
      layout: 'inline' as const,
      copyFullResponse: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' as const },
      upgrade: { autoInstall: true },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
    },
    version: '0.0.0-test',
    workDir: '/tmp/proj-a',
  };
}

describe('OpenTUI JSX', () => {
  it.skipIf(!ffiEnabled)('renders solid JSX through a real renderer', async () => {
    await expect(runOpenTuiProbe()).resolves.toBeUndefined();
  }, 30_000);

  it.skipIf(!ffiEnabled)('renders danger status rows with the theme error red', async () => {
    const { RGBA, TextRenderable } = await import('@opentui/core');
    const { testRender } = await import('@opentui/solid');
    const { StatusRow } = await import('../../../src/tui/runtime/footer/status-row');
    const setup = await testRender(
      () => (
        <StatusRow
          model={{
            kind: 'status',
            items: ['yolo'],
            emphasis: 'danger',
            modelName: null,
          }}
          renderedText='  yolo'
        />
      ),
      { width: 20, height: 1 },
    );

    try {
      await setup.renderOnce();
      const yolo = descendants(setup.renderer.root).find(
        (node) => node instanceof TextRenderable && node.plainText.trim() === 'yolo',
      );

      expect(yolo).toBeDefined();
      expect(
        yolo instanceof TextRenderable &&
          yolo.fg.equals(RGBA.fromHex(currentTheme.palette.error)),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it.skipIf(!ffiEnabled)('renders the persistent status row with the faint theme color', async () => {
    const { RGBA, TextRenderable } = await import('@opentui/core');
    const { testRender } = await import('@opentui/solid');
    const { StatusRow } = await import('../../../src/tui/runtime/footer/status-row');
    const setup = await testRender(
      () => (
        <StatusRow
          model={{
            kind: 'status',
            items: ['DeepSeek V4 Flash'],
            modelName: 'DeepSeek V4 Flash',
          }}
          renderedText='  DeepSeek V4 Flash'
        />
      ),
      { width: 40, height: 1 },
    );

    try {
      await setup.renderOnce();
      const status = descendants(setup.renderer.root).find(
        (node) =>
          node instanceof TextRenderable &&
          node.plainText.trim() === 'DeepSeek V4 Flash',
      );

      expect(status).toBeDefined();
      expect(
        status instanceof TextRenderable &&
          status.fg.equals(RGBA.fromHex(currentTheme.palette.textDim)),
      ).toBe(true);
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it.skipIf(!ffiEnabled)('renders the default composer port in a real footer surface', async () => {
    const state = foldFooterEvents(createFooterState(), [
      {
        type: 'status.updated',
        changes: {
          model: 'DeepSeek V4 Flash',
          thinkingLevel: 'max',
          cwd: '/Users/example/work/pythinker-code',
          homeDir: '/Users/example',
          dynamicWorkflowMode: true,
          contextUsage: 0.05,
          git: {
            branch: 'main',
            dirty: false,
            ahead: 15,
            behind: 0,
            diffAdded: 0,
            diffDeleted: 0,
            pullRequest: null,
          },
          tokenSpeed: 75.7,
          tokenSpeedEstimated: false,
          elapsedMs: 252_000,
        } as Partial<FooterStatus>,
      },
    ]);
    const viewModel = selectFooterViewModel(
      state,
      300_000,
      DEFAULT_STATUS_LINE_CONFIG,
    );
    const setup = await createTestRenderer({
      width: 120,
      height: 6,
      screenMode: 'split-footer',
      footerHeight: 2,
      exitOnCtrlC: false,
      exitSignals: [],
      useMouse: false,
      useKittyKeyboard: null,
    });
    const presentation = new OpenTuiPresentation({
      stdin: {} as NodeJS.ReadStream,
      stdout: inertOutput(),
      stderr: inertOutput(),
      rendererFactory: async () => setup.renderer,
    });

    try {
      presentation.start(() => {});
      await presentation.ready();
      presentation.updateFooter(viewModel);
      await setup.flush();
      const emptyFrame = setup.captureCharFrame();

      expect(setup.renderer.footerHeight).toBe(2);
      expect(emptyFrame).toContain('❯ Type a message');
      expect(emptyFrame).toContain(
        'DeepSeek V4 Flash · max · 75.7 t/s    ▱▱▱▱▱▱▱▱ 5% · main ↑15 · workflow · elapsed 04:12',
      );
      expect(emptyFrame).not.toContain('/Users/example/work/pythinker-code');
      expect(emptyFrame).not.toContain('shift+tab: plan mode');

      presentation.setComposerText('restore this draft');
      await setup.flush();
      const draftFrame = setup.captureCharFrame();

      expect(draftFrame).toContain('❯ restore this draft');
      expect(draftFrame).not.toContain('❯ Type a message');
    } finally {
      presentation.stop();
      if (!setup.renderer.isDestroyed) setup.renderer.destroy();
    }
  }, 30_000);

  it.skipIf(!ffiEnabled)('receives live non-workflow activity through the presentation seam', async () => {
    const setup = await createTestRenderer({
      width: 120,
      height: 6,
      screenMode: 'split-footer',
      footerHeight: 2,
      exitOnCtrlC: false,
      exitSignals: [],
      useMouse: false,
      useKittyKeyboard: null,
    });
    const presentation = new OpenTuiPresentation({
      stdin: {} as NodeJS.ReadStream,
      stdout: inertOutput(),
      stderr: inertOutput(),
      rendererFactory: async () => setup.renderer,
    });
    const tui = new PythinkerTUI(
      {} as never,
      makeStartupInput(),
      presentation,
    );

    try {
      presentation.start(() => {});
      await presentation.ready();
      tui.patchLivePane({ mode: 'waiting' });
      await setup.flush();

      const activeFrame = setup.captureCharFrame();
      expect(setup.renderer.footerHeight).toBe(3);
      expect(activeFrame).toContain('⠋ Waiting…');
      expect(activeFrame).toContain('❯ Type a message');
      expect(activeFrame).toContain('▱▱▱▱▱▱▱▱ 0%');

      tui.resetLivePane();
      await setup.flush();

      const idleFrame = setup.captureCharFrame();
      expect(setup.renderer.footerHeight).toBe(2);
      expect(idleFrame).not.toContain('Waiting…');
      expect(idleFrame).toContain('❯ Type a message');
      expect(idleFrame).toContain('▱▱▱▱▱▱▱▱ 0%');
    } finally {
      tui.resetLivePane();
      tui.state.footer.dispose();
      presentation.stop();
      if (!setup.renderer.isDestroyed) setup.renderer.destroy();
    }
  }, 30_000);
});
