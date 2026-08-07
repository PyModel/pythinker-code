import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import {
  applyCopyPreferenceChoice,
  applyPrivacyPreferenceChoice,
  applyUpdatePreferenceChoice,
  handleOutputStyleCommand,
  handlePermissionsCommand,
} from '#/tui/commands/config';
import { handleUpdateCommand } from '#/tui/commands/info';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { darkColors } from '#/tui/theme/colors';

const mocks = vi.hoisted(() => ({
  disableTelemetry: vi.fn(),
  saveTuiConfig: vi.fn(),
  startManualUpdate: vi.fn(),
}));

vi.mock('@pythoughts/pythinker-telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pythoughts/pythinker-telemetry')>()),
  disableTelemetry: mocks.disableTelemetry,
}));

vi.mock('../../../src/tui/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/tui/config.js')>(
    '../../../src/tui/config.js',
  );
  return {
    ...actual,
    saveTuiConfig: mocks.saveTuiConfig,
  };
});

vi.mock('../../../src/cli/update/preflight', async (importOriginal) => {
  const actual = await vi.importActual<typeof import('../../../src/cli/update/preflight.js')>(
    '../../../src/cli/update/preflight.js',
  );
  return {
    ...actual,
    startManualUpdate: mocks.startManualUpdate,
  };
});

describe('update preference commands', () => {
  it('persists telemetry opt-out and stops collection immediately', async () => {
    const host = {
      harness: {
        setConfig: vi.fn(async () => ({ providers: {}, telemetry: false })),
      },
      showError: vi.fn(),
      showNotice: vi.fn(),
      track: vi.fn(),
    } as unknown as SlashCommandHost;

    await applyPrivacyPreferenceChoice(host, false);

    expect(host.harness.setConfig).toHaveBeenCalledWith({ telemetry: false });
    expect(mocks.disableTelemetry).toHaveBeenCalledOnce();
    expect(host.showNotice).toHaveBeenCalledWith(
      'Telemetry disabled',
      'Applied immediately and saved for future launches.',
    );
  });

  it('saves automatic update preference changes to tui.toml', async () => {
    const setAppState = vi.fn();
    const showStatus = vi.fn();
    const track = vi.fn();
    const host = {
      state: {
        copyFullResponse: false,
        layout: 'inline' as const,
        appState: {
          theme: 'auto' as const,
          editorCommand: null,
          notifications: { enabled: true, condition: 'unfocused' as const },
          upgrade: { autoInstall: true },
          statusLine: DEFAULT_STATUS_LINE_CONFIG,
        },
        theme: { palette: darkColors },
      },
      setAppState,
      showStatus,
      track,
    };

    await applyUpdatePreferenceChoice(host, false);

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith({
      theme: 'auto',
      layout: 'inline',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: false },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
      copyFullResponse: false,
    });
    expect(setAppState).toHaveBeenCalledWith({ upgrade: { autoInstall: false } });
    expect(track).toHaveBeenCalledWith('upgrade_preference_changed', { auto_install: false });
    expect(showStatus).toHaveBeenCalledWith('Automatic updates disabled.');
  });

  it('saves the full-response copy preference to tui.toml', async () => {
    const showStatus = vi.fn();
    const host = {
      state: {
        copyFullResponse: false,
        layout: 'inline' as const,
        appState: {
          theme: 'auto' as const,
          editorCommand: null,
          notifications: { enabled: true, condition: 'unfocused' as const },
          upgrade: { autoInstall: true },
          statusLine: DEFAULT_STATUS_LINE_CONFIG,
        },
      },
      showStatus,
    };

    await applyCopyPreferenceChoice(host, true);

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith({
      theme: 'auto',
      layout: 'inline',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
      copyFullResponse: true,
    });
    expect(host.state.copyFullResponse).toBe(true);
    expect(showStatus).toHaveBeenCalledWith('Full-response copying enabled.');
  });
});

