import { computed, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

import type { ExtendedState, usePythinkerWebClient } from '../src/composables/usePythinkerWebClient';
import { useModelProviderState } from '../src/composables/client/useModelProviderState';

const { api } = vi.hoisted(() => ({
  api: {
    listModels: vi.fn(),
    setConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('model thinking preferences', () => {
  it('restores the explicit effort per model without persisting derived switch defaults', async () => {
    api.listModels.mockResolvedValueOnce([
      {
        id: 'provider/effort',
        provider: 'Provider',
        model: 'Effort',
        maxContextSize: 128_000,
        capabilities: ['thinking'],
        supportEfforts: ['low', 'high', 'max'],
        defaultEffort: 'low',
      },
      {
        id: 'provider/plain',
        provider: 'Provider',
        model: 'Plain',
        maxContextSize: 128_000,
        capabilities: [],
      },
    ]);
    const rawState = reactive({
      activeSessionId: null,
      sessions: [],
      defaultModel: 'provider/effort',
      thinking: undefined,
      thinkingBySession: {},
      inFlightBySession: {},
    }) as unknown as ExtendedState;
    const state = useModelProviderState(rawState, {
      pushOperationFailure: vi.fn(),
      refreshSessionStatus: vi.fn().mockResolvedValue(undefined),
      persistSessionProfile: vi.fn().mockResolvedValue(true),
      activity: computed(() => 'idle'),
      updateSession: vi.fn(),
      updateSessionMessages: vi.fn(),
    });

    await state.loadModels();
    state.setThinking('max');
    await flushPromises();
    expect(api.setConfig).toHaveBeenCalledOnce();

    await state.setModel('provider/plain');
    expect(rawState.thinking).toBe('off');
    await state.setModel('provider/effort');
    expect(rawState.thinking).toBe('max');
    expect(api.setConfig).toHaveBeenCalledOnce();
  });
});


describe('model/provider state convergence (client wiring)', () => {
  const session = {
    id: 'session-1',
    title: 'Session',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    archived: false,
    busy: false,
    lastPrompt: 'Prompt',
    cwd: '/workspace',
    messageCount: 0,
    lastSeq: 0,
    workspaceId: 'workspace-1',
  };

  let handlers: Record<string, (...args: unknown[]) => unknown> | undefined;
  let connection: { close: () => void };

  function installClientApi(overrides: Record<string, unknown> = {}): void {
    const full: Record<string, unknown> = {
      getAuth: vi.fn(async () => ({ ready: true, defaultModel: 'model-1' })),
      getHealth: vi.fn(async () => ({ status: 'ok', uptimeSec: 1 })),
      getMeta: vi.fn(async () => ({
        serverVersion: '0.0.0',
        serverId: 'server-1',
        startedAt: '2026-01-01T00:00:00.000Z',
        capabilities: {},
        openInApps: [],
        dangerousBypassAuth: false,
        backend: 'v2',
      })),
      getConfig: vi.fn(async () => ({ providers: {}, defaultModel: 'model-1' })),
      listModels: vi.fn(async () => []),
      listProviders: vi.fn(async () => []),
      listWorkspaces: vi.fn(async () => [
        { id: 'workspace-1', root: '/workspace', name: 'Workspace', sessionCount: 1 },
      ]),
      getFsHome: vi.fn(async () => ({ home: '/home/test', recentRoots: [] })),
      listSessions: vi.fn(async () => ({ items: [{ ...session }], hasMore: false })),
      listSessionGroupsV2: vi.fn(async () => ({
        groups: [
          {
            workspace: { id: 'workspace-1', cwd: '/workspace' },
            sessions: [{ ...session }],
            total: 1,
          },
        ],
        hasMore: false,
        nextPageToken: null,
        total: 1,
      })),
      getSessionSnapshot: vi.fn(async () => ({
        asOfSeq: 0,
        epoch: 'epoch-1',
        session: {
          ...session,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalCostUsd: 0, contextTokens: 0, contextLimit: 0, turnCount: 0 },
        },
        messages: [],
        hasMoreMessages: false,
        inFlightTurn: null,
        subagents: [],
        pendingApprovals: [],
        pendingQuestions: [],
      })),
      getSessionStatus: vi.fn(async () => ({
        model: 'model-1',
        thinkingEffort: 'off',
        permission: 'manual',
        planMode: false,
        dynamicWorkflowMode: false,
        contextTokens: 0,
        maxContextTokens: 0,
        contextUsage: 0,
      })),
      getSessionGoal: vi.fn(async () => null),
      getSessionWarnings: vi.fn(async () => []),
      getGitStatus: vi.fn(async () => ({
        branch: '',
        ahead: 0,
        behind: 0,
        entries: {},
        additions: 0,
        deletions: 0,
        pullRequest: null,
      })),
      listTasks: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      listSkillsForWorkspace: vi.fn(async () => []),
      getFileUrl: (fileId: string) => `file:${fileId}`,
      connectEvents: vi.fn((next: Record<string, (...args: unknown[]) => unknown>) => {
        handlers = next;
        connection = {
          subscribe: vi.fn(),
          unsubscribe: vi.fn(),
          bindNextPromptId: vi.fn(),
          seedSnapshot: vi.fn(),
          abort: vi.fn(),
          terminalAttach: vi.fn(),
          terminalInput: vi.fn(),
          terminalResize: vi.fn(),
          terminalDetach: vi.fn(),
          terminalClose: vi.fn(),
          markSideChannelAgent: vi.fn(),
          health: () => ({ connected: true, open: true, stale: false }),
          reconnect: vi.fn(),
          close: vi.fn(),
        };
        return connection;
      }),
      updateSession: vi.fn(async () => undefined),
      setConfig: vi.fn(async () => undefined),
      ...overrides,
    };
    for (const key of Object.keys(api)) delete api[key as keyof typeof api];
    Object.assign(api, full);
  }

  async function makeClient(): Promise<ReturnType<typeof usePythinkerWebClient>> {
    vi.stubGlobal('WebSocket', class {});
    const { usePythinkerWebClient } = await import('../src/composables/usePythinkerWebClient');
    const client = usePythinkerWebClient();
    await client.load();
    return client;
  }

  afterEach(() => {
    connection?.close();
    handlers = undefined;
    vi.unstubAllGlobals();
  });

  it('refreshes auth and the model catalog when a configChanged event arrives', async () => {
    installClientApi();
    const client = await makeClient();
    expect(handlers).toBeDefined();

    const authCalls = (api.getAuth as ReturnType<typeof vi.fn>).mock.calls.length;
    const modelCalls = (api.listModels as ReturnType<typeof vi.fn>).mock.calls.length;
    (
      handlers as unknown as {
        onEvent: (event: unknown, meta: unknown) => void;
      }
    ).onEvent(
      {
        type: 'configChanged',
        changedFields: ['models'],
        config: { providers: {}, defaultModel: 'model-1' },
      },
      { sessionId: 'session-1', seq: 2 },
    );
    await flushPromises();
    await flushPromises();

    expect((api.getAuth as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(authCalls);
    expect((api.listModels as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      modelCalls,
    );
    expect(client.warnings.value).toHaveLength(0);
  });

  it('re-reads session status after a rejected profile persist so the UI converges to engine truth', async () => {
    installClientApi({
      updateSession: vi.fn(async () => {
        throw Object.assign(new Error('model not resolvable'), { code: 40113 });
      }),
    });
    const client = await makeClient();

    const statusCalls = (api.getSessionStatus as ReturnType<typeof vi.fn>).mock.calls.length;
    client.setThinking('max');
    await flushPromises();
    await flushPromises();

    expect((api.updateSession as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect((api.getSessionStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      statusCalls,
    );
  });

  it('surfaces a specific notice and re-reads auth when a prompt is refused as not resolvable', async () => {
    installClientApi({
      submitPrompt: vi.fn(async () => {
        throw Object.assign(new Error('Model "glm-5.3-flash" not resolvable (provider-missing)'), {
          name: 'DaemonApiError',
          code: 40113,
        });
      }),
    });
    const client = await makeClient();

    const authCalls = (api.getAuth as ReturnType<typeof vi.fn>).mock.calls.length;
    await client.sendPrompt('hello');
    await flushPromises();
    await flushPromises();

    const notices = client.warnings.value.filter(
      (warning) =>
        typeof warning === 'object' && warning.title === 'Model unavailable',
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      message: 'Model "glm-5.3-flash" not resolvable (provider-missing)',
    });
    expect((api.getAuth as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(authCalls);
  });
});
