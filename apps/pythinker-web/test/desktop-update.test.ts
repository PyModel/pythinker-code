import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Sidebar from '../src/components/Sidebar.vue';
import {
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
    setAutoUpdate: vi.fn((enabled: boolean) => {
      current = { ...current, autoUpdate: enabled };
      return Promise.resolve(current);
    }),
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

function body(): HTMLElement {
  return document.body;
}

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetDesktopUpdateStateForTests();
  delete (window as unknown as { pythinkerDesktop?: unknown }).pythinkerDesktop;
  vi.restoreAllMocks();
  vi.useRealTimers();
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
      attachTo: document.body,
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

  it('shows a compact header trigger with release notes on hover and downloads inline on click', async () => {
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
    expect(button.text()).toBe('Update');
    expect(button.classes()).toContain('is-available');
    expect(wrapper.find('.update-wrap').exists()).toBe(false);
    expect(wrapper.find('.ch-actions').exists()).toBe(true);
    await button.trigger('mouseenter');
    await flushPromises();

    expect(button.attributes('aria-controls')).toBe('sidebar-update-notes');
    expect(button.attributes('aria-haspopup')).toBe('dialog');
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
    await flushPromises();

    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(bridge.markUpdateNotified).toHaveBeenCalledWith('1.2.3');
  });

  it('paints download progress, restart, and retry into the same trigger', async () => {
    const bridge = installBridge(updateState({ status: 'available', availableVersion: '1.2.3' }));
    const update = useDesktopUpdate();
    update.subscribe();
    const wrapper = await mountSidebar();
    const button = wrapper.get('[data-testid="sidebar-update"]');

    await button.trigger('click');
    await flushPromises();
    await bridge.emit(updateState({ status: 'downloading', availableVersion: '1.2.3', percent: 11.4 }));
    await nextTick();
    expect(button.text()).toBe('11%');
    expect(button.classes()).toContain('is-downloading');
    expect(button.attributes('aria-busy')).toBe('true');

    await bridge.emit(updateState({ status: 'downloaded', availableVersion: '1.2.3' }));
    await nextTick();
    expect(button.text()).toBe('Restart');
    await button.trigger('click');
    await flushPromises();
    expect(bridge.restartToUpdate).toHaveBeenCalledTimes(1);

    await bridge.emit(updateState({ status: 'error', availableVersion: '1.2.3', message: 'boom' }));
    await nextTick();
    expect(button.text()).toBe('Retry');
    await button.trigger('click');
    await flushPromises();
    expect(bridge.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('keeps release notes open while keyboard focus moves into and within the panel', async () => {
    vi.useFakeTimers();
    installBridge(updateState({
      status: 'available',
      availableVersion: '1.2.3',
      releaseNotes: 'Read the release notes.\n\n---\n\nBuilt from https://example.com/commit/abcdef1234567.',
    }));
    const update = useDesktopUpdate();
    update.subscribe();
    const wrapper = await mountSidebar();
    await flushPromises();

    const button = wrapper.get('[data-testid="sidebar-update"]');
    button.element.focus();
    await nextTick();
    const notes = body().querySelector<HTMLElement>('[data-testid="sidebar-update-notes"]');
    const scrollRegion = notes?.querySelector<HTMLElement>('[data-testid="sidebar-update-notes-body"]');
    const provenanceLink = notes?.querySelector<HTMLAnchorElement>(
      '[data-testid="release-notes-provenance"] a',
    );
    if (!notes || !scrollRegion || !provenanceLink) throw new Error('expected update notes targets');
    expect(notes.getAttribute('role')).toBe('dialog');

    await button.trigger('keydown', { key: 'Tab' });
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(scrollRegion);
    expect(body().querySelector('[data-testid="sidebar-update-notes"]')).toBe(notes);

    provenanceLink.focus();
    await vi.advanceTimersByTimeAsync(120);
    expect(document.activeElement).toBe(provenanceLink);
    expect(body().querySelector('[data-testid="sidebar-update-notes"]')).toBe(notes);

    wrapper.get<HTMLButtonElement>('.ch-collapse').element.focus();
    await vi.advanceTimersByTimeAsync(120);
    expect(body().querySelector('[data-testid="sidebar-update-notes"]')).toBeNull();
  });
});
