import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SettingsDialog from '../src/components/SettingsDialog.vue';
import enSettings from '../src/i18n/locales/en/settings';
import type { AppConfig, AppConnector, AppModel, AppSkill } from '../src/api/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      settings: enSettings,
      theme: {
        label: 'Theme',
        modern: 'Modern',
        pythinker: 'Pythinker',
        colorSchemeLabel: 'Color scheme',
        light: 'Light',
        dark: 'Dark',
        system: 'System',
      },
      sidebar: {
        daemon: 'Daemon',
        language: 'Language',
        notSignedIn: 'Not signed in',
        signIn: 'Sign in',
        signOut: 'Sign out',
      },
      onboarding: { reopen: 'Open onboarding' },
      newSession: { close: 'Close' },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const config: AppConfig = {
  providers: {
    pythinker: {
      type: 'pythoughts',
      defaultModel: 'pythinker/k2',
      hasApiKey: true,
    },
    openai: {
      type: 'openai',
      hasApiKey: false,
    },
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
  {
    id: 'pythinker/k2',
    provider: 'pythinker',
    model: 'k2',
    displayName: 'Pythinker K2',
    maxContextSize: 128000,
  },
  {
    id: 'openai/gpt-5',
    provider: 'openai',
    model: 'gpt-5',
    displayName: 'GPT-5',
    maxContextSize: 256000,
  },
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

function mountDialog(extraProps: Record<string, unknown> = {}) {
  return mount(SettingsDialog, {
    props: {
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
    global: {
      plugins: [i18n],
    },
  });
}

async function openTab(wrapper: ReturnType<typeof mountDialog>, label: string): Promise<void> {
  const tab = wrapper.findAll('.tab').find((button) => button.text() === label);
  await tab!.trigger('click');
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.pythinkerDesktop;
});

describe('SettingsDialog tabs', () => {
  it('renders side tabs and switches panels', async () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).toContain('General');

    const generalTab = wrapper.findAll('.tab').find((button) => button.text() === 'General');
    const agentTab = wrapper.findAll('.tab').find((button) => button.text() === 'Agent');
    const advancedTab = wrapper.findAll('.tab').find((button) => button.text() === 'Advanced');
    const experimentalTab = wrapper.findAll('.tab').find((button) => button.text() === 'Experimental');

    expect(generalTab!.classes('on')).toBe(true);
    expect(agentTab!.classes('on')).toBe(false);

    await agentTab!.trigger('click');
    expect(generalTab!.classes('on')).toBe(false);
    expect(agentTab!.classes('on')).toBe(true);

    const agentPanel = wrapper.find('#settings-panel-agent');
    expect(agentPanel.isVisible()).toBe(true);
    const generalPanel = wrapper.find('#settings-panel-general');
    expect(generalPanel.isVisible()).toBe(false);

    await advancedTab!.trigger('click');
    expect(advancedTab!.classes('on')).toBe(true);
    expect(agentTab!.classes('on')).toBe(false);

    await experimentalTab!.trigger('click');
    expect(experimentalTab!.classes('on')).toBe(true);
    expect(advancedTab!.classes('on')).toBe(false);
  });
});

describe('SettingsDialog config controls', () => {
  it('renders redacted daemon config and emits partial config patches', async () => {
    const wrapper = mountDialog();

    const agentTab = wrapper.findAll('.tab').find((button) => button.text() === 'Agent');
    await agentTab!.trigger('click');

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

  it('groups default model options by provider', async () => {
    const wrapper = mountDialog();

    const agentTab = wrapper.findAll('.tab').find((button) => button.text() === 'Agent');
    await agentTab!.trigger('click');

    const groups = wrapper.findAll('optgroup');
    expect(groups.length).toBe(2);
    expect(groups[0]!.attributes('label')).toBe('openai');
    expect(groups[1]!.attributes('label')).toBe('pythinker');

    const openaiOptions = groups[0]!.findAll('option');
    expect(openaiOptions.some((o) => o.attributes('value') === 'openai/gpt-5')).toBe(true);

    const pythinkerOptions = groups[1]!.findAll('option');
    expect(pythinkerOptions.some((o) => o.attributes('value') === 'pythinker/k2')).toBe(true);
  });
});

describe('SettingsDialog desktop updates', () => {
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

    const wrapper = mountDialog();

    expect(wrapper.text()).toContain('Desktop app');
    const checkButton = wrapper.findAll('button').find((button) => button.text() === 'Check for updates');
    expect(checkButton).toBeDefined();

    await checkButton!.trigger('click');
    expect(checkForUpdates).toHaveBeenCalledOnce();
  });

  it('hides desktop update controls outside the desktop app', () => {
    const wrapper = mountDialog();

    expect(wrapper.text()).not.toContain('Desktop app');
  });
});

