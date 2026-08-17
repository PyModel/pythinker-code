import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, type Ref } from 'vue';

import { DaemonPythinkerWebApi } from '../src/api/daemon/client';
import CapabilityMenu from '../src/components/CapabilityMenu.vue';

type MockFunction = ReturnType<typeof vi.fn>;
type TestTool = { name: string; description: string; inputSchema: unknown; source: 'builtin' };
type TestSkill = { name: string; description: string; source: string };
type TestConnector = { id: string; name: string; transport: 'http' | 'stdio'; status: 'connected'; toolCount: number };
type TestPlugin = { id: string; displayName: string; enabled: boolean };

interface MockClient {
  activeSessionId: Ref<string>;
  activeSessionCapabilities: Ref<{ tools: string[]; mcpServers: string[] }>;
  toolsBySession: Ref<Record<string, TestTool[]>>;
  toolsLoadingBySession: Ref<Record<string, boolean>>;
  skills: Ref<TestSkill[]>;
  skillsLoadingBySession: Ref<Record<string, boolean>>;
  connectors: Ref<TestConnector[]>;
  connectorsLoading: Ref<boolean>;
  plugins: Ref<TestPlugin[]>;
  pluginsLoading: Ref<boolean>;
  loadCapabilityData: MockFunction;
  updateCapabilities: MockFunction;
  setPluginEnabled: MockFunction;
  updateSession: MockFunction;
}

const clientState = vi.hoisted(() => ({ value: undefined as MockClient | undefined }));

vi.mock('../src/composables/usePythinkerWebClient', async () => {
  const { ref: vueRef } = await import('vue');
  const updateSession = vi.fn(async () => undefined);
  const client = {
    activeSessionId: vueRef('session_1'),
    activeSessionCapabilities: vueRef({ tools: ['Read'], mcpServers: ['mcp_1'] }),
    toolsBySession: vueRef({
      session_1: [
        { name: 'Read', description: 'Read files', inputSchema: {}, source: 'builtin' },
        { name: 'Write', description: 'Write files', inputSchema: {}, source: 'builtin' },
      ],
    }),
    toolsLoadingBySession: vueRef({ session_1: false }),
    skills: vueRef([{ name: 'review', description: 'Review code', source: 'project' }]),
    skillsLoadingBySession: vueRef({ session_1: false }),
    connectors: vueRef([
      { id: 'mcp_1', name: 'Docs', transport: 'http', status: 'connected', toolCount: 2 },
      { id: 'mcp_2', name: 'Issue tracker', transport: 'stdio', status: 'connected', toolCount: 1 },
    ]),
    connectorsLoading: vueRef(false),
    plugins: vueRef([{ id: 'plugin_1', displayName: 'Review plugin', enabled: true }]),
    pluginsLoading: vueRef(false),
    loadCapabilityData: vi.fn(),
    updateCapabilities: vi.fn((input: Record<string, unknown>) => {
      void updateSession('session_1', input);
    }),
    setPluginEnabled: vi.fn(),
    updateSession,
  };
  clientState.value = client;
  return { usePythinkerWebClient: () => client };
});

const menuMessages = {
  capabilityMenu: {
    trigger: 'Capabilities',
    triggerLabel: 'Choose capabilities',
    back: 'Back',
    loading: 'Loading',
    tools: {
      title: 'Tools',
      caption: 'Applies to this session immediately.',
      toggle: 'Use {name}',
    },
    skills: {
      title: 'Skills',
      caption: 'Read-only here.',
      toggle: 'Skill {name}',
    },
    mcp: {
      title: 'MCP servers',
      caption: 'Applies to this session immediately.',
      toggle: 'Use {name}',
    },
    plugins: {
      title: 'Plugins',
      caption: 'Global to the daemon. Changes affect every session immediately.',
      toggle: 'Enable {name}',
    },
  },
};

function okEnvelope(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: 0, msg: 'ok', data, request_id: 'req_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function api(): DaemonPythinkerWebApi {
  return new DaemonPythinkerWebApi({
    serverHttpUrl: 'http://example.test:58627',
    clientId: 'web_test',
    clientName: 'pythinker-code-web',
    clientVersion: '0.1.1',
    clientUiMode: 'web',
  });
}

