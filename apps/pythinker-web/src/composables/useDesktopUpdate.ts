// apps/pythinker-web/src/composables/useDesktopUpdate.ts
// Single subscription to the desktop update bridge, owned by the app shell.
// Module-level state lets every update surface read the same feed without
// opening duplicate `onUpdateState` listeners.
//
// The main process owns durable notification, skip, and install receipts; this
// owns only current display state.
import { computed, readonly, ref } from 'vue';

/** Read lazily, never cached: the preload bridge is not guaranteed to exist at
 *  module-evaluation time, and caching it makes import order load-bearing. */
function bridge(): PythinkerDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.pythinkerDesktop;
}

const state = ref<DesktopUpdateState>();
const busy = ref(false);
const downloadRequestedVersion = ref<string>();
const completedVersion = ref<string>();

let removeListener: (() => void) | undefined;
let subscribers = 0;

/** Stages where an update exists and the user can still act on it. */
function isUpdateStage(status: DesktopUpdateState['status']): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

function applyState(next: DesktopUpdateState): void {
  state.value = next;
  if (next.completedVersion !== undefined && completedVersion.value !== next.completedVersion) {
    completedVersion.value = next.completedVersion;
    void bridge()?.acknowledgeCompletedUpdate(next.completedVersion).catch(() => {});
  }
}

/**
 * `error` is ambiguous: a failed check and a failed download both land here.
 * Only the version the user actually asked to download should read as a failed
 * download; anything else falls back to the actionable `available` state.
 */
const status = computed<DesktopUpdateState['status'] | undefined>(() => {
  const current = state.value?.status;
  if (current === 'error' && downloadRequestedVersion.value !== state.value?.availableVersion) {
    return 'available';
  }
  return current;
});

const availableVersion = computed(() => state.value?.availableVersion);

/** Drives the sidebar button: a skipped version stays hidden until undone. */
const hasUpdate = computed(() => {
  const current = state.value;
  const stage = status.value;
  if (bridge() === undefined || current === undefined || stage === undefined) return false;
  if (!current.notifyUpdate) return false;
  if (current.availableVersion === undefined) return false;
  if (current.skippedVersion === current.availableVersion) return false;
  return isUpdateStage(stage) || stage === 'error';
});

const percent = computed(() => {
  const value = state.value?.percent;
  return value === undefined || !Number.isFinite(value) ? undefined : Math.min(100, Math.max(0, value));
});

async function run(action: () => Promise<DesktopUpdateState>, label: string): Promise<void> {
  if (bridge() === undefined || busy.value) return;
  busy.value = true;
  try {
    applyState(await action());
  } catch (error) {
    console.error(`desktop update ${label} failed:`, error);
  } finally {
    busy.value = false;
  }
}

export function useDesktopUpdate() {
  function subscribe(): void {
    subscribers += 1;
    const api = bridge();
    if (api === undefined || removeListener !== undefined) return;
    removeListener = api.onUpdateState(applyState);
    void api.getUpdateState().then(applyState, () => {});
  }

  function unsubscribe(): void {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0) return;
    removeListener?.();
    removeListener = undefined;
  }

  async function download(): Promise<void> {
    const version = state.value?.availableVersion;
    if (version === undefined) return;
    downloadRequestedVersion.value = version;
    await run(() => bridge()!.downloadUpdate(), 'download');
  }

  async function restart(): Promise<void> {
    const api = bridge();
    if (api === undefined || busy.value) return;
    busy.value = true;
    try {
      await api.restartToUpdate();
    } catch (error) {
      console.error('desktop update restart failed:', error);
    } finally {
      busy.value = false;
    }
  }

  /** A failed download retries the download; a failed check re-checks. */
  async function retry(): Promise<void> {
    if (downloadRequestedVersion.value === state.value?.availableVersion) {
      await download();
      return;
    }
    await run(() => bridge()!.checkForUpdates(), 'retry');
  }

  async function markNotified(version: string): Promise<void> {
    await bridge()?.markUpdateNotified(version).catch(() => {});
  }

  return {
    isDesktop: bridge() !== undefined,
    state: readonly(state),
    status,
    availableVersion,
    hasUpdate,
    percent,
    busy: readonly(busy),
    completedVersion: readonly(completedVersion),
    subscribe,
    unsubscribe,
    download,
    restart,
    retry,
    markNotified,
  };
}

/** Test seam: resets the module-level feed between test cases. */
export function resetDesktopUpdateStateForTests(): void {
  state.value = undefined;
  busy.value = false;
  downloadRequestedVersion.value = undefined;
  completedVersion.value = undefined;
  removeListener?.();
  removeListener = undefined;
  subscribers = 0;
}
