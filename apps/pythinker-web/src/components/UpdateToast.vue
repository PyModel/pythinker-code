<!-- Desktop-only update prompt. The main process owns durable notification,
     skip, and installation receipts; this component owns only current display. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from './ui/Button.vue';
import Toast from './ui/Toast.vue';

const { t } = useI18n();
const bridge = typeof window !== 'undefined' ? window.pythinkerDesktop : undefined;
const state = ref<DesktopUpdateState>();
const activeVersion = ref<string>();
const completedVersion = ref<string>();
const downloadRequestedVersion = ref<string>();
const busy = ref(false);
let removeListener: (() => void) | undefined;

type ToastMode = 'update' | 'error' | 'completed';

function isUpdateStage(status: DesktopUpdateState['status']): boolean {
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

function applyState(next: DesktopUpdateState): void {
  state.value = next;
  if (next.completedVersion !== undefined && completedVersion.value !== next.completedVersion) {
    completedVersion.value = next.completedVersion;
    void bridge?.acknowledgeCompletedUpdate(next.completedVersion).catch(() => {});
  }

  const version = next.availableVersion;
  if (version === undefined || next.status === 'idle' || next.status === 'disabled') {
    activeVersion.value = undefined;
    return;
  }
  if (next.status === 'skipped' || next.skippedVersion === version) {
    if (activeVersion.value === version) activeVersion.value = undefined;
    return;
  }
  if (!isUpdateStage(next.status)) return;
  if (activeVersion.value === version) return;
  if (next.notifiedVersion === version) {
    activeVersion.value = undefined;
    return;
  }
  activeVersion.value = version;
  void bridge?.markUpdateNotified(version).catch(() => {});
}

const toastStatus = computed<DesktopUpdateState['status'] | undefined>(() => {
  const status = state.value?.status;
  if (status === 'error' && downloadRequestedVersion.value !== activeVersion.value) return 'available';
  return status;
});

const mode = computed<ToastMode | undefined>(() => {
  if (completedVersion.value !== undefined) return 'completed';
  if (activeVersion.value === undefined) return undefined;
  if (toastStatus.value === 'error') return 'error';
  return toastStatus.value !== undefined && isUpdateStage(toastStatus.value) ? 'update' : undefined;
});

const toastVariant = computed(() => {
  if (mode.value === 'completed') return 'success' as const;
  if (mode.value === 'error') return 'danger' as const;
  return 'info' as const;
});

const title = computed(() => {
  if (mode.value === 'completed') {
    return t('update.completedTitle', { version: completedVersion.value });
  }
  if (mode.value === 'error') return t('update.failed');
  return t('update.availableVersion', { version: activeVersion.value });
});

const message = computed(() => {
  if (mode.value === 'completed') return t('update.completedMessage');
  const current = state.value;
  if (toastStatus.value === 'error') return current?.message ?? t('update.failedMessage');
  if (toastStatus.value === 'downloaded') return t('update.restart');
  if (toastStatus.value === 'downloading') return t('update.downloading');
  return t('update.prompt');
});

const progressValue = computed(() => {
  const value = state.value?.percent;
  return value === undefined || !Number.isFinite(value) ? undefined : Math.min(100, Math.max(0, value));
});

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) {
    amount /= 1_024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}

const progressDetail = computed(() => {
  const current = state.value;
  if (current?.status !== 'downloading') return '';
  const parts: string[] = [];
  if (progressValue.value !== undefined) parts.push(`${Math.round(progressValue.value)}%`);
  if (current.transferred !== undefined && current.total !== undefined) {
    parts.push(t('update.bytesOfTotal', {
      transferred: formatBytes(current.transferred),
      total: formatBytes(current.total),
    }));
  } else if (current.transferred !== undefined) {
    parts.push(formatBytes(current.transferred));
  }
  if (current.bytesPerSecond !== undefined) parts.push(`${formatBytes(current.bytesPerSecond)}/s`);
  return parts.join(' · ');
});

function dismiss(): void {
  if (mode.value === 'completed') completedVersion.value = undefined;
  else activeVersion.value = undefined;
}

async function openNotes(): Promise<void> {
  const version = state.value?.availableVersion;
  if (bridge === undefined || version === undefined) return;
  try {
    await bridge.openUpdateReleaseNotes(version);
  } catch (error) {
    console.error('desktop update release notes failed:', error);
  }
}

async function skip(): Promise<void> {
  const version = state.value?.availableVersion;
  if (bridge === undefined || version === undefined || busy.value) return;
  busy.value = true;
  try {
    applyState(await bridge.skipUpdate(version));
  } catch (error) {
    console.error('desktop update skip failed:', error);
  } finally {
    busy.value = false;
  }
}