function mountMenu() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: { en: menuMessages },
    missingWarn: false,
    fallbackWarn: false,
  });
  return mount(CapabilityMenu, {
    props: { sessionId: 'session_1' },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

function client(): MockClient {
  if (!clientState.value) throw new Error('mock client is not ready');
  return clientState.value;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  const current = client();
  current.activeSessionId.value = 'session_1';
  current.activeSessionCapabilities.value = { tools: ['Read'], mcpServers: ['mcp_1'] };
  current.toolsBySession.value = {
    session_1: [
      { name: 'Read', description: 'Read files', inputSchema: {}, source: 'builtin' },
      { name: 'Write', description: 'Write files', inputSchema: {}, source: 'builtin' },
    ],
  };
  current.skills.value = [{ name: 'review', description: 'Review code', source: 'project' }];
  current.connectors.value = [
    { id: 'mcp_1', name: 'Docs', transport: 'http', status: 'connected', toolCount: 2 },
    { id: 'mcp_2', name: 'Issue tracker', transport: 'stdio', status: 'connected', toolCount: 1 },
  ];
  current.plugins.value = [{ id: 'plugin_1', displayName: 'Review plugin', enabled: true }];
  current.toolsLoadingBySession.value = { session_1: false };
  current.skillsLoadingBySession.value = { session_1: false };
  current.connectorsLoading.value = false;
  current.pluginsLoading.value = false;
  current.updateCapabilities.mockReset();
  current.updateCapabilities.mockImplementation((input: Record<string, unknown>) => {
    void current.updateSession('session_1', input);
  });
  current.updateSession.mockReset();
  current.updateSession.mockResolvedValue(undefined);
  current.loadCapabilityData.mockClear();
});

describe('daemon capability contracts', () => {
  it('listTools requests the session id and maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okEnvelope({
      tools: [
        {
          name: 'Read',
          description: 'Read files',
          input_schema: { type: 'object' },
          source: 'builtin',
        },
        {
          name: 'mcp__docs__search',
          description: 'Search docs',
          input_schema: {},
          source: 'mcp',
          mcp_server_id: 'mcp_1',
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const tools = await api().listTools('session/1');
    const requestUrl = new URL(String(fetchMock.mock.calls[0]![0]));

    expect(requestUrl.pathname.endsWith('/tools')).toBe(true);
    expect(requestUrl.searchParams.get('session_id')).toBe('session/1');
    expect(tools).toEqual([
      { name: 'Read', description: 'Read files', inputSchema: { type: 'object' }, source: 'builtin', mcpServerId: undefined },
      { name: 'mcp__docs__search', description: 'Search docs', inputSchema: {}, source: 'mcp', mcpServerId: 'mcp_1' },
    ]);
  });

  it('updateSession sends only the supplied capability keys', async () => {
    const sessionResponse = {
      id: 'session_1',
      title: 'Session',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      status: 'idle',
      metadata: { cwd: '/repo' },
      agent_config: { model: 'test/model' },
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        total_cost_usd: 0,
        context_tokens: 0,
        context_limit: 128_000,
        turn_count: 0,
      },
      permission_rules: [],
      message_count: 0,
      last_seq: 0,
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okEnvelope(sessionResponse)));
    vi.stubGlobal('fetch', fetchMock);
    const daemon = api();

    await daemon.updateSession('session_1', { tools: ['Read'] });
    await daemon.updateSession('session_1', { mcpServers: ['mcp_1'] });
    await daemon.updateSession('session_1', {});

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[0]).toEqual({ agent_config: { tools: ['Read'] } });
    expect(bodies[1]).toEqual({ agent_config: { mcp_servers: ['mcp_1'] } });
    expect(bodies[2]).not.toHaveProperty('agent_config.tools');
    expect(bodies[2]).not.toHaveProperty('agent_config.mcp_servers');
  });
});

