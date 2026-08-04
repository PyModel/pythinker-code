import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPythinkerHarness } from '@pythoughts/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isExperimentalFlagEnabled,
  onExperimentalFeaturesChanged,
  setExperimentalFeatureForRun,
  setExperimentalFeatures,
} from '#/tui/commands/experimental-flags';
import { handleVimCommand, type SlashCommandHost } from '#/tui/commands/index';

afterEach(() => {
  setExperimentalFeatures([]);
  vi.unstubAllEnvs();
});

describe('experimental feature snapshot', () => {
  it('loads vim mode as disabled by default through the harness', async () => {
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_FLAG', '0');
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_VIM_MODE', '');
    const homeDir = await mkdtemp(join(tmpdir(), 'pythinker-vim-mode-'));
    const harness = createPythinkerHarness({ homeDir });

    try {
      const features = await harness.getExperimentalFeatures();

      expect(features.find((feature) => feature.id === 'vim_mode')).toMatchObject({
        id: 'vim_mode',
        surface: 'tui',
        env: 'PYTHINKER_CODE_EXPERIMENTAL_VIM_MODE',
        defaultEnabled: false,
        enabled: false,
        source: 'default',
      });
    } finally {
      await harness.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('notifies listeners after replacing the snapshot', () => {
    setExperimentalFeatures([{ id: 'vim_mode', enabled: false }]);
    let observedEnabled = false;
    onExperimentalFeaturesChanged(() => {
      observedEnabled = isExperimentalFlagEnabled('vim_mode');
    });

    setExperimentalFeatures([{ id: 'vim_mode', enabled: true }]);

    expect(observedEnabled).toBe(true);
  });

  it('overrides one feature for the current run without dropping other flags', () => {
    setExperimentalFeatures([
      { id: 'vim_mode', enabled: false },
      { id: 'lsp', enabled: true },
    ]);

    setExperimentalFeatureForRun('vim_mode', true);

    expect(isExperimentalFlagEnabled('vim_mode')).toBe(true);
    expect(isExperimentalFlagEnabled('lsp')).toBe(true);
  });

  it('resets Vim mode after the CLI harness restarts', async () => {
    setExperimentalFeatures([{ id: 'vim_mode', enabled: false }]);
    const homeDir = await mkdtemp(join(tmpdir(), 'pythinker-vim-session-'));
    const harness = createPythinkerHarness({ homeDir });
    const host = {
      harness,
      state: {
        editor: {
          isVimModeEnabled: () => false,
          setVimMode: vi.fn(),
        },
        ui: { requestRender: vi.fn() },
      },
      showStatus: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    try {
      await handleVimCommand(host);
      expect(host.state.editor.setVimMode).toHaveBeenCalledWith(true);
    } finally {
      await harness.close();
    }

    const restartedHarness = createPythinkerHarness({ homeDir });
    try {
      const features = await restartedHarness.getExperimentalFeatures();
      expect(features.find((feature) => feature.id === 'vim_mode')?.enabled).toBe(false);
    } finally {
      await restartedHarness.close();
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('enables Vim for the current run without persisting it', async () => {
    setExperimentalFeatures([{ id: 'vim_mode', enabled: false }]);
    const setVimMode = vi.fn();
    const requestRender = vi.fn();
    const host = {
      harness: {
        setConfig: vi.fn(async () => ({})),
        getExperimentalFeatures: vi.fn(async () => []),
      },
      state: {
        editor: {
          isVimModeEnabled: () => false,
          setVimMode,
        },
        ui: { requestRender },
      },
      showStatus: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleVimCommand(host);

    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.harness.getExperimentalFeatures).not.toHaveBeenCalled();
    expect(isExperimentalFlagEnabled('vim_mode')).toBe(true);
    expect(setVimMode).toHaveBeenCalledWith(true);
    expect(requestRender).toHaveBeenCalledOnce();
    expect(host.showStatus).toHaveBeenCalledWith(
      'Editor mode set to vim (NORMAL) for this run. Press i to enter INSERT mode.',
      'success',
    );
  });

  it('clears a legacy persisted Vim setting when disabling it', async () => {
    setExperimentalFeatures([{ id: 'vim_mode', enabled: true }]);
    const setVimMode = vi.fn();
    const host = {
      harness: {
        setConfig: vi.fn(async () => ({})),
        getExperimentalFeatures: vi.fn(async () => [
          { id: 'vim_mode', enabled: false },
        ]),
      },
      state: {
        editor: {
          isVimModeEnabled: () => true,
          setVimMode,
        },
        ui: { requestRender: vi.fn() },
      },
      showStatus: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleVimCommand(host);

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      experimental: { vim_mode: false },
    });
    expect(isExperimentalFlagEnabled('vim_mode')).toBe(false);
    expect(setVimMode).toHaveBeenLastCalledWith(false);
    expect(host.showStatus).toHaveBeenCalledWith(
      'Editor mode set to normal.',
      'success',
    );
  });
});