async function download(): Promise<void> {
  const version = state.value?.availableVersion;
  if (bridge === undefined || version === undefined || busy.value) return;
  busy.value = true;
  downloadRequestedVersion.value = version;
  try {
    applyState(await bridge.downloadUpdate());
  } catch (error) {
    console.error('desktop update download request failed:', error);
  } finally {
    busy.value = false;
  }
}

async function retry(): Promise<void> {
  if (downloadRequestedVersion.value === activeVersion.value) await download();
  else if (bridge !== undefined) {
    try {
      applyState(await bridge.checkForUpdates());
    } catch (error) {
      console.error('desktop update retry failed:', error);
    }
  }
}

async function restart(): Promise<void> {
  if (bridge === undefined || busy.value) return;
  busy.value = true;
  try {
    await bridge.restartToUpdate();
  } catch (error) {
    console.error('desktop update restart failed:', error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('updateDemo')) {
    applyState({
      status: 'downloading',
      installedVersion: '0.1.0',
      availableVersion: '0.2.0',
      percent: 42.5,
      transferred: 4_250_000,
      total: 10_000_000,
      bytesPerSecond: 1_250_000,
      autoUpdate: true,
    });
    return;
  }
  if (bridge === undefined) return;
  removeListener = bridge.onUpdateState(applyState);
  void bridge.getUpdateState().then(applyState, () => {});
});

onUnmounted(() => {
  removeListener?.();
});
</script>

<template>
  <div
    v-if="mode"
    class="update-toast"
    data-testid="update-toast"
    role="status"
    aria-live="polite"
  >
    <Toast
      :variant="toastVariant"
      :title="title"
      :message="message"
      :dismiss-label="t('update.dismissNotification')"
      @dismiss="dismiss"
    >
      <div v-if="toastStatus === 'downloading'" class="update-progress">
        <progress
          v-if="progressValue === undefined"
          data-testid="update-progress"
          max="100"
          :aria-label="t('update.progressLabel')"
        />
        <progress
          v-else
          data-testid="update-progress"
          :value="progressValue"
          max="100"
          :aria-label="t('update.progressLabel')"
        />
        <span data-testid="update-progress-detail">{{ progressDetail || t('update.fetching') }}</span>
      </div>

      <div v-if="mode !== 'completed'" class="update-actions">
        <Button
          v-if="state?.availableVersion && toastStatus !== 'error'"
          data-testid="view-update-notes"
          variant="ghost"
          size="sm"
          @click="void openNotes()"
        >
          {{ t('update.viewNotes') }}
        </Button>
        <template v-if="toastStatus === 'available'">
          <Button data-testid="skip-update" variant="ghost" size="sm" :disabled="busy" @click="void skip()">
            {{ t('update.skip') }}
          </Button>
          <Button data-testid="download-update" size="sm" :loading="busy" @click="void download()">
            {{ t('update.download') }}
          </Button>
        </template>
        <template v-else-if="toastStatus === 'downloaded'">
          <Button data-testid="later-update" variant="ghost" size="sm" :disabled="busy" @click="dismiss">
            {{ t('update.later') }}
          </Button>
          <Button data-testid="restart-to-update" size="sm" :loading="busy" @click="void restart()">
            {{ t('update.restartAction') }}
          </Button>
        </template>
        <template v-else-if="toastStatus === 'error'">
          <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">
            {{ t('update.dismiss') }}
          </Button>
          <Button data-testid="retry-update" size="sm" :loading="busy" @click="void retry()">
            {{ downloadRequestedVersion === activeVersion ? t('update.retryDownload') : t('update.retry') }}
          </Button>
        </template>
      </div>
    </Toast>
  </div>
</template>

<style scoped>
.update-toast {
  position: fixed;
  right: var(--space-4);
  bottom: 152px;
  z-index: var(--z-toast);
  width: min(380px, calc(100vw - var(--space-8)));
}

.update-toast :deep(.ui-toast) { width: 100%; }

.update-progress {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.update-progress progress {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
  accent-color: var(--color-accent);
}

.update-progress progress::-webkit-progress-bar {
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
}

.update-progress progress::-webkit-progress-value {
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.update-progress progress::-moz-progress-bar {
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.update-progress span {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

@media (max-width: 640px) {
  .update-toast {
    right: var(--space-3);
    left: var(--space-3);
    bottom: calc(150px + env(safe-area-inset-bottom));
    width: auto;
  }
}
</style>