describe('SettingsDialog dialog focus', () => {
  it('is a modal that takes focus on open and restores it on close', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const wrapper = mount(SettingsDialog, {
      props: {
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
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });

    const dialog = wrapper.find('.dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');

    await nextTick();
    // Opening moves focus into the dialog.
    expect(document.activeElement).toBe(dialog.element);

    wrapper.unmount();
    await nextTick();
    // Closing returns focus to the opener.
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });
});

describe('SettingsDialog skills page', () => {
  it('groups skills by source and marks the slash-only ones', async () => {
    const wrapper = mountDialog({ skills });
    await openTab(wrapper, 'Skills');

    const panel = wrapper.get('#settings-panel-skills');
    expect(panel.findAll('.listing-head').map((head) => head.text())).toEqual([
      'builtin',
      'project',
    ]);
    // Sorted by name inside each group.
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual([
      'archive',
      'brainstorm',
      'gen-changesets',
    ]);
    expect(panel.findAll('.tag').map((tag) => tag.text())).toEqual(['slash only']);
  });

  it('says so when no skill is available', async () => {
    const wrapper = mountDialog();
    await openTab(wrapper, 'Skills');

    expect(wrapper.get('#settings-panel-skills').text()).toContain('No skills are available');
  });
});

describe('SettingsDialog connectors page', () => {
  it('loads the connectors the first time the page is opened', async () => {
    const wrapper = mountDialog();
    await openTab(wrapper, 'Connectors');

    expect(wrapper.emitted('loadConnectors')).toHaveLength(1);

    await openTab(wrapper, 'General');
    await openTab(wrapper, 'Connectors');
    expect(wrapper.emitted('loadConnectors')).toHaveLength(2);
  });

  it('does not reload when connectors are already known', async () => {
    const wrapper = mountDialog({ connectors });
    await openTab(wrapper, 'Connectors');

    expect(wrapper.emitted('loadConnectors')).toBeUndefined();
  });

  it('shows each server status and restarts one on demand', async () => {
    const wrapper = mountDialog({ connectors });
    await openTab(wrapper, 'Connectors');

    const panel = wrapper.get('#settings-panel-connectors');
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual([
      'context7',
      'tavily',
    ]);
    expect(panel.findAll('.dot').map((dot) => dot.classes().join(' '))).toEqual([
      'dot s-connected',
      'dot s-error',
    ]);
    expect(panel.text()).toContain('spawn ENOENT');
    expect(panel.text()).toContain('2 tools');

    await panel.findAll('.act')[1]!.trigger('click');
    expect(wrapper.emitted('restartConnector')).toEqual([['mcp_2']]);
  });
});

describe('SettingsDialog hooks page', () => {
  it('groups hooks by event and shows what each one runs', async () => {
    const wrapper = mountDialog({
      config: {
        ...config,
        hooks: [
          { event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'block-no-verify.sh' },
          { event: 'PreToolUse', type: 'command', command: 'observe.sh pre', timeout: 30 },
          { event: 'SessionStart', type: 'command', command: 'agent-state.sh', async: true },
        ],
      },
    });
    await openTab(wrapper, 'Hooks');

    const panel = wrapper.get('#settings-panel-hooks');
    expect(panel.findAll('.listing-head').map((head) => head.text())).toEqual([
      'PreToolUse',
      'SessionStart',
    ]);
    // The matcher labels the row; a hook without one is the catch-all.
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual([
      'Bash',
      '*',
      '*',
    ]);
    expect(panel.text()).toContain('block-no-verify.sh');
    expect(panel.text()).toContain('30s timeout');
    expect(panel.text()).toContain('async');
  });

  it('says so when no hook is configured', async () => {
    const wrapper = mountDialog();
    await openTab(wrapper, 'Hooks');

    expect(wrapper.get('#settings-panel-hooks').text()).toContain('No hooks are configured');
  });
});

