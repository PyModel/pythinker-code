import { mount, shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppConfig, AppConnector, AppModel, AppSession, AppSkill } from '../src/api/types';
import SettingsNav from '../src/components/settings/SettingsNav.vue';
import SettingsPane from '../src/components/settings/SettingsPane.vue';
import { messages } from '../src/i18n/locales';
import { useSettingsNav, type SettingsTab } from '../src/composables/useSettingsNav';

vi.mock('../src/composables/useIsMobile', async () => {
  const { ref: vueRef } = await import('vue');
  return { useIsMobile: () => vueRef(false) };
});

vi.mock('../src/composables/useIsDark', async () => {
  const { ref: vueRef } = await import('vue');
  return { useIsDark: () => vueRef(false) };
});

vi.mock('../src/composables/usePythinkerWebClient', async () => {
  const { ref: vueRef } = await import('vue');
  const arrayKeys = [
    'activationBadges', 'changes', 'connectors', 'dynamicWorkflows', 'models', 'pendingApprovals',
    'plugins', 'providers', 'questions', 'queued', 'recentCwds', 'sessions', 'sessionsForView',
    'sessionsWithUsage', 'sideChatTurns', 'skills', 'starredModelIds', 'subagents', 'tasks', 'todos',
    'turns', 'warnings', 'workspaceGroups', 'workspacesView',
  ];
  const recordKeys = ['attentionBySession', 'attentionByWorkspace', 'pendingBySession', 'unreadBySession'];
  const client: Record<string, unknown> = {
    activePullRequest: vueRef(null),
    activeSessionId: vueRef(''),
    activeWorkspaceId: vueRef(null),
    activity: vueRef('idle'),
    authReady: vueRef(true),
    betaToc: vueRef(false),
    colorScheme: vueRef('system'),
    compaction: vueRef(null),
    config: vueRef(null),
    connectorsLoading: vueRef(false),
    defaultModel: vueRef(null),
    dynamicWorkflowMode: vueRef(false),
    fastSpinner: vueRef(false),
    fileDiff: vueRef(null),
    fileDiffLoading: vueRef(false),
    gitDiffStats: vueRef(null),
    gitInfo: vueRef(null),
    goal: vueRef(null),
    goalMode: vueRef(false),
    initialized: vueRef(true),
    isSending: vueRef(false),
    notifyOnComplete: vueRef(false),
    notifyPermission: vueRef('default'),
    onboarded: vueRef(true),
    permission: vueRef('manual'),
    planMode: vueRef(false),
    selectedDiffPath: vueRef(null),
    sessionCost: vueRef(0),
    sessionLoading: vueRef(false),
    sideChatRunning: vueRef(false),
    sideChatSending: vueRef(false),
    sideChatVisible: vueRef(false),
    status: vueRef({ branch: '', cwd: '/workspace', ctxMax: 0, ctxUsed: 0, model: '', modelId: '', permission: 'manual' }),
    theme: vueRef('modern'),
    thinking: vueRef('off'),
    uiFontSize: vueRef(15),
    visibleWorkspace: vueRef(null),
    resolveImageUrl: vi.fn(),
  };
  for (const key of arrayKeys) client[key] = vueRef([]);
  for (const key of recordKeys) client[key] = vueRef({});
  return {
    usePythinkerWebClient: () => new Proxy(client, {
      get(target, property) {
        if (property in target) return Reflect.get(target, property);
        const method = vi.fn();
        target[String(property)] = method;
        return method;
      },
    }),
  };
});

import App from '../src/App.vue';
import ConversationPane from '../src/components/ConversationPane.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

const config: AppConfig = {
  providers: {
    pythinker: { type: 'pythoughts', defaultModel: 'pythinker/k2', hasApiKey: true },
    openai: { type: 'openai', hasApiKey: false },
  },
  defaultModel: 'pythinker/k2',
  models: {
    'pythinker/k2': { provider: 'pythinker', model: 'k2' },
    'openai/gpt-5': { provider: 'openai', model: 'gpt-5' },
  },
  defaultPermissionMode: 'manual',
  defaultThinking: true,
  defaultPlanMode: false,
  mergeAllAvailableSkills: false,
  telemetry: true,
  raw: { secret: 'must-not-render' },
};

