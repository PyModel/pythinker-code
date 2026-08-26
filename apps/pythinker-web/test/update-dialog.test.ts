import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Sidebar from '../src/components/Sidebar.vue';
import UpdateDialog from '../src/components/UpdateDialog.vue';
import {
  formatUpdateBytes,
  resetDesktopUpdateStateForTests,
  useDesktopUpdate,
} from '../src/composables/useDesktopUpdate';
import enSettings from '../src/i18n/locales/en/settings';
import enSidebar from '../src/i18n/locales/en/sidebar';
import enUpdate from '../src/i18n/locales/en/update';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { settings: enSettings, sidebar: enSidebar, update: enUpdate } },
});

function updateState(patch: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    status: 'idle',
    installedVersion: '1.0.0',
    autoUpdate: true,
    channel: 'stable',
    notifyUpdate: true,
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
    setUpdateChannel: vi.fn(() => Promise.resolve(current)),
    setNotifyUpdate: vi.fn(() => Promise.resolve(current)),
    checkForUpdates: vi.fn(() => Promise.resolve(current)),
    downloadUpdate: vi.fn(() => {
      current = { ...current, status: 'downloading', percent: 0, transferred: 0 };
      return Promise.resolve(current);
    }),
    cancelUpdateDownload: vi.fn(() => {
      current = {
        ...current,
        status: 'available',
        percent: undefined,
        transferred: undefined,
        total: undefined,
        bytesPerSecond: undefined,
      };
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
    acknowledgeCompletedUpdate: vi.fn(() => Promise.resolve(current)),
    openUpdateReleaseNotes: vi.fn(() => Promise.resolve(current)),
    restartToUpdate: vi.fn(() => Promise.resolve(current)),
    minimizeWindow: vi.fn(),
    toggleMaximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
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

let mounted: ReturnType<typeof mount> | undefined;

async function mountDialog() {
  mounted = mount(UpdateDialog, { global: { plugins: [i18n] } });
  await flushPromises();
  useDesktopUpdate().openDialog();
  await nextTick();
  return mounted;
}

function body(): HTMLElement {
  return document.body;
}

afterEach(() => {
  // Unmount rather than clearing document.body: the dialog teleports into the
  // body, and wiping it removes the teleport target for every later mount.
  mounted?.unmount();
  mounted = undefined;
  resetDesktopUpdateStateForTests();
  delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
  vi.restoreAllMocks();
});

describe('formatUpdateBytes', () => {
  it('keeps one decimal above bytes so the totals do not jump a whole unit', () => {
    expect(formatUpdateBytes(54_000_000)).toBe('51.5MB');
    expect(formatUpdateBytes(52_300_000)).toBe('49.9MB');
    expect(formatUpdateBytes(512)).toBe('512B');
  });
});

describe('UpdateDialog', () => {
  it('offers download, skip, and notes before any bytes move', async () => {
    installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    await mountDialog();

    expect(body().querySelector('[data-testid="download-update"]')).not.toBeNull();
    expect(body().querySelector('[data-testid="skip-update"]')).not.toBeNull();
    expect(body().querySelector('[data-testid="view-update-notes"]')).not.toBeNull();
    expect(body().querySelector('[data-testid="cancel-update-download"]')).toBeNull();
  });

  it('shows compact progress, percent, and speed while downloading', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    await mountDialog();

    await bridge.emit(updateState({
      status: 'downloading',
      availableVersion: '1.2.3',
      percent: 42.5,
      transferred: 4_250_000,
      total: 10_000_000,
      bytesPerSecond: 6.2 * 1024 * 1024,
    }));
    await nextTick();

    const meta = body().querySelector('[data-testid="update-dialog-progress-meta"]');
    expect(meta?.textContent).toContain('4.1MB / 9.5MB');
    expect(meta?.textContent).toContain('42.5%');
    expect(meta?.textContent).toContain('6.2MB/s');
    expect(meta?.querySelectorAll('.update-dialog__separator')).toHaveLength(2);
    const progress = body().querySelector<HTMLProgressElement>('[data-testid="update-dialog-progress"]');
    expect(progress?.value).toBe(42.5);
  });

  it('cancels an in-flight download through the bridge', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    await mountDialog();
    await bridge.emit(updateState({
      status: 'downloading',
      availableVersion: '1.2.3',
      percent: 10,
      transferred: 1_000,
      total: 10_000,
    }));
    await nextTick();

    const cancel = body().querySelector<HTMLButtonElement>('[data-testid="cancel-update-download"]');
    expect(cancel).not.toBeNull();
    cancel?.click();
    await flushPromises();

    expect(bridge.cancelUpdateDownload).toHaveBeenCalledOnce();
    expect(useDesktopUpdate().status.value).toBe('available');
  });

  it('keeps download and restart as two separate actions', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    await mountDialog();

    body().querySelector<HTMLButtonElement>('[data-testid="download-update"]')?.click();
    await flushPromises();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    expect(bridge.restartToUpdate).not.toHaveBeenCalled();

    await bridge.emit(updateState({ status: 'downloaded', availableVersion: '1.2.3' }));
    await nextTick();
    body().querySelector<HTMLButtonElement>('[data-testid="restart-to-update"]')?.click();
    await flushPromises();

    expect(bridge.restartToUpdate).toHaveBeenCalledOnce();
  });

  it('cannot be dismissed while the download is running', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const update = useDesktopUpdate();
    await mountDialog();

    await bridge.emit(updateState({
      status: 'downloading',
      availableVersion: '1.2.3',
      percent: 10,
      transferred: 1_000,
      total: 10_000,
    }));
    await nextTick();

    update.closeDialog();
    expect(update.dialogOpen.value).toBe(false);

    update.openDialog();
    await nextTick();
    const close = body().querySelector<HTMLElement>('.ui-dialog__close');
    expect(close).not.toBeNull();
    close?.click();
    await nextTick();

    expect(update.dialogOpen.value).toBe(true);
  });
});