describe('output style commands', () => {
  function makeHost() {
    const catalog = {
      active: 'Explanatory',
      styles: [
        {
          name: 'default',
          description: 'Use the standard Pythinker response style.',
          source: 'built-in' as const,
          active: false,
        },
        {
          name: 'Explanatory',
          description: 'Explain implementation choices and codebase patterns.',
          source: 'built-in' as const,
          active: true,
        },
      ],
    };
    const host = {
      state: { appState: { workDir: '/workspace' } },
      harness: {
        listOutputStyles: vi.fn(async () => catalog),
        setConfig: vi.fn(async () => ({ providers: {} })),
      },
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      showError: vi.fn(),
      showNotice: vi.fn(),
    } as unknown as SlashCommandHost & {
      harness: {
        listOutputStyles: ReturnType<typeof vi.fn>;
        setConfig: ReturnType<typeof vi.fn>;
      };
      mountEditorReplacement: ReturnType<typeof vi.fn>;
      restoreEditor: ReturnType<typeof vi.fn>;
      showError: ReturnType<typeof vi.fn>;
      showNotice: ReturnType<typeof vi.fn>;
    };
    return { catalog, host };
  }

  it('persists a named style for new sessions', async () => {
    const { host } = makeHost();

    await handleOutputStyleCommand(host, 'default');

    expect(host.harness.listOutputStyles).toHaveBeenCalledWith('/workspace');
    expect(host.harness.setConfig).toHaveBeenCalledWith({ outputStyle: 'default' });
    expect(host.showNotice).toHaveBeenCalledWith(
      'Output style saved: default',
      'Applies to new sessions.',
    );
  });

  it('rejects unknown styles without writing config', async () => {
    const { host } = makeHost();

    await handleOutputStyleCommand(host, 'missing');

    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('Unknown output style: missing');
  });

  it('opens the shared searchable picker when no name is provided', async () => {
    const { host } = makeHost();

    await handleOutputStyleCommand(host, '');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      render(width: number): string[];
    };
    expect(picker.render(120).join('\n')).toContain('Select output style');
    expect(picker.render(120).join('\n')).toContain('Explanatory');
  });

  it('reports when a plugin-forced style still takes precedence', async () => {
    const { host } = makeHost();
    host.harness.listOutputStyles.mockResolvedValueOnce({
      active: 'example:Strict',
      styles: [
        {
          name: 'default',
          description: 'Use the standard Pythinker response style.',
          source: 'built-in',
          active: false,
        },
        {
          name: 'example:Strict',
          description: 'Use the plugin response contract.',
          source: 'plugin',
          active: true,
          forced: true,
        },
      ],
    });

    await handleOutputStyleCommand(host, 'default');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Output style saved: default',
      'example:Strict remains active while its plugin forces that style.',
    );
  });
});

describe('update command', () => {
  function makeHost() {
    const host = {
      state: { appState: { version: '0.9.0' } },
      showStatus: vi.fn(),
      showNotice: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost & {
      showStatus: ReturnType<typeof vi.fn>;
      showNotice: ReturnType<typeof vi.fn>;
      showError: ReturnType<typeof vi.fn>;
    };
    return host;
  }

  it('keeps the existing wording for an in-progress update of the same version', async () => {
    const host = makeHost();
    mocks.startManualUpdate.mockResolvedValue({
      status: 'in-progress',
      installingVersion: '0.10.0',
      installOnRestart: false,
      readyToInstall: false,
    });

    await handleUpdateCommand(host, '');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Update to v0.10.0 already in progress',
      'Close this terminal and open a new one once it completes.',
    );
  });

  it('keeps the homebrew ready-to-install wording for a same-version in-progress update', async () => {
    const host = makeHost();
    mocks.startManualUpdate.mockResolvedValue({
      status: 'in-progress',
      installingVersion: '0.10.0',
      installOnRestart: true,
      readyToInstall: true,
    });

    await handleUpdateCommand(host, '');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Update to v0.10.0 already in progress',
      'Close this terminal and open a new one to install it.',
    );
  });

  it('announces the newer target when the running install is for an older version', async () => {
    const host = makeHost();
    mocks.startManualUpdate.mockResolvedValue({
      status: 'in-progress',
      installingVersion: '0.10.0',
      targetVersion: '0.11.0',
      installOnRestart: false,
      readyToInstall: false,
    });

    await handleUpdateCommand(host, '');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Installing v0.10.0 — v0.11.0 will follow',
      'The running install of v0.10.0 finishes first; v0.11.0 installs after the next start.',
    );
  });
});

