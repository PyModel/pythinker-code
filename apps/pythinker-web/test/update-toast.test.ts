import { flushPromises, mount } from '@vue/test-utils';
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

function updateState(patch: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    status: 'idle',
    installedVersion: '1.0.0',
    autoUpdate: true,
    ...patch,
  };
}

function installBridge(initial: DesktopUpdateState) {
  let current = initial;
  let push: ((next: DesktopUpdateState) => void) | undefined;
  const bridge = {
    platform: 'darwin',
    getUpdateState: vi.fn(() => Promise.resolve(current)),
    setAutoUpdate: vi.fn(() => Promise.resolve(current)),
    checkForUpdates: vi.fn(() => Promise.resolve(current)),
    downloadUpdate: vi.fn(() => {
      current = { ...current, status: 'downloading', percent: 0, transferred: 0 };
      return Promise.resolve(current);
    }),
    skipUpdate: vi.fn((version: string) => {
      current = { ...current, status: 'skipped', skippedVersion: version };
      return Promise.resolve(current);
    }),
    undoSkippedUpdate: vi.fn(() => Promise.resolve(current)),
    markUpdateNotified: vi.fn((version: string) => {
      current = { ...current, notifiedVersion: version };
      return Promise.resolve(current);
    }),
    acknowledgeCompletedUpdate: vi.fn((version: string) => {
      current = current.completedVersion === version
        ? { ...current, completedVersion: undefined }
        : current;
      return Promise.resolve(current);
    }),
    openUpdateReleaseNotes: vi.fn(() => Promise.resolve(current)),
    restartToUpdate: vi.fn(() => Promise.resolve(current)),
    setThemeSource: vi.fn(),
    onUpdateState: vi.fn((cb: (next: DesktopUpdateState) => void) => {
      push = cb;
      return () => {};
    }),
    emit: async (next: DesktopUpdateState) => {
      current = next;
      push?.(next);
      await nextTick();
    },
  };
  (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop = bridge;
  return bridge;
}

async function mountToast() {
  const wrapper = mount(UpdateToast, { global: { plugins: [i18n] } });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
  vi.restoreAllMocks();
});

describe('UpdateToast', () => {
  it('renders nothing without the desktop bridge', async () => {
    const wrapper = await mountToast();
    expect(wrapper.find('[data-testid="update-toast"]').exists()).toBe(false);
  });

  it('prompts once per available version with explicit actions', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const wrapper = await mountToast();

    expect(wrapper.get('[data-testid="update-toast"]').text()).toContain('1.2.3');
    expect(wrapper.get('[data-testid="download-update"]').text()).toBe('Download update');
    expect(wrapper.get('[data-testid="skip-update"]').text()).toBe('Skip this version');
    expect(wrapper.get('[data-testid="view-update-notes"]').text()).toBe('View notes');
    expect(bridge.markUpdateNotified).toHaveBeenCalledWith('1.2.3');

    wrapper.unmount();
    installBridge(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      notifiedVersion: '1.2.3',
    }));
    expect((await mountToast()).find('[data-testid="update-toast"]').exists()).toBe(false);
  });

  it('closing the toast does not skip the version', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const wrapper = await mountToast();

    await wrapper.get('[aria-label="Dismiss update notification"]').trigger('click');

    expect(wrapper.find('[data-testid="update-toast"]').exists()).toBe(false);
    expect(bridge.skipUpdate).not.toHaveBeenCalled();
  });

  it('skips only the exact available version', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const wrapper = await mountToast();

    await wrapper.get('[data-testid="skip-update"]').trigger('click');
    await flushPromises();

    expect(bridge.skipUpdate).toHaveBeenCalledWith('1.2.3');
    expect(wrapper.find('[data-testid="update-toast"]').exists()).toBe(false);

    await bridge.emit(updateState({
      status: 'available',
      availableVersion: '1.2.4',
      notifiedVersion: '1.2.3',
      skippedVersion: '1.2.3',
    }));
    expect(wrapper.find('[data-testid="update-toast"]').exists()).toBe(true);
  });

  it('shows live download progress after the user accepts the download', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const wrapper = await mountToast();

    await wrapper.get('[data-testid="download-update"]').trigger('click');
    await flushPromises();
    await bridge.emit(updateState({
      status: 'downloading',
      availableVersion: '1.2.3',
      notifiedVersion: '1.2.3',
      percent: 42.5,
      transferred: 4_250_000,
      total: 10_000_000,
      bytesPerSecond: 1_250_000,
    }));

    const progress = wrapper.get<HTMLProgressElement>('[data-testid="update-progress"]');
    expect(progress.attributes('value')).toBe('42.5');
    expect(wrapper.get('[data-testid="update-progress-detail"]').text()).toContain('43%');
    expect(wrapper.get('[data-testid="update-progress-detail"]').text()).toContain('4.1 MB of 9.5 MB');
    expect(wrapper.get('[data-testid="update-progress-detail"]').text()).toContain('1.2 MB/s');
    expect(wrapper.find('[data-testid="restart-to-update"]').exists()).toBe(false);
  });

  it('offers Later or Restart only after the download completes', async () => {
    const bridge = installBridge(updateState({
      status: 'downloaded',
      availableVersion: '1.2.3',
    }));
    const wrapper = await mountToast();

    expect(wrapper.get('[data-testid="later-update"]').text()).toBe('Later');
    expect(wrapper.get('[data-testid="restart-to-update"]').text()).toBe('Restart to update');
    await wrapper.get('[data-testid="restart-to-update"]').trigger('click');
    expect(bridge.restartToUpdate).toHaveBeenCalledOnce();
  });

  it('shows and acknowledges one verified completion receipt', async () => {
    const bridge = installBridge(updateState({ completedVersion: '1.2.3' }));
    const wrapper = await mountToast();

    expect(wrapper.get('[data-testid="update-toast"]').text()).toContain('Updated to Pythinker v1.2.3');
    expect(bridge.acknowledgeCompletedUpdate).toHaveBeenCalledWith('1.2.3');
  });

  it('keeps background check errors quiet but reports a failed accepted download', async () => {
    const bridge = installBridge(updateState({ status: 'error', message: 'offline' }));
    const wrapper = await mountToast();
    expect(wrapper.find('[data-testid="update-toast"]').exists()).toBe(false);

    await bridge.emit(updateState({ status: 'available', availableVersion: '1.2.3' }));
    await bridge.emit(updateState({
      status: 'error',
      availableVersion: '1.2.3',
      notifiedVersion: '1.2.3',
      message: 'background check is offline',
    }));
    expect(wrapper.get('[data-testid="update-toast"]').text()).toContain('Download update');
    expect(wrapper.get('[data-testid="update-toast"]').text()).not.toContain('background check is offline');

    await bridge.emit(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      notifiedVersion: '1.2.3',
    }));
    await wrapper.get('[data-testid="download-update"]').trigger('click');
    await bridge.emit(updateState({
      status: 'error',
      availableVersion: '1.2.3',
      notifiedVersion: '1.2.3',
      message: 'signature mismatch',
    }));

    expect(wrapper.get('[data-testid="update-toast"]').text()).toContain('signature mismatch');
    expect(wrapper.get('[data-testid="retry-update"]').text()).toBe('Retry download');
    await wrapper.get('[data-testid="retry-update"]').trigger('click');
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(2);
  });
});
