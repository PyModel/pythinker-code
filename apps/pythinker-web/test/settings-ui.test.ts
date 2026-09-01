import type {
  AppExpertTalkPair,
  AppExpertTalkStatus,
  AppSubagentModelPolicy,
  AppSubagentModelPolicyState,
} from '../src/api/types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';

import {
  uiFontScaleForSize,
  uiFontScaleOptions,
  uiFontSizeForScale,
} from '../src/composables/client/useAppearance';
import { i18n } from '../src/i18n';
import { messages } from '../src/i18n/locales';
import ProviderForm from '../src/components/settings/ProviderForm.vue';
import ProvidersPanel from '../src/components/settings/ProvidersPanel.vue';
import SettingsDialog from '../src/components/settings/SettingsDialog.vue';
import { expertTalkContextKey } from '../src/composables/expertTalkContext';
import { useDiscussionPreferences } from '../src/composables/useDiscussionPreferences';
import { STORAGE_KEYS } from '../src/lib/storage';

const { api, confirm, copyTextToClipboard } = vi.hoisted(() => ({
  api: {
    listProviders: vi.fn().mockResolvedValue([]),
    listCatalogProviders: vi.fn().mockResolvedValue([]),
    addProvider: vi.fn(),
    deleteProvider: vi.fn(),
    getMeta: vi.fn(),
    getAuth: vi.fn().mockResolvedValue({ ready: true, defaultModel: 'x' }),
    getConfig: vi.fn().mockResolvedValue({}),
    listModels: vi.fn().mockResolvedValue([]),
    refreshAllProviders: vi.fn().mockResolvedValue({ refreshed: [], failed: [] }),
  },
  confirm: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));
vi.mock('../src/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm, current: { value: null } }),
}));
vi.mock('../src/lib/clipboard', () => ({ copyTextToClipboard }));

const secondaryModelPickerStub = defineComponent({
  name: 'SecondaryModelPicker',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true },
    effort: { type: String, required: true },
  },
  emits: ['select'],
  template: '<button v-bind="$attrs" type="button">{{ modelValue }} · {{ effort }}</button>',
});