describe('useDesktopUpdate.hasUpdate', () => {
  it('stays false with no bridge, and true once an unskipped version arrives', async () => {
    expect(useDesktopUpdate().hasUpdate.value).toBe(false);

    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const update = useDesktopUpdate();
    update.subscribe();
    await flushPromises();

    expect(update.hasUpdate.value).toBe(true);

    await bridge.emit(updateState({
      status: 'skipped',
      availableVersion: '1.2.3',
      skippedVersion: '1.2.3',
    }));
    expect(update.hasUpdate.value).toBe(false);
  });

  it('hides update alerts when update notifications are off', async () => {
    installBridge(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      notifyUpdate: false,
    }));
    const update = useDesktopUpdate();
    update.subscribe();
    await flushPromises();

    expect(update.hasUpdate.value).toBe(false);
  });
});

describe('sidebar update button', () => {
  async function mountSidebar() {
    mounted = mount(Sidebar, {
      props: {
        activeWorkspace: null,
        activeWorkspaceId: null,
        sessions: [],
        groups: [],
        activeId: '',
        workspaceSortMode: 'manual' as const,
      },
      global: {
        plugins: [i18n],
        stubs: {
          Markdown: {
            props: ['text'],
            template: '<div>{{ text }}</div>',
          },
        },
      },
    });
    await flushPromises();
    return mounted;
  }

  it('stays hidden until an update is waiting', async () => {
    installBridge(updateState({ status: 'idle' }));
    const wrapper = await mountSidebar();

    expect(wrapper.find('[data-testid="sidebar-update"]').exists()).toBe(false);
  });

  it('shows a compact header trigger with release notes on hover and opens the overlay on click', async () => {
    const bridge = installBridge(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      releaseDate: '2026-08-26T12:00:00.000Z',
      releaseNotes: '## New Features\n\n- Added the compact updater.',
    }));
    const update = useDesktopUpdate();
    update.subscribe();
    const wrapper = await mountSidebar();
    await bridge.emit(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      releaseDate: '2026-08-26T12:00:00.000Z',
      releaseNotes: '## New Features\n\n- Added the compact updater.',
    }));
    await nextTick();

    const button = wrapper.find('[data-testid="sidebar-update"]');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('');
    expect(wrapper.find('.update-wrap').exists()).toBe(false);
    expect(wrapper.find('.ch-actions').exists()).toBe(true);
    expect(update.dialogOpen.value).toBe(false);

    await button.trigger('mouseenter');
    await flushPromises();

    expect(button.attributes('aria-describedby')).toBe('sidebar-update-notes');
    expect(button.attributes('aria-expanded')).toBe('true');
    const notes = body().querySelector('[data-testid="sidebar-update-notes"]');
    expect(notes).not.toBeNull();
    expect(notes?.querySelector('[data-testid="sidebar-update-notes-title"]')?.textContent)
      .toBe('v1.2.3 Release Notes');
    expect(notes?.textContent).toContain('August 26, 2026');
    await vi.waitFor(() => {
      expect(notes?.textContent).toContain('Added the compact updater.');
    });

    await button.trigger('click');

    expect(update.dialogOpen.value).toBe(true);
  });
});
