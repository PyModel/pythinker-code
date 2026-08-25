import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

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
  },
  confirm: vi.fn(),
  copyTextToClipboard: vi.fn(),
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));
vi.mock('../src/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm, current: { value: null } }),
}));
vi.mock('../src/lib/clipboard', () => ({ copyTextToClipboard }));

describe('settings UI', () => {
  afterEach(() => {
    delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
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

  it('shows the subagent model section only while the secondary-model flag is on', async () => {
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
    const agentTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === 'Agent');
    agentTab!.click();
    await flushPromises();
    expect(document.body.textContent).not.toContain('Subagent model');

    await wrapper.setProps({
      config: { providers: {}, experimental: { 'secondary-model': true } },
    });
    await flushPromises();
    expect(document.body.textContent).toContain('Subagent model');
    wrapper.unmount();
  });

  it('places subagent model after the default model and clears a defaultModel-only override', async () => {
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
        config: {
          providers: {},
          defaultModel: 'test/main',
          secondaryModel: { defaultModel: 'test/fast' },
          experimental: { 'secondary-model': true },
        },
        models: [
          { id: 'test/main', provider: 'test', model: 'main', maxContextSize: 100_000 },
          { id: 'test/fast', provider: 'test', model: 'fast', maxContextSize: 100_000 },
        ],
      },
      global: { plugins: [i18n] },
    });
    try {
      await flushPromises();
      const agentTab = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        .find((tab) => tab.textContent?.trim() === 'Agent');
      agentTab!.click();
      await flushPromises();

      const agentPanel = Array.from(document.body.querySelectorAll<HTMLElement>('.panel'))
        .find((panel) => panel.textContent?.includes('Agent defaults'))!;
      const text = agentPanel.textContent ?? '';
      expect(text.indexOf('Default model')).toBeLessThan(text.indexOf('Subagents'));
      expect(text.indexOf('Subagents')).toBeLessThan(text.indexOf('Default permission'));

      document.body.querySelector<HTMLButtonElement>('.sm-picker__trigger')!.click();
      await flushPromises();
      const inherit = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.sm-picker__option'))
        .find((option) => option.textContent?.includes('Inherit agent model'));
      expect(inherit).toBeDefined();
      inherit!.click();
      await flushPromises();

      expect(wrapper.emitted('updateConfig')?.at(-1)?.[0]).toEqual({ secondaryModel: null });
    } finally {
      wrapper.unmount();
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
});
