import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import {
  uiFontScaleForSize,
  uiFontScaleOptions,
  uiFontSizeForScale,
} from '../src/composables/client/useAppearance';
import { i18n } from '../src/i18n';
import { messages } from '../src/i18n/locales';
import ProvidersPanel from '../src/components/settings/ProvidersPanel.vue';
import SettingsDialog from '../src/components/settings/SettingsDialog.vue';

const { api, confirm, copyTextToClipboard } = vi.hoisted(() => ({
  api: {
    listProviders: vi.fn().mockResolvedValue([]),
    listCatalogProviders: vi.fn().mockResolvedValue([]),
    addProvider: vi.fn(),
    deleteProvider: vi.fn(),
    getMeta: vi.fn(),
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
      .find((tab) => tab.textContent === 'General');
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
      .find((tab) => tab.textContent === 'Advanced');
    advancedTab!.click();
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="copy-diagnostics"]')!.click();
    await flushPromises();

    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('App version:'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Server version: 2.4.0'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Backend: v2'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('Server ID: server-test'));
    expect(copyTextToClipboard).toHaveBeenCalledWith(expect.stringContaining('User agent: Pythinker Test Browser'));
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

  it('keeps Dynamic Workflow agent-driven', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const composer = readFileSync(join(webRoot, 'src/components/chat/Composer.vue'), 'utf8');
    expect(composer).not.toContain('toggleDynamicWorkflow');
    expect(composer).not.toContain('dynamicWorkflowMode');
  });

  it('shows the Pythinker logo beside the empty-conversation heading', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const conversation = readFileSync(join(webRoot, 'src/components/chat/ConversationPane.vue'), 'utf8');

    expect(conversation).toContain('<PythinkerLogo v-else size="md"');
  });
});