describe('settings UI', () => {
  afterEach(() => {
    delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
    useDiscussionPreferences().setShowReasoning(true);
    localStorage.removeItem(STORAGE_KEYS.discussionReasoning);
  });

  it('re-reads auth readiness after a provider is saved, without a reload', async () => {
    api.listProviders.mockResolvedValue([
      {
        id: 'opencode-go',
        type: 'openai',
        hasApiKey: true,
        status: 'connected',
        models: ['opencode-go/model-a'],
      },
    ]);
    const wrapper = mount(ProvidersPanel, { global: { plugins: [i18n] } });
    await flushPromises();

    api.getAuth.mockClear();
    await wrapper.find('.providers-panel__row').trigger('click');
    await flushPromises();
    wrapper.findComponent(ProviderForm).vm.$emit('saved', 'opencode-go');
    await flushPromises();

    // Without this the setup gate stays up until the window is reloaded: the
    // daemon is ready but nothing asked it again.
    expect(api.getAuth).toHaveBeenCalled();
  });

  it('lists provider models and fires the delete intent', async () => {
    api.listProviders.mockResolvedValueOnce([
      {
        id: 'openai-local',
        type: 'OpenAI',
        baseUrl: 'http://127.0.0.1:8010/v1',
        hasApiKey: true,
        status: 'connected',
        models: ['gpt-test', 'gpt-fast'],
      },
    ]);
    confirm.mockImplementationOnce(async (options: { action: () => Promise<void> }) => {
      await options.action();
      return true;
    });
    const wrapper = mount(ProvidersPanel, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(wrapper.text()).toContain('OpenAI');
    expect(wrapper.text()).toContain('2 models');
    await wrapper.get('[data-testid="provider-openai-local-toggle"]').trigger('click');
    expect(wrapper.text()).toContain('gpt-test');
    await wrapper.get('[data-testid="provider-openai-local-delete"]').trigger('click');
    await flushPromises();

    expect(api.deleteProvider).toHaveBeenCalledWith('openai-local');
    wrapper.unmount();
  });

  it('renders the provider-unavailable state', async () => {
    api.listProviders.mockRejectedValueOnce(new Error('404'));
    const wrapper = mount(ProvidersPanel, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(wrapper.text()).toContain('The daemon does not support provider management yet');
    wrapper.unmount();
  });

  it('guards tab changes when the add-provider form has data', async () => {
    api.listCatalogProviders.mockResolvedValueOnce([
      {
        id: 'openai',
        name: 'OpenAI',
        needsBaseUrl: false,
        rejected: false,
        models: [{ id: 'gpt-test' }],
      },
    ]);
    confirm.mockResolvedValueOnce(false);
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        initialTab: 'providers',
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const addButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Add provider'));
    addButton!.click();
    await flushPromises();
    const apiKey = document.body.querySelector<HTMLInputElement>('input[type="password"]')!;
    apiKey.value = 'secret';
    apiKey.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    const generalTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'General');
    generalTab!.click();
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Unsaved changes',
      message: 'You have unsaved changes.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    }));
    wrapper.unmount();
  });

  it('keeps the newest /meta response when an older request resolves last', async () => {
    let resolveFirst: (meta: unknown) => void = () => {};
    api.getMeta.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        config: { providers: {} },
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    api.getMeta.mockResolvedValueOnce({ serverVersion: '2.0.0', serverId: 'newer', backend: 'v2' });
    await wrapper.setProps({ config: { providers: {}, experimental: {} } });
    await flushPromises();
    resolveFirst({ serverVersion: '1.0.0', serverId: 'older', backend: 'v2' });
    await flushPromises();

    expect(wrapper.vm.$.setupState.serverMeta.serverId).toBe('newer');
    wrapper.unmount();
  });

  it('copies app and server diagnostics', async () => {
    api.getMeta.mockResolvedValueOnce({
      serverVersion: '2.4.0',
      serverId: 'server-test',
      backend: 'v2',
    });
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      configurable: true,
      value: 'Pythinker Test Browser',
    });
    (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop = {
      platform: 'darwin',
      getUpdateState: vi.fn(() => Promise.resolve({
        status: 'idle',
        installedVersion: '9.8.7',
        autoUpdate: true,
        channel: 'stable',
        notifyUpdate: true,
      } satisfies DesktopUpdateState)),
      onUpdateState: vi.fn(() => () => {}),
    };
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const advancedTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Advanced');
    advancedTab!.click();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="copy-diagnostics"]')!.click();
    await flushPromises();

    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('App version: 9.8.7'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Server version: 2.4.0'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Backend: v2'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Server ID: server-test'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('User agent: Pythinker Test Browser'));
    wrapper.unmount();
  });

  it('keeps the standalone Update tab live through preferences, download, and restart', async () => {
    let state: DesktopUpdateState = {
      status: 'available',
      installedVersion: '1.0.0',
      availableVersion: '1.2.3',
      autoUpdate: true,
      channel: 'stable',
      notifyUpdate: true,
    };
    let push: ((next: DesktopUpdateState) => void) | undefined;
    const bridge = {
      platform: 'darwin',
      getUpdateState: vi.fn(() => Promise.resolve(state)),
      setAutoUpdate: vi.fn((enabled: boolean) => {
        state = { ...state, autoUpdate: enabled };
        return Promise.resolve(state);
      }),
      setUpdateChannel: vi.fn((channel: DesktopUpdateChannel) => {
        state = { ...state, channel };
        return Promise.resolve(state);
      }),
      setNotifyUpdate: vi.fn((enabled: boolean) => {
        state = { ...state, notifyUpdate: enabled };
        return Promise.resolve(state);
      }),
      checkForUpdates: vi.fn(() => Promise.resolve(state)),
      downloadUpdate: vi.fn(() => {
        state = { ...state, status: 'downloading', percent: 0, transferred: 0 };
        return Promise.resolve(state);
      }),
      skipUpdate: vi.fn(() => Promise.resolve(state)),
      undoSkippedUpdate: vi.fn(() => Promise.resolve(state)),
      markUpdateNotified: vi.fn(() => Promise.resolve(state)),
      acknowledgeCompletedUpdate: vi.fn(() => Promise.resolve(state)),
      openUpdateReleaseNotes: vi.fn(() => Promise.resolve(state)),
      restartToUpdate: vi.fn(() => Promise.resolve(state)),
      onUpdateState: vi.fn((callback: (next: DesktopUpdateState) => void) => {
        push = callback;
        return () => {};
      }),
      setThemeSource: vi.fn(),
    };
    (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop = bridge;
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        initialTab: 'advanced',
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const updateControls = document.body.querySelector<HTMLElement>('[data-testid="desktop-update-controls"]')!;
    expect(updateControls.closest<HTMLElement>('.panel')?.style.display).toBe('none');
    const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.settings-tabs [role="tab"]'));
    expect(tabs.slice(-2).map((tab) => tab.textContent?.trim())).toEqual(['Update', 'Advanced']);
    const updateTab = tabs.find((tab) => tab.textContent?.trim() === 'Update');
    expect(updateTab).toBeDefined();
    expect(updateTab!.querySelector('.ptx-update-icon')?.getAttribute('width')).toBe('14');
    updateTab!.click();
    await flushPromises();

    expect(updateControls.closest<HTMLElement>('.panel')?.style.display).not.toBe('none');
    expect(updateControls.textContent).toContain('Version 1.2.3 is available');
    expect(updateControls.textContent).toContain('Nightly follows the newest main build');
    const channel = document.body.querySelector<HTMLSelectElement>('[data-testid="desktop-update-channel"]')!;
    expect(channel.value).toBe('stable');
    channel.value = 'beta';
    channel.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('beta');

    const automaticChecks = document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-update-checks"]')!;
    expect(automaticChecks.getAttribute('aria-checked')).toBe('true');
    automaticChecks.click();
    await flushPromises();
    expect(bridge.setAutoUpdate).toHaveBeenCalledWith(false);

    const notifications = document.body.querySelector<HTMLButtonElement>('[data-testid="update-notifications"]')!;
    expect(notifications.getAttribute('aria-checked')).toBe('true');
    notifications.click();
    await flushPromises();
    expect(bridge.setNotifyUpdate).toHaveBeenCalledWith(false);

    document.body.querySelector<HTMLButtonElement>('[data-testid="settings-download-update"]')!.click();
    await flushPromises();
    state = {
      ...state,
      status: 'downloading',
      percent: 50,
      transferred: 5_000_000,
      total: 10_000_000,
      bytesPerSecond: 1_000_000,
    };
    push?.(state);
    await flushPromises();
    expect(document.body.querySelector('[data-testid="settings-update-progress"]')?.getAttribute('value')).toBe('50');
    expect(document.body.querySelector('[data-testid="settings-update-progress-detail"]')?.textContent).toContain('4.8 MB of 9.5 MB');
    expect(document.body.querySelector('[data-testid="settings-restart-update"]')).toBeNull();

    state = { ...state, status: 'downloaded', percent: 100 };
    push?.(state);
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="settings-restart-update"]')!.click();
    await flushPromises();
    expect(bridge.restartToUpdate).toHaveBeenCalledOnce();

    state = { ...state, status: 'idle', availableVersion: undefined };
    push?.(state);
    bridge.checkForUpdates.mockRejectedValueOnce(new Error('update service unavailable'));
    await flushPromises();
    updateControls.querySelector<HTMLButtonElement>('[data-testid="settings-check-update"]')!.click();
    await flushPromises();
    expect(updateControls.textContent).toContain('update service unavailable');

    wrapper.unmount();
  });

  it('uses the reference font-size presets', () => {
    expect(uiFontScaleOptions).toEqual([
      { value: 'small', label: 'S' },
      { value: 'medium', label: 'M' },
      { value: 'large', label: 'L' },
      { value: 'xlarge', label: 'XL' },
    ]);
    expect(['small', 'medium', 'large', 'xlarge'].map(uiFontSizeForScale)).toEqual([12, 14, 16, 18]);
    expect([12, 14, 16, 18].map(uiFontScaleForSize)).toEqual(['small', 'medium', 'large', 'xlarge']);
  });

  it('ships English as the only interface language', () => {
    expect(i18n.global.locale.value).toBe('en');
    expect(Object.keys(messages)).toEqual(['en']);
  });

  it('keeps a Discussion pair draft through status refreshes and saves role efforts', async () => {
    const currentStatus = ref<AppExpertTalkStatus>({
      feature: 'enabled' as const,
      resourceVersion: 'expert-opinion-v1',
      config: {
        fusionLeadModelId: 'provider-a/lead',
        peerModelId: 'provider-b/peer',
        fusionLeadThinkingEffort: 'high',
        peerThinkingEffort: 'low',
      },
      activation: { state: 'idle' as const },
      pairValidation: { state: 'valid' as const },
    });
    const configurePair = vi.fn(async (pair: AppExpertTalkPair) => {
      preferredPair.value = pair;
      currentStatus.value = {
        ...currentStatus.value,
        resourceVersion: 'expert-opinion-v2',
        config: pair,
      };
    });
    const preferredPair = ref<AppExpertTalkPair | undefined>(currentStatus.value.config ?? undefined);
    const useForNextMessage = vi.fn().mockResolvedValue(undefined);
    const context = {
      available: computed(() => true),
      preferredPair,
      status: computed(() => currentStatus.value),
      run: computed(() => undefined),
      runs: computed(() => []),
      busy: ref(false),
      error: ref<string>(),
      refresh: vi.fn().mockResolvedValue(undefined),
      configurePair,
      useForNextMessage,
      disarm: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      applyStatus: vi.fn(),
      armIdForSession: vi.fn(),
      promptAccepted: vi.fn(),
    };
    const flagState = {
      id: 'expert_talk',
      enabled: true,
      source: 'config' as const,
      configValue: true,
      defaultEnabled: false,
      externallyControlled: false,
      overridden: false,
    };
    api.getMeta.mockResolvedValueOnce({
      serverVersion: '2.0.0',
      serverId: 'expert-opinion-test',
      backend: 'v2',
      experimentalFlagStates: [flagState],
    });
    api.refreshAllProviders.mockClear();
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        backend: 'v2',
        config: { providers: {}, experimental: { expert_talk: true } },
        experimentalFlagStates: [flagState],
        models: [
          { id: 'provider-a/lead', provider: 'Provider A', model: 'Lead', maxContextSize: 128_000, capabilities: ['tool_use', 'thinking'], supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
          { id: 'provider-b/peer', provider: 'Provider B', model: 'Peer', maxContextSize: 128_000, capabilities: ['tool-use', 'thinking'], supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
          { id: 'provider-c/other', provider: 'Provider C', model: 'Other', maxContextSize: 128_000, capabilities: ['tool_use', 'thinking'], supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
          { id: 'provider-d/text', provider: 'Provider D', model: 'Text only', maxContextSize: 128_000, capabilities: [] },
        ],
      },
      global: {
        plugins: [i18n],
        provide: { [expertTalkContextKey as symbol]: context },
        stubs: { SecondaryModelPicker: secondaryModelPickerStub },
      },
    });
    await flushPromises();
    const tab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((item) => item.textContent?.trim() === 'Discussion');
    tab!.click();
    await flushPromises();

    expect(api.refreshAllProviders).toHaveBeenCalledOnce();
    const panel = document.body.querySelector<HTMLElement>('[data-testid="expert-opinion-settings"]')!;
    expect(panel.style.display).not.toBe('none');
    expect(panel.textContent).toContain('two-expert Fusion workflow');
    expect(panel.textContent).toContain('Fusion Lead');
    expect(panel.textContent).toContain('Peer Expert');
    const reasoningToggle = panel.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Show reasoning stream"]',
    )!;
    expect(reasoningToggle.getAttribute('aria-checked')).toBe('true');
    reasoningToggle.click();
    await flushPromises();
    expect(useDiscussionPreferences().showReasoning.value).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.discussionReasoning)).toBe('false');
    const pickers = wrapper.findAllComponents(secondaryModelPickerStub);
    expect(pickers).toHaveLength(2);
    expect(pickers[0]!.props()).toMatchObject({
      modelValue: 'provider-a/lead',
      effort: 'high',
    });
    expect(pickers[1]!.props()).toMatchObject({
      modelValue: 'provider-b/peer',
      effort: 'low',
    });

    pickers[1]!.vm.$emit('select', { model: 'provider-c/other', effort: 'max' });
    await flushPromises();
    currentStatus.value = {
      ...currentStatus.value,
      resourceVersion: 'expert-opinion-progress',
      config: {
        fusionLeadModelId: 'provider-a/lead',
        peerModelId: 'provider-b/peer',
        fusionLeadThinkingEffort: 'high',
        peerThinkingEffort: 'low',
      },
    };
    await flushPromises();
    expect(pickers[1]!.props()).toMatchObject({
      modelValue: 'provider-c/other',
      effort: 'max',
    });
    panel.querySelector<HTMLButtonElement>('[data-testid="expert-opinion-save"]')!.click();
    await flushPromises();
    expect(configurePair).toHaveBeenCalledWith({
      fusionLeadModelId: 'provider-a/lead',
      peerModelId: 'provider-c/other',
      fusionLeadThinkingEffort: 'high',
      peerThinkingEffort: 'max',
    });
    expect(useForNextMessage).not.toHaveBeenCalled();

    currentStatus.value = {
      ...currentStatus.value,
      resourceVersion: 'expert-opinion-empty',
      config: null,
      pairValidation: { state: 'invalid', reason: 'Select two different models.' },
    };
    await flushPromises();
    expect(pickers[0]!.props()).toMatchObject({
      modelValue: 'provider-a/lead',
      effort: 'high',
    });
    expect(pickers[1]!.props()).toMatchObject({
      modelValue: 'provider-c/other',
      effort: 'max',
    });

    preferredPair.value = undefined;
    await flushPromises();
    expect(pickers.map((picker) => picker.props('modelValue'))).toEqual(['', '']);
    expect(panel.querySelector<HTMLButtonElement>('[data-testid="expert-opinion-save"]')?.disabled).toBe(true);
    expect(panel.textContent).not.toContain('Select two different models.');

    pickers[0]!.vm.$emit('select', { model: 'provider-a/lead', effort: 'max' });
    pickers[1]!.vm.$emit('select', { model: 'provider-b/peer', effort: 'high' });
    await flushPromises();
    expect(panel.textContent).not.toContain('Select two different models.');
    expect(panel.querySelector<HTMLButtonElement>('[data-testid="expert-opinion-save"]')?.disabled).toBe(false);
    panel.querySelector<HTMLButtonElement>('[data-testid="expert-opinion-save"]')!.click();
    await flushPromises();
    expect(configurePair).toHaveBeenLastCalledWith({
      fusionLeadModelId: 'provider-a/lead',
      peerModelId: 'provider-b/peer',
      fusionLeadThinkingEffort: 'max',
      peerThinkingEffort: 'high',
    });

    const enabled = panel.querySelector<HTMLButtonElement>('[data-testid="expert-opinion-enabled"]')!;
    enabled.click();
    await flushPromises();
    expect(wrapper.emitted('updateConfig')?.at(-1)?.[0]).toEqual({
      experimental: { expert_talk: false },
    });
    await wrapper.setProps({ config: { providers: {}, experimental: { expert_talk: false } } });
    enabled.click();
    await flushPromises();
    expect(wrapper.emitted('updateConfig')?.at(-1)?.[0]).toEqual({
      experimental: { expert_talk: true },
    });
    wrapper.unmount();
  });

  it('shows the Pythinker logo beside the empty-conversation heading', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const conversation = readFileSync(join(webRoot, 'src/components/chat/ConversationPane.vue'), 'utf8');

    expect(conversation).toContain('<PythinkerLogo v-else size="md"');
  });

  it('renders the Lab tab toggles and writes them via config.experimental', async () => {
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        conversationToc: false,
        config: {
          providers: {},
          experimental: { sidebarTabs: true },
        },
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const labTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Lab');
    labTab!.click();
    await flushPromises();

    const sidebarTabs = document.body.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Multi-tab sidebar"]');
    const secondaryModel = document.body.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Secondary model for subagents"]');
    const promptAnchors = document.body.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Chat prompt anchors"]');
    expect(sidebarTabs?.getAttribute('aria-checked')).toBe('true');
    expect(secondaryModel?.getAttribute('aria-checked')).toBe('false');
    expect(promptAnchors?.closest<HTMLElement>('.panel')?.style.display).not.toBe('none');
    expect(promptAnchors?.getAttribute('aria-checked')).toBe('false');
    promptAnchors!.click();
    await flushPromises();
    expect(wrapper.emitted('setConversationToc')?.at(-1)).toEqual([true]);
    secondaryModel!.click();
    await flushPromises();
    const emitted = wrapper.emitted('updateConfig');
    expect(emitted?.at(-1)?.[0]).toEqual({ experimental: { sidebarTabs: true, 'secondary-model': true } });
    wrapper.unmount();
  });

  it('shows Lab chips from the effective flag state, each independently', async () => {
    const flagState = (
      overrides: Partial<{ source: 'env' | 'config' | 'default'; externallyControlled: boolean; overridden: boolean }>,
    ) => ({
      id: 'secondary-model',
      enabled: true,
      source: 'config' as const,
      configValue: true,
      defaultEnabled: false,
      externallyControlled: false,
      overridden: false,
      ...overrides,
    });
    const mountWith = (states: ReturnType<typeof flagState>[]) =>
      mount(SettingsDialog, {
        props: {
          colorScheme: 'system',
          accent: 'blue',
          uiFontSize: 14,
          authReady: true,
          notify: false,
          notifyQuestion: false,
          notifyApproval: false,
          sound: false,
          config: { providers: {}, experimental: { 'secondary-model': false } },
          experimentalFlagStates: states,
        },
        global: { plugins: [i18n] },
      });
    const chipsFor = (root: HTMLElement) =>
      Array.from(root.querySelectorAll<HTMLElement>('.flag-chip')).map((chip) => chip.textContent?.trim());
    const rowFor = () =>
      document.body
        .querySelector<HTMLElement>('[role="switch"][aria-label="Secondary model for subagents"]')!
        .closest<HTMLElement>('.row')!;

    let wrapper = mountWith([flagState({ source: 'env', externallyControlled: true, overridden: true })]);
    await flushPromises();
    expect(chipsFor(rowFor())).toEqual(['Environment controlled', 'Saved setting overridden']);
    wrapper.unmount();

    wrapper = mountWith([flagState({ source: 'env', externallyControlled: true, overridden: false })]);
    await flushPromises();
    expect(chipsFor(rowFor())).toEqual(['Environment controlled']);
    wrapper.unmount();

    wrapper = mountWith([flagState({ source: 'config' })]);
    await flushPromises();
    expect(chipsFor(rowFor())).toEqual([]);
    wrapper.unmount();
  });

  function policyState(
    policy: AppSubagentModelPolicy,
    overrides: Partial<AppSubagentModelPolicyState> = {},
  ): AppSubagentModelPolicyState {
    return {
      policy,
      resourceVersion: 'subagent-policy-v1:aaa',
      configuredPolicy: policy,
      effectivePolicy: policy,
      policySource: policy.mode === 'inherit' ? 'default' : 'config',
      feature: { enabled: true, source: 'config' },
      ...overrides,
    };
  }

  function mountRouting(state: AppSubagentModelPolicyState | null) {
    return mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        config: { providers: {}, defaultModel: 'test/main', experimental: { 'secondary-model': true } },
        models: [
          { id: 'test/main', provider: 'test', model: 'main', maxContextSize: 100_000 },
          { id: 'test/fast', provider: 'test', model: 'fast', maxContextSize: 100_000 },
        ],
        subagentModelPolicy: state,
      },
      global: { plugins: [i18n] },
    });
  }

  async function openAgentTab(): Promise<void> {
    await flushPromises();
    const agentTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Agent');
    agentTab!.click();
    await flushPromises();
  }

  function radio(mode: string): HTMLInputElement {
    return document.body.querySelector<HTMLInputElement>(`input[name="subagent-routing-mode"][value="${mode}"]`)!;
  }

  it('shows the routing section only once the policy state is loaded, after the default model', async () => {
    const without = mountRouting(null);
    await openAgentTab();
    expect(document.body.querySelector('[data-testid="subagent-routing"]')).toBeNull();
    without.unmount();

    const wrapper = mountRouting(policyState({ mode: 'inherit' }));
    try {
      await openAgentTab();
      const agentPanel = Array.from(document.body.querySelectorAll<HTMLElement>('.panel'))
        .find((panel) => panel.textContent?.includes('Agent defaults'))!;
      const text = agentPanel.textContent ?? '';
      expect(text.indexOf('Default model')).toBeLessThan(text.indexOf('Subagent Model Routing'));
      expect(text.indexOf('Subagent Model Routing')).toBeLessThan(text.indexOf('Default permission'));
      expect(radio('inherit').checked).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });

  it('emits one payload per mode: inherit clears, default and force carry the picked model, pool carries the models', async () => {
    const wrapper = mountRouting(policyState({ mode: 'default', defaultModel: 'test/fast', defaultEffort: 'max' }));
    try {
      await openAgentTab();
      expect(radio('default').checked).toBe(true);

      radio('force').click();
      await flushPromises();
      expect(wrapper.emitted('saveSubagentModelPolicy')?.at(-1)?.[0]).toEqual({
        mode: 'force',
        defaultModel: 'test/fast',
        defaultEffort: 'max',
      });

      radio('pool').click();
      await flushPromises();
      expect(wrapper.emitted('saveSubagentModelPolicy')?.at(-1)?.[0]).toEqual({
        mode: 'pool',
        defaultModel: 'test/fast',
        models: { 'test/fast': '' },
        defaultEffort: 'max',
      });
      const mainCheckbox = document.body.querySelector<HTMLInputElement>('[data-testid="routing-pool"] input[value="test/main"]')!;
      mainCheckbox.click();
      await flushPromises();
      expect(wrapper.emitted('saveSubagentModelPolicy')?.at(-1)?.[0]).toEqual({
        mode: 'pool',
        defaultModel: 'test/fast',
        models: { 'test/fast': '', 'test/main': '' },
        defaultEffort: 'max',
      });

      radio('inherit').click();
      await flushPromises();
      expect(wrapper.emitted('clearSubagentModelPolicy')).toHaveLength(1);
      expect(wrapper.emitted('updateConfig')).toBeUndefined();
    } finally {
      wrapper.unmount();
    }
  });

  it('shows the saved policy next to the effective routing and names a disabled feature', async () => {
    const wrapper = mountRouting(
      policyState(
        { mode: 'force', defaultModel: 'test/fast' },
        { effectivePolicy: { mode: 'inherit' }, policySource: 'default', feature: { enabled: false, source: 'default' } },
      ),
    );
    try {
      await openAgentTab();
      expect(document.body.querySelector('[data-testid="saved-policy"]')?.textContent?.trim()).toBe('Force · fast');
      expect(document.body.querySelector('[data-testid="effective-policy"]')?.textContent?.trim()).toBe('Inherit agent model');
      expect(document.body.querySelector('[data-testid="feature-disabled"]')).not.toBeNull();
    } finally {
      wrapper.unmount();
    }

    const enabled = mountRouting(policyState({ mode: 'pool', defaultModel: 'test/fast', models: { 'test/fast': '', 'test/main': '' } }));
    try {
      await openAgentTab();
      expect(document.body.querySelector('[data-testid="effective-policy"]')?.textContent?.trim()).toBe('Pool · 2 models · default fast');
      expect(document.body.querySelector('[data-testid="feature-disabled"]')).toBeNull();
    } finally {
      enabled.unmount();
    }
  });

  it('emits setAccent with mono when the Black accent option is picked', async () => {
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        config: { providers: {} },
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const black = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Black');
    expect(black).toBeDefined();
    black!.click();
    await flushPromises();

    expect(wrapper.emitted('setAccent')?.at(-1)).toEqual(['mono']);
    wrapper.unmount();
  });

  it('ships mono-accent CSS for every color-scheme path', () => {
    // Regression guard: useAppearance sets html[data-accent], which only has
    // an effect while style.css actually remaps the accent tokens for it.
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const css = readFileSync(join(webRoot, 'src/style.css'), 'utf8');

    expect(css).toContain('html[data-accent=mono]');
    expect(css).toContain('html[data-color-scheme=dark][data-accent=mono]');
    expect(css).toContain('html[data-color-scheme=system][data-accent=mono]');
  });

  it('keeps secondary model menus opaque', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const picker = readFileSync(
      join(webRoot, 'src/components/settings/SecondaryModelPicker.vue'),
      'utf8',
    );

    expect(picker.match(/background: var\(--color-surface-raised\);/gu)).toHaveLength(2);
    expect(picker).not.toContain('--color-menu-bg-frost');
    expect(picker).not.toContain('backdrop-filter');
  });

  it('exposes the message folding switches and reports both toggles', async () => {
    const wrapper = mount(SettingsDialog, {
      props: {
        colorScheme: 'system',
        accent: 'blue',
        uiFontSize: 14,
        authReady: true,
        notify: false,
        notifyQuestion: false,
        notifyApproval: false,
        sound: false,
        turnFolding: true,
        activityRunFolding: false,
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    const sections = Array.from(document.body.querySelectorAll<HTMLElement>('.sec'));
    const folding = sections.find(
      (node) => node.querySelector('.sec-title')?.textContent?.trim() === 'Message folding',
    );
    expect(folding).toBeDefined();

    const rows = Array.from(folding!.querySelectorAll<HTMLElement>('.row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.rlabel')?.textContent).toContain('Auto-fold messages');
    expect(rows[1]!.querySelector('.rlabel')?.textContent).toContain('Tool call summary');

    const toggles = Array.from(folding!.querySelectorAll<HTMLElement>('.ui-switch'));
    expect(toggles).toHaveLength(2);
    toggles[0]!.click();
    toggles[1]!.click();
    await flushPromises();

    expect(wrapper.emitted('setTurnFolding')?.at(-1)).toEqual([false]);
    expect(wrapper.emitted('setActivityRunFolding')?.at(-1)).toEqual([true]);
    wrapper.unmount();
  });

});
