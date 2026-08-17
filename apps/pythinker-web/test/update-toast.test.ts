import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import UpdateToast from '../src/components/UpdateToast.vue';
import enSettings from '../src/i18n/locales/en/settings';
import enUpdate from '../src/i18n/locales/en/update';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { settings: enSettings, update: enUpdate } },
});

type UpdateState = {
  status: string;
  version?: string;
  autoUpdate: boolean;
};

function installBridge(state: UpdateState) {
  const bridge = {
    platform: 'darwin',
    getUpdateState: vi.fn(() => Promise.resolve(state)),
    setAutoUpdate: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(state)),
    quitAndInstall: vi.fn(() => Promise.resolve(state)),
    setThemeSource: vi.fn(),
    onUpdateState: vi.fn(() => () => {}),
  };
  (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop = bridge;
  return bridge;
}

async function mountToast() {
  const wrapper = mount(UpdateToast, { global: { plugins: [i18n] } });
  await nextTick();
  await nextTick();
  return wrapper;
}

afterEach(() => {
  delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('UpdateToast', () => {
  it('renders nothing without the desktop bridge', async () => {
    const wrapper = await mountToast();
    expect(wrapper.find('.update-toast').exists()).toBe(false);
  });

  it('stays hidden while an update downloads', async () => {
    installBridge({ status: 'downloading', version: '1.2.3', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.find('.update-toast').exists()).toBe(false);
  });

  it('prompts to restart once the update is downloaded', async () => {
    const bridge = installBridge({ status: 'downloaded', version: '1.2.3', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.get('.title').text()).toContain('1.2.3');
    expect(wrapper.get('.go').text()).toBe(enSettings.desktop.restartToUpdate);
    await wrapper.get('.go').trigger('click');
    expect(bridge.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('offers a manual download when automatic updates are off', async () => {
    const bridge = installBridge({ status: 'available', version: '1.2.3', autoUpdate: false });
    const wrapper = await mountToast();
    expect(wrapper.get('.go').text()).toBe(enUpdate.download);
    await wrapper.get('.go').trigger('click');
    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('hides the prompt and remembers the skipped version', async () => {
    installBridge({ status: 'downloaded', version: '1.2.3', autoUpdate: true });
    const wrapper = await mountToast();
    await wrapper.get('.skip').trigger('click');
    expect(wrapper.find('.update-toast').exists()).toBe(false);
    expect(localStorage.getItem('pythinker.update.skipped')).toBe('["1.2.3"]');

    const second = await mountToast();
    expect(second.find('.update-toast').exists()).toBe(false);
  });

  it('still prompts for a different version after a skip', async () => {
    localStorage.setItem('pythinker.update.skipped', '["1.2.3"]');
    installBridge({ status: 'downloaded', version: '1.3.0', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.find('.update-toast').exists()).toBe(true);
  });
});