describe('permission rule commands', () => {
  function makeHost() {
    const session = {
      reloadSession: vi.fn(async () => ({})),
      listWorkspaceDirectories: vi.fn(async () => [
        { path: '/tmp/extra', source: 'user' as const },
      ]),
      removeWorkspaceDirectory: vi.fn(async () => {}),
    };
    const harness = {
      getConfig: vi.fn(async () => ({
        providers: {},
        permission: {
          rules: [
            {
              decision: 'deny' as const,
              scope: 'user' as const,
              pattern: 'Bash(rm *)',
            },
          ],
        },
        additionalDirs: ['/tmp/extra'],
      })),
      setConfig: vi.fn(async (patch) => ({ providers: {}, ...patch })),
    };
    const host = {
      state: { appState: {} },
      session,
      harness,
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      reloadCurrentSessionView: vi.fn(async () => {}),
      showError: vi.fn(),
      showNotice: vi.fn(),
    } as unknown as SlashCommandHost & {
      session: typeof session;
      harness: typeof harness;
      mountEditorReplacement: ReturnType<typeof vi.fn>;
      restoreEditor: ReturnType<typeof vi.fn>;
      reloadCurrentSessionView: ReturnType<typeof vi.fn>;
      showError: ReturnType<typeof vi.fn>;
      showNotice: ReturnType<typeof vi.fn>;
    };
    return host;
  }

  it('opens the native rule manager with add actions and current rules', async () => {
    const host = makeHost();

    await handlePermissionsCommand(host, '');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      render(width: number): string[];
    };
    const rendered = picker.render(120).join('\n');
    expect(rendered).toContain('Manage permission rules');
    expect(rendered).toContain('Add allow rule');
    expect(rendered).toContain('deny · Bash(rm *)');
    expect(rendered).toContain('Add working directory');
    expect(rendered).toContain('/tmp/extra');
  });

  it('adds a validated user rule and reloads the active session', async () => {
    const host = makeHost();

    await handlePermissionsCommand(host, '');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('\r');

    const input = host.mountEditorReplacement.mock.calls[1]?.[0] as {
      handleInput(data: string): void;
    };
    for (const character of 'Bash(git *)') input.handleInput(character);
    input.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.harness.setConfig).toHaveBeenCalledOnce();
    });

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      permission: {
        rules: [
          { decision: 'deny', scope: 'user', pattern: 'Bash(rm *)' },
          { decision: 'allow', scope: 'user', pattern: 'Bash(git *)' },
        ],
      },
    });
    expect(host.session.reloadSession).toHaveBeenCalledOnce();
    expect(host.reloadCurrentSessionView).toHaveBeenCalledWith(
      host.session,
      'Added allow rule Bash(git *).',
    );
  });

  it('deletes a selected rule after confirmation', async () => {
    const host = makeHost();

    await handlePermissionsCommand(host, '');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('\u001B[B');
    picker.handleInput('\u001B[B');
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    const confirmation = host.mountEditorReplacement.mock.calls[1]?.[0] as {
      handleInput(data: string): void;
    };
    confirmation.handleInput('\u001B[A');
    confirmation.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.harness.setConfig).toHaveBeenCalledOnce();
    });

    expect(host.harness.setConfig).toHaveBeenCalledWith({
      permission: { rules: [] },
    });
    expect(host.reloadCurrentSessionView).toHaveBeenCalledWith(
      host.session,
      'Deleted deny rule Bash(rm *).',
    );
  });

  it('removes a saved working directory from the active session and config', async () => {
    const host = makeHost();
    host.state.appState.workDir = '/workspace';

    await handlePermissionsCommand(host, '');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    for (let index = 0; index < 5; index++) picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    const confirmation = host.mountEditorReplacement.mock.calls[1]?.[0] as {
      handleInput(data: string): void;
    };
    confirmation.handleInput('\u001B[A');
    confirmation.handleInput('\r');
    await vi.waitFor(() => {
      expect(host.session.removeWorkspaceDirectory).toHaveBeenCalledWith('/tmp/extra');
      expect(host.harness.setConfig).toHaveBeenCalledWith({ additionalDirs: [] });
    });

    expect(host.showNotice).toHaveBeenCalledWith(
      'Removed working directory /tmp/extra from user settings.',
    );
  });

  it('rejects command arguments without opening the manager', async () => {
    const host = makeHost();

    await handlePermissionsCommand(host, 'allow Bash');

    expect(host.showError).toHaveBeenCalledWith('Usage: /permissions');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
  });
});