const models: AppModel[] = [
  { id: 'pythinker/k2', provider: 'pythinker', model: 'k2', displayName: 'Pythinker K2', maxContextSize: 128000 },
  { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', displayName: 'GPT-5', maxContextSize: 256000 },
];

const skills: AppSkill[] = [
  { name: 'gen-changesets', description: 'Write the changesets for a PR', source: 'project', path: '.pythinker/skills/gen-changesets' },
  { name: 'brainstorm', description: 'Explore a problem first', source: 'builtin' },
  { name: 'archive', description: 'Archive a session', source: 'builtin', disableModelInvocation: true },
];

const connectors: AppConnector[] = [
  { id: 'mcp_1', name: 'context7', transport: 'http', status: 'connected', toolCount: 2 },
  { id: 'mcp_2', name: 'tavily', transport: 'stdio', status: 'error', toolCount: 0, lastError: 'spawn ENOENT' },
];

function mountPane(activeTab: SettingsTab, extraProps: Record<string, unknown> = {}) {
  return mount(SettingsPane, {
    props: {
      activeTab,
      theme: 'modern',
      colorScheme: 'system',
      uiFontSize: 15,
      authReady: true,
      accountModel: 'pythinker/k2',
      notify: true,
      notifyPermission: 'granted',
      betaToc: false,
      config,
      models,
      configSaving: false,
      ...extraProps,
    },
    global: { plugins: [i18n] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.pythinkerDesktop;
});

describe('settings navigation', () => {
  it('renders the ten grouped tabs and emits a selected tab', async () => {
    const wrapper = mount(SettingsNav, {
      props: { activeTab: 'general' },
      global: { plugins: [i18n] },
    });

    expect(wrapper.findAll('.tab')).toHaveLength(10);
    expect(wrapper.findAll('.tab-group').map((group) => group.text())).toEqual([
      'Basics',
      'Agent capabilities',
      'Data and statistics',
    ]);
    expect(wrapper.get('#settings-tab-general').classes()).toContain('on');

    await wrapper.get('#settings-tab-agent').trigger('click');
    expect(wrapper.emitted('select')).toEqual([['agent']]);
    await wrapper.setProps({ activeTab: 'agent' });
    expect(wrapper.get('#settings-tab-agent').attributes('aria-selected')).toBe('true');
  });

  it('renders only the active settings page without modal markup', async () => {
    const wrapper = mountPane('general');

    expect(wrapper.get('#settings-panel-general').isVisible()).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('.backdrop').exists()).toBe(false);

    await wrapper.setProps({ activeTab: 'agent' });
    expect(wrapper.get('#settings-panel-general').attributes('style')).toContain('display: none');
    expect(wrapper.get('#settings-panel-agent').isVisible()).toBe(true);
  });

  it('loads connectors each time the empty page is opened', () => {
    const onLoadConnectors = vi.fn();
    const { setTab } = useSettingsNav({
      counts: { connectors: 0, plugins: 0, subagents: 0 },
      onLoadConnectors,
      onLoadPlugins: vi.fn(),
      onLoadSubagents: vi.fn(),
    });

    setTab('connectors');
    expect(onLoadConnectors).toHaveBeenCalledOnce();
    setTab('general');
    setTab('connectors');
    expect(onLoadConnectors).toHaveBeenCalledTimes(2);
  });

  it('does not load connectors when they are already known', () => {
    const onLoadConnectors = vi.fn();
    const { setTab } = useSettingsNav({
      counts: { connectors: 2, plugins: 0, subagents: 0 },
      onLoadConnectors,
      onLoadPlugins: vi.fn(),
      onLoadSubagents: vi.fn(),
    });

    setTab('connectors');
    expect(onLoadConnectors).not.toHaveBeenCalled();
  });

  it('loads plugins when the empty page is opened', () => {
    const onLoadPlugins = vi.fn();
    const { setTab } = useSettingsNav({
      counts: { connectors: 0, plugins: 0, subagents: 0 },
      onLoadConnectors: vi.fn(),
      onLoadPlugins,
      onLoadSubagents: vi.fn(),
    });

    setTab('plugins');
    expect(onLoadPlugins).toHaveBeenCalledOnce();
  });

  it('loads subagents when the empty page is opened', () => {
    const onLoadSubagents = vi.fn();
    const { setTab } = useSettingsNav({
      counts: { connectors: 0, plugins: 0, subagents: 0 },
      onLoadConnectors: vi.fn(),
      onLoadPlugins: vi.fn(),
      onLoadSubagents,
    });

    setTab('subagents');
    expect(onLoadSubagents).toHaveBeenCalledOnce();
  });
});

describe('SettingsPane config controls', () => {
  it('renders redacted daemon config and emits partial config patches', async () => {
    const wrapper = mountPane('agent');

    expect(wrapper.text()).toContain('Agent defaults');
    expect(wrapper.text()).toContain('Pythinker K2');
    expect(wrapper.text()).toContain('Credential configured');
    expect(wrapper.text()).toContain('Missing credential');
    expect(wrapper.text()).not.toContain('must-not-render');

    await wrapper.find('.select-field').setValue('openai/gpt-5');
    expect(wrapper.emitted('updateConfig')?.[0]?.[0]).toEqual({ defaultModel: 'openai/gpt-5' });
    const auto = wrapper.findAll('.opt').find((button) => button.text() === 'Auto');
    await auto!.trigger('click');
    expect(wrapper.emitted('updateConfig')?.[1]?.[0]).toEqual({ defaultPermissionMode: 'auto' });
    const planRow = wrapper.findAll('.row').find((row) => row.text().includes('Plan mode by default'));
    await planRow!.find('button.switch').trigger('click');
    expect(wrapper.emitted('updateConfig')?.[2]?.[0]).toEqual({ defaultPlanMode: true });
  });

  it('groups default model options by provider', () => {
    const groups = mountPane('agent').findAll('optgroup');

    expect(groups).toHaveLength(2);
    expect(groups[0]!.attributes('label')).toBe('openai');
    expect(groups[1]!.attributes('label')).toBe('pythinker');
    expect(groups[0]!.findAll('option').some((option) => option.attributes('value') === 'openai/gpt-5')).toBe(true);
    expect(groups[1]!.findAll('option').some((option) => option.attributes('value') === 'pythinker/k2')).toBe(true);
  });
});

describe('SettingsPane desktop updates', () => {
  it('renders desktop update controls and checks for updates', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    window.pythinkerDesktop = {
      platform: 'darwin',
      getUpdateState: vi.fn().mockResolvedValue({ status: 'idle', autoUpdate: true }),
      setAutoUpdate: vi.fn().mockResolvedValue({ status: 'idle', autoUpdate: true }),
      checkForUpdates,
      quitAndInstall: vi.fn().mockResolvedValue(undefined),
      onUpdateState: vi.fn().mockReturnValue(() => undefined),
    };
    const wrapper = mountPane('general');

    expect(wrapper.text()).toContain('Desktop app');
    const checkButton = wrapper.findAll('button').find((button) => button.text() === 'Check for updates');
    await checkButton!.trigger('click');
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });

  it('hides desktop update controls outside the desktop app', () => {
    expect(mountPane('general').text()).not.toContain('Desktop app');
  });
});

describe('SettingsPane skills page', () => {
  it('groups skills by source and marks the slash-only ones', () => {
    const panel = mountPane('skills', { skills }).get('#settings-panel-skills');

    expect(panel.findAll('.listing-head').map((head) => head.text())).toEqual(['builtin', 'project']);
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual(['archive', 'brainstorm', 'gen-changesets']);
    expect(panel.findAll('.tag').map((tag) => tag.text())).toEqual(['slash only']);
  });

  it('says so when no skill is available', () => {
    expect(mountPane('skills').get('#settings-panel-skills').text()).toContain('No skills are available');
  });
});

describe('SettingsPane connectors page', () => {
  it('shows each server status and restarts one on demand', async () => {
    const wrapper = mountPane('connectors', { connectors });
    const panel = wrapper.get('#settings-panel-connectors');

    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual(['context7', 'tavily']);
    expect(panel.findAll('.dot').map((dot) => dot.classes().join(' '))).toEqual(['dot s-connected', 'dot s-error']);
    expect(panel.text()).toContain('spawn ENOENT');
    expect(panel.text()).toContain('2 tools');
    await panel.findAll('.icon-btn')[1]!.trigger('click');
    expect(wrapper.emitted('restartConnector')).toEqual([['mcp_2']]);
  });
});

describe('SettingsPane hooks page', () => {
  it('groups hooks by event and shows what each one runs', () => {
    const panel = mountPane('hooks', {
      config: {
        ...config,
        hooks: [
          { event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'block-no-verify.sh' },
          { event: 'PreToolUse', type: 'command', command: 'observe.sh pre', timeout: 30 },
          { event: 'SessionStart', type: 'command', command: 'agent-state.sh', async: true },
        ],
      },
    }).get('#settings-panel-hooks');

    expect(panel.findAll('.listing-head').map((head) => head.text())).toEqual(['PreToolUse', 'SessionStart']);
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual(['Bash', '*', '*']);
    expect(panel.text()).toContain('block-no-verify.sh');
    expect(panel.text()).toContain('30s timeout');
    expect(panel.text()).toContain('async');
  });

  it('says so when no hook is configured', () => {
    expect(mountPane('hooks').get('#settings-panel-hooks').text()).toContain('No hooks are configured');
  });
});

describe('SettingsPane usage page', () => {
  const sessions = [
    { id: 'ses_1', model: 'Pythinker K2', usage: { inputTokens: 600, outputTokens: 400, turnCount: 3, totalCostUsd: 1.5 } },
    { id: 'ses_2', model: 'GPT-5', usage: { inputTokens: 800, outputTokens: 200, turnCount: 2, totalCostUsd: 0.75 } },
  ] as AppSession[];

  it('totals tokens, sessions, turns and cost', () => {
    const values = mountPane('usage', { sessions }).get('#settings-panel-usage').findAll('.stat-value').map((value) => value.text());
    expect(values).toEqual(['2k', '2', '5', '$2.25']);
  });

  it('splits the token share per model, largest first', () => {
    const panel = mountPane('usage', { sessions }).get('#settings-panel-usage');
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual(['Pythinker K2', 'GPT-5']);
    expect(panel.findAll('.listing-meta').map((meta) => meta.text())).toEqual(['50%', '50%']);
  });
});

describe('SettingsPane plugins page', () => {
  const plugins = [
    { id: 'plg_1', displayName: 'Cloudflare', version: '1.2.0', enabled: true, state: 'loaded', skillCount: 3, mcpServerCount: 2, hasErrors: false, source: 'github' },
    { id: 'plg_2', displayName: 'Designer', enabled: false, state: 'disabled', skillCount: 1, mcpServerCount: 0, hasErrors: true, source: 'local' },
  ];

  it('shows each plugin with its counts and toggles one', async () => {
    const wrapper = mountPane('plugins', { plugins });
    const panel = wrapper.get('#settings-panel-plugins');

    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual(['Cloudflare', 'Designer']);
    expect(panel.text()).toContain('3 skills · 2 servers');
    expect(panel.text()).toContain('reported errors');
    expect(panel.findAll('.listing-row')[1]!.classes()).toContain('off');
    await panel.findAll('.switch')[1]!.trigger('click');
    expect(wrapper.emitted('setPluginEnabled')).toEqual([[{ pluginId: 'plg_2', enabled: true }]]);
  });
});

describe('SettingsPane subagents page', () => {
  const subagents = [{
    name: 'Explore',
    description: 'Read-only search agent',
    source: 'built-in' as const,
    tools: ['Read', 'Grep', 'Glob'],
    model: 'Pythinker K2',
    effort: 'max',
  }];

  it('shows the profile source, tool count, model and effort', () => {
    const panel = mountPane('subagents', { subagents }).get('#settings-panel-subagents');
    expect(panel.get('.listing-name').text()).toBe('Explore');
    expect(panel.findAll('.tag').map((tag) => tag.text())).toEqual(['built-in', '3 tools', 'max']);
    expect(panel.text()).toContain('Pythinker K2');
    expect(panel.text()).toContain('Read-only search agent');
  });
});

describe('desktop settings route', () => {
  it('swaps the sidebar body and main content while settings is open', async () => {
    const wrapper = shallowMount(App, {
      global: {
        plugins: [i18n],
        stubs: { Sidebar: false, SettingsNav: false, SettingsPane: false },
      },
    });

    expect(wrapper.find('.sessions').exists()).toBe(true);
    expect(wrapper.findComponent(ConversationPane).exists()).toBe(true);

    await wrapper.get('.side-foot .settings-row').trigger('click');
    await nextTick();

    expect(wrapper.find('.settings-tabs').exists()).toBe(true);
    expect(wrapper.find('.sessions').exists()).toBe(false);
    expect(wrapper.findComponent(SettingsPane).exists()).toBe(true);
    expect(wrapper.findComponent(ConversationPane).exists()).toBe(false);

    await wrapper.findAll('.sidebar-rail .rail-btn').at(-1)!.trigger('click');
    await nextTick();

    expect.soft(wrapper.find('.settings-tabs').exists()).toBe(false);
    expect.soft(wrapper.find('.sessions').exists()).toBe(true);
    expect.soft(wrapper.findComponent(ConversationPane).exists()).toBe(true);
  });

  it('leaves the settings route when a new session starts', async () => {
    const wrapper = shallowMount(App, {
      global: {
        plugins: [i18n],
        stubs: { Sidebar: false, SettingsNav: false, SettingsPane: false },
      },
    });

    await wrapper.get('.side-foot .settings-row').trigger('click');
    await nextTick();
    expect(wrapper.findComponent(SettingsPane).exists()).toBe(true);

    // New Session shares the sidebar with the settings nav, so it has to close
    // the route — the content area can only show one of the two.
    await wrapper.get('.btn-new-chat').trigger('click');
    await nextTick();

    expect(wrapper.findComponent(SettingsPane).exists()).toBe(false);
    expect(wrapper.find('.sessions').exists()).toBe(true);
  });
});