describe('SettingsDialog usage page', () => {
  const sessions = [
    {
      id: 'ses_1',
      model: 'Pythinker K2',
      usage: { inputTokens: 600, outputTokens: 400, turnCount: 3, totalCostUsd: 1.5 },
    },
    {
      id: 'ses_2',
      model: 'GPT-5',
      usage: { inputTokens: 800, outputTokens: 200, turnCount: 2, totalCostUsd: 0.75 },
    },
  ] as unknown as Parameters<typeof mountDialog>[0]['sessions'];

  it('totals tokens, sessions, turns and cost', async () => {
    const wrapper = mountDialog({ sessions });
    await openTab(wrapper, 'Usage stats');

    const values = wrapper.get('#settings-panel-usage').findAll('.stat-value').map((v) => v.text());
    expect(values).toEqual(['2k', '2', '5', '$2.25']);
  });

  it('splits the token share per model, largest first', async () => {
    const wrapper = mountDialog({ sessions });
    await openTab(wrapper, 'Usage stats');

    const panel = wrapper.get('#settings-panel-usage');
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual([
      'Pythinker K2',
      'GPT-5',
    ]);
    expect(panel.findAll('.listing-meta').map((meta) => meta.text())).toEqual(['50%', '50%']);
  });
});

describe('SettingsDialog plugins page', () => {
  const plugins = [
    {
      id: 'plg_1',
      displayName: 'Cloudflare',
      version: '1.2.0',
      enabled: true,
      state: 'loaded',
      skillCount: 3,
      mcpServerCount: 2,
      hasErrors: false,
      source: 'github',
    },
    {
      id: 'plg_2',
      displayName: 'Designer',
      enabled: false,
      state: 'disabled',
      skillCount: 1,
      mcpServerCount: 0,
      hasErrors: true,
      source: 'local',
    },
  ];

  it('loads plugins the first time the page is opened', async () => {
    const wrapper = mountDialog();
    await openTab(wrapper, 'Plugins');

    expect(wrapper.emitted('loadPlugins')).toHaveLength(1);
  });

  it('shows each plugin with its counts and toggles one', async () => {
    const wrapper = mountDialog({ plugins });
    await openTab(wrapper, 'Plugins');

    const panel = wrapper.get('#settings-panel-plugins');
    expect(panel.findAll('.listing-name').map((name) => name.text())).toEqual([
      'Cloudflare',
      'Designer',
    ]);
    expect(panel.text()).toContain('3 skills · 2 servers');
    expect(panel.text()).toContain('reported errors');
    // The disabled plugin's row recedes and its switch is off.
    expect(panel.findAll('.listing-row')[1]!.classes()).toContain('off');

    await panel.findAll('.switch')[1]!.trigger('click');
    expect(wrapper.emitted('setPluginEnabled')).toEqual([
      [{ pluginId: 'plg_2', enabled: true }],
    ]);
  });
});

describe('SettingsDialog subagents page', () => {
  const subagents = [
    {
      name: 'Explore',
      description: 'Read-only search agent',
      source: 'built-in' as const,
      tools: ['Read', 'Grep', 'Glob'],
      model: 'Pythinker K2',
      effort: 'max',
    },
  ];

  it('loads subagents the first time the page is opened', async () => {
    const wrapper = mountDialog();
    await openTab(wrapper, 'Subagents');

    expect(wrapper.emitted('loadSubagents')).toHaveLength(1);
  });

  it('shows the profile source, tool count, model and effort', async () => {
    const wrapper = mountDialog({ subagents });
    await openTab(wrapper, 'Subagents');

    const panel = wrapper.get('#settings-panel-subagents');
    expect(panel.get('.listing-name').text()).toBe('Explore');
    expect(panel.findAll('.tag').map((tag) => tag.text())).toEqual([
      'built-in',
      '3 tools',
      'max',
    ]);
    expect(panel.text()).toContain('Pythinker K2');
    expect(panel.text()).toContain('Read-only search agent');
  });
});