/** A promise the test settles by hand, so two writes can finish out of order. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CapabilityMenu', () => {
  it('omits a capability group with no items', async () => {
    const current = client();
    current.toolsBySession.value = { session_1: [] };
    current.skills.value = [];
    current.connectors.value = [];
    current.plugins.value = [];

    const wrapper = mountMenu();
    await wrapper.get('.capability-trigger').trigger('click');
    await flushPromises();

    expect(document.body.querySelector('.capability-panel')?.querySelectorAll('.menu-row')).toHaveLength(0);
  });

  it('toggling an MCP server calls updateSession with the new server list', async () => {
    client().activeSessionCapabilities.value = { tools: ['Read'], mcpServers: ['mcp_1', 'mcp_2'] };
    const wrapper = mountMenu();
    await wrapper.get('.capability-trigger').trigger('click');
    await flushPromises();
    const toggle = document.body.querySelector('.mcp-row .switch-toggle') as HTMLButtonElement;

    toggle.click();
    await flushPromises();

    expect(client().updateSession).toHaveBeenCalledWith('session_1', { mcpServers: ['mcp_2'] });
  });

  it('restores the previous toggle state when updateSession rejects', async () => {
    const current = client();
    current.updateCapabilities.mockRejectedValueOnce(new Error('daemon unreachable'));
    const wrapper = mountMenu();
    await wrapper.get('.capability-trigger').trigger('click');
    await flushPromises();
    const toggle = document.body.querySelector('.mcp-row .switch-toggle') as HTMLButtonElement;

    toggle.click();
    await nextTick();
    // The optimistic state has to be observed first: asserting only the final
    // value would also pass if the toggle never moved.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await flushPromises();

    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('sends capability writes in toggle order and ignores a stale rollback', async () => {
    const current = client();
    current.activeSessionCapabilities.value = { tools: ['Read'], mcpServers: [] };
    // Two writes held open, settled in the order the test chooses.
    const first = deferred();
    const second = deferred();
    current.updateCapabilities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const wrapper = mountMenu();
    await wrapper.get('.capability-trigger').trigger('click');
    await flushPromises();
    const toggles = document.body.querySelectorAll('.mcp-row .switch-toggle');
    const one = toggles[0] as HTMLButtonElement;
    const two = toggles[1] as HTMLButtonElement;

    one.click();
    await nextTick();
    two.click();
    await nextTick();

    // The chain holds the second write until the first one settles, so the
    // daemon can never see [mcp_1] after [mcp_1, mcp_2].
    expect(current.updateCapabilities).toHaveBeenCalledTimes(1);
    first.reject(new Error('daemon unreachable'));
    await flushPromises();
    second.resolve();
    await flushPromises();

    expect(current.updateCapabilities.mock.calls.map((call) => call[0])).toEqual([
      { mcpServers: ['mcp_1'] },
      { mcpServers: ['mcp_1', 'mcp_2'] },
    ]);
    // The stale failure must not discard the newer selection.
    expect(one.getAttribute('aria-checked')).toBe('true');
    expect(two.getAttribute('aria-checked')).toBe('true');
  });

  it('drops a queued write and its rollback when the session changes first', async () => {
    const current = client();
    const pending = deferred();
    current.updateCapabilities.mockReturnValueOnce(pending.promise);

    const wrapper = mountMenu();
    await wrapper.get('.capability-trigger').trigger('click');
    await flushPromises();
    const toggle = document.body.querySelector('.mcp-row .switch-toggle') as HTMLButtonElement;

    toggle.click();
    await nextTick();

    // The user moves to a session with a different selection while the write is
    // still open. `updateCapabilities` targets whichever session is active, so
    // the stale failure belongs to a session that is gone; rolling back here
    // would show session one's selection under session two.
    await wrapper.setProps({ sessionId: 'session_2' });
    current.activeSessionId.value = 'session_2';
    current.activeSessionCapabilities.value = { tools: ['Read'], mcpServers: ['mcp_2'] };
    await nextTick();

    pending.reject(new Error('daemon unreachable'));
    await flushPromises();

    const checked = [...document.body.querySelectorAll('.mcp-row')].map((row) => [
      row.textContent?.includes('Docs') === true ? 'Docs' : 'Issue tracker',
      row.querySelector('.switch-toggle')?.getAttribute('aria-checked'),
    ]);
    expect(checked).toEqual([['Docs', 'false'], ['Issue tracker', 'true']]);
  });

  it('renders selected tools and MCP servers as chips', () => {
    const wrapper = mountMenu();

    expect(wrapper.findAll('.chip').map((chip) => chip.text())).toEqual(['×Read', '×Docs']);
  });

  it('keeps CapabilityMenu.vue free of dark utilities and color literals', () => {
    const source = readFileSync(join(import.meta.dirname, '../src/components/CapabilityMenu.vue'), 'utf8');
    expect(source).not.toMatch(/\bdark:/u);
    expect(source).not.toMatch(/#[\da-f]{3,8}\b/iu);
    expect(source).not.toMatch(/\brgba?\s*\(/iu);
  });
});
