// apps/pythinker-web/src/composables/useDesktopUpdate.ts
// Single subscription to the desktop update bridge, shared by the sidebar
// button and the update dialog. Module-level state on purpose: two components
// reading the same feed must never open two `onUpdateState` listeners, and the
// button has to know whether to render before the dialog is ever mounted.
//
// The main process owns durable notification, skip, and install receipts; this
// owns only current display and the open/closed state of the dialog.
import { computed, readonly, ref } from 'vue';

/** Read lazily, never cached: the preload bridge is not guaranteed to exist at
 *  module-evaluation time, and caching it makes import order load-bearing. */
function bridge(): PythinkerDesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.pythinkerDesktop;
}

const state = ref<DesktopUpdateState>();
const dialogOpen = ref(false);
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

/**
 * One decimal, binary units — matches the byte counts the download itself
 * reports, so `52.3MB / 54.0MB` stays stable rather than jumping a whole unit.
 */
export function formatUpdateBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) {
    amount /= 1_024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('en', {
    minimumFractionDigits: unit === 0 ? 0 : 1,
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(amount)}${units[unit]}`;
}

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

  /** Aborts the transfer; the main process returns the state to `available`. */
  async function cancelDownload(): Promise<void> {
    await run(() => bridge()!.cancelUpdateDownload(), 'cancel');
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

  async function skip(): Promise<void> {
    const version = state.value?.availableVersion;
    if (version === undefined) return;
    await run(() => bridge()!.skipUpdate(version), 'skip');
    dialogOpen.value = false;
  }

  /** A failed download retries the download; a failed check re-checks. */
  async function retry(): Promise<void> {
    if (downloadRequestedVersion.value === state.value?.availableVersion) {
      await download();
      return;
    }
    await run(() => bridge()!.checkForUpdates(), 'retry');
  }

  async function openReleaseNotes(): Promise<void> {
    const version = state.value?.availableVersion;
    if (version === undefined) return;
    await run(() => bridge()!.openUpdateReleaseNotes(version), 'release notes');
  }

  function openDialog(): void {
    dialogOpen.value = true;
    const version = state.value?.availableVersion;
    if (version !== undefined) void bridge()?.markUpdateNotified(version).catch(() => {});
  }

  function closeDialog(): void {
    dialogOpen.value = false;
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
    dialogOpen,
    subscribe,
    unsubscribe,
    download,
    cancelDownload,
    restart,
    skip,
    retry,
    openReleaseNotes,
    openDialog,
    closeDialog,
  };
}

/** Test seam: resets the module-level feed between test cases. */
export function resetDesktopUpdateStateForTests(): void {
  state.value = undefined;
  dialogOpen.value = false;
  busy.value = false;
  downloadRequestedVersion.value = undefined;
  completedVersion.value = undefined;
  removeListener?.();
  removeListener = undefined;
  subscribers = 0;
}
