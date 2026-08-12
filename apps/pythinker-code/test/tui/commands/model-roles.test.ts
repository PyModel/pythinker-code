import { describe, expect, it, vi } from 'vitest';

import { handleModelCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

const ENTER = '\r';

interface TestPicker {
  handleInput(data: string): void;
}

function model(name: string) {
  return {
    provider: 'test',
    model: name,
    maxContextSize: 200_000,
    displayName: name,
    capabilities: [],
  };
}

function makeHost(options: {
  currentModel?: string;
  availableModels?: Record<string, ReturnType<typeof model>>;
  modelRoles?: Record<string, string>;
  setConfig?: ReturnType<typeof vi.fn>;
} = {}) {
  const session = {
    setModel: vi.fn(async () => {}),
    setThinking: vi.fn(async () => {}),
  };
  const getConfig = vi.fn(async () => ({
    providers: {},
    modelRoles: options.modelRoles,
  }));
  const setConfig = options.setConfig ?? vi.fn(async () => {});
  const host = {
    state: {
      appState: {
        model: options.currentModel ?? 'worker',
        thinkingLevel: 'off',
        streamingPhase: 'idle',
        availableModels: options.availableModels ?? { worker: model('worker') },
      },
      editorContainer: { children: [] },
    },
    session,
    harness: { getConfig, setConfig },
    authFlow: {
      refreshProviderModels: vi.fn(async () => ({ failed: [] })),
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session, setConfig };
}

function mountedPicker(host: SlashCommandHost): TestPicker {
  const mount = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  return mount.mock.calls[0]?.[0] as TestPicker;
}

describe('/model roles', () => {
  it('lists every built-in role as not set when no assignments exist', async () => {
    const { host } = makeHost();

    await handleModelCommand(host, 'roles');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Model roles',
      'small: (not set)\nimplementer: (not set)\nadvisor: (not set)',
    );
  });

  it('locks a selected alias to a role without switching the session model', async () => {
    const { host, session, setConfig } = makeHost();

    await handleModelCommand(host, 'small');
    expect(host.authFlow.refreshProviderModels).toHaveBeenCalledOnce();
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(setConfig).toHaveBeenCalledWith({ modelRoles: { small: 'worker' } });
    });
    expect(session.setModel).not.toHaveBeenCalled();
  });

  it('reports a role persistence failure without showing success', async () => {
    const setConfig = vi.fn(async () => {
      throw new Error('disk full');
    });
    const { host } = makeHost({ setConfig });

    await handleModelCommand(host, 'small');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });
    expect(host.showStatus).not.toHaveBeenCalled();
  });

  it('clears a role with an empty-string tombstone', async () => {
    const { host, setConfig } = makeHost({ modelRoles: { small: 'worker' } });

    await handleModelCommand(host, 'small clear');

    expect(setConfig).toHaveBeenCalledWith({ modelRoles: { small: '' } });
  });

  it('keeps an existing model alias on the default switch path', async () => {
    const { host, session } = makeHost({
      currentModel: 'parent',
      availableModels: {
        parent: model('parent'),
        worker: model('worker'),
      },
    });

    await handleModelCommand(host, 'worker');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(session.setModel).toHaveBeenCalledWith('worker');
    });
  });
});
