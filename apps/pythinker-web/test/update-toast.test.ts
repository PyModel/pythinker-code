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
  percent?: number;
  message?: string;
  autoUpdate: boolean;
};

function installBridge(state: UpdateState) {
  let push: ((next: UpdateState) => void) | undefined;
  const bridge = {
    platform: 'darwin',
    getUpdateState: vi.fn(() => Promise.resolve(state)),
    setAutoUpdate: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(state)),
    quitAndInstall: vi.fn(() => Promise.resolve(state)),
    setThemeSource: vi.fn(),
    onUpdateState: vi.fn((cb: (next: UpdateState) => void) => {
      push = cb;
      return () => {};
    }),
    /** Replay a main-process state event, as the preload bridge would. */
    emit: async (next: UpdateState) => {
      push?.(next);
      await nextTick();
    },
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

  it('announces an update that is downloading automatically', async () => {
    installBridge({ status: 'available', version: '1.2.3', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.get('.title').text()).toContain('1.2.3');
    expect(wrapper.get('.msg').text()).toBe(enUpdate.downloading);
  });

  it('reports download progress instead of staying silent', async () => {
    installBridge({ status: 'downloading', version: '1.2.3', percent: 41.6, autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.get('.msg').text()).toContain('42');
    // A download in flight cannot be installed yet.
    expect(wrapper.get('.go').attributes('disabled')).toBeDefined();
  });

  it('prompts to restart once the update is downloaded', async () => {
    const bridge = installBridge({ status: 'downloaded', version: '1.2.3', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.get('.title').text()).toContain('1.2.3');
    expect(wrapper.get('.msg').text()).toBe(enUpdate.restart);
    expect(wrapper.get('.go').text()).toBe(enUpdate.install);
    await wrapper.get('.go').trigger('click');
    expect(bridge.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('starts the complete update flow when automatic downloads are off', async () => {
    const bridge = installBridge({ status: 'available', version: '1.2.3', autoUpdate: false });
    const wrapper = await mountToast();
    expect(wrapper.get('.msg').text()).toBe(enUpdate.prompt);
    expect(wrapper.get('.go').text()).toBe(enUpdate.install);
    await wrapper.get('.go').trigger('click');
    expect(bridge.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('keeps reporting the download the user started from the prompt', async () => {
    const bridge = installBridge({ status: 'available', version: '1.2.3', autoUpdate: false });
    const wrapper = await mountToast();
    await wrapper.get('.go').trigger('click');
    await bridge.emit({ status: 'downloading', version: '1.2.3', percent: 12, autoUpdate: false });

    expect(wrapper.find('.update-toast').exists()).toBe(true);
    expect(wrapper.get('.msg').text()).toContain('12');
    expect(wrapper.get('.go').attributes('disabled')).toBeDefined();
  });

  it('stays silent for an idle or disabled updater', async () => {
    installBridge({ status: 'idle', autoUpdate: true });
    expect((await mountToast()).find('.update-toast').exists()).toBe(false);
  });

  it('keeps a failed check quiet until an update is actually found', async () => {
    const bridge = installBridge({ status: 'error', message: 'offline', autoUpdate: true });
    const wrapper = await mountToast();
    expect(wrapper.find('.update-toast').exists()).toBe(false);

    await bridge.emit({ status: 'available', version: '1.2.3', autoUpdate: true });
    await bridge.emit({ status: 'error', message: 'signature mismatch', autoUpdate: true });
    expect(wrapper.get('.title').text()).toBe(enUpdate.failed);
    expect(wrapper.get('.msg').text()).toBe('signature mismatch');
    expect(wrapper.get('.go').text()).toBe(enUpdate.retry);

    await wrapper.get('.go').trigger('click');
    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('dismisses a failure without skipping the version', async () => {
    const bridge = installBridge({ status: 'idle', autoUpdate: true });
    const wrapper = await mountToast();
    await bridge.emit({ status: 'available', version: '1.2.3', autoUpdate: true });
    await bridge.emit({ status: 'error', message: 'download failed', autoUpdate: true });

    await wrapper.get('.skip').trigger('click');
    expect(wrapper.find('.update-toast').exists()).toBe(false);
    expect(localStorage.getItem('pythinker.update.skipped')).toBeNull();

    await bridge.emit({ status: 'downloaded', version: '1.2.3', autoUpdate: true });
    expect(wrapper.find('.update-toast').exists()).toBe(true);
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
