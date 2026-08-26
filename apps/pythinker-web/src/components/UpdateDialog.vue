<!-- apps/pythinker-web/src/components/UpdateDialog.vue -->
<!-- Desktop-only update overlay, opened from the sidebar Update button. One
     centered surface for the whole flow: consent, transfer progress with a
     cancel, and the restart that applies it. Download and install stay two
     deliberate actions — the main process refuses to combine them. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatUpdateBytes, useDesktopUpdate } from '../composables/useDesktopUpdate';
import Button from './ui/Button.vue';
import Dialog from './ui/Dialog.vue';
import PythinkerLogo from './PythinkerLogo.vue';

const { t } = useI18n();
const update = useDesktopUpdate();

onMounted(() => update.subscribe());
onUnmounted(() => update.unsubscribe());

const version = computed(() => update.availableVersion.value ?? '');

const title = computed(() => {
  if (update.status.value === 'downloading') return t('update.dialogDownloading', { version: version.value });
  if (update.status.value === 'downloaded') return t('update.dialogReady', { version: version.value });
  if (update.status.value === 'error') return t('update.failed');
  return t('update.dialogAvailable', { version: version.value });
});

/** The release date the feed reported, in the viewer's locale. */
const releaseDate = computed(() => {
  const raw = update.state.value?.releaseDate;
  if (raw === undefined) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(parsed);
});

const transferred = computed(() => {
  const value = update.state.value?.transferred;
  return value === undefined ? undefined : formatUpdateBytes(value);
});

const total = computed(() => {
  const value = update.state.value?.total;
  return value === undefined ? undefined : formatUpdateBytes(value);
});

const speed = computed(() => {
  const value = update.state.value?.bytesPerSecond;
  return value === undefined ? undefined : formatUpdateBytes(value);
});

const percent = computed(() => {
  const value = update.percent.value;
  if (value === undefined) return undefined;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
});

const message = computed(() => {
  if (update.status.value === 'error') return update.state.value?.message ?? t('update.failedMessage');
  if (update.status.value === 'downloaded') return t('update.restart');
  return t('update.prompt');
});

/** Cancel is the only exit while bytes are moving, so the frame stays put. */
const dismissable = computed(() => update.status.value !== 'downloading');

function close(): void {
  if (!dismissable.value) return;
  update.closeDialog();
}
</script>

<template>
  <Dialog
    :open="update.dialogOpen.value"
    :title="title"
    :description="releaseDate || undefined"
    :close-on-overlay="dismissable"
    :close-on-esc="dismissable"
    size="md"
    @close="close"
  >
    <template #head>
      <div class="update-dialog__head">
        <PythinkerLogo class="update-dialog__mark" size="md" :animated="false" />
        <div class="update-dialog__titles">
          <div class="update-dialog__title" data-testid="update-dialog-title">{{ title }}</div>
          <div
            v-if="releaseDate && update.status.value !== 'downloading'"
            class="update-dialog__date"
            data-testid="update-dialog-date"
          >
            {{ releaseDate }}
          </div>
        </div>
      </div>
    </template>

    <div v-if="update.status.value === 'downloading'" class="update-dialog__progress">
      <span class="update-dialog__progress-label">{{ t('update.downloadProgress') }}</span>
      <progress
        v-if="update.percent.value === undefined"
        data-testid="update-dialog-progress"
        max="100"
        :aria-label="t('update.progressLabel')"
      />
      <progress
        v-else
        data-testid="update-dialog-progress"
        :value="update.percent.value"
        max="100"
        :aria-label="t('update.progressLabel')"
      />
      <div class="update-dialog__progress-meta" data-testid="update-dialog-progress-meta">
        <span v-if="transferred && total" data-testid="update-dialog-bytes">
          {{ t('update.bytesProgress', { transferred, total }) }}
        </span>
        <span v-else>{{ t('update.fetching') }}</span>
        <template v-if="percent">
          <span class="update-dialog__separator" aria-hidden="true">·</span>
          <span class="update-dialog__percent">{{ percent }}</span>
        </template>
        <template v-if="speed">
          <span class="update-dialog__separator" aria-hidden="true">·</span>
          <span>{{ t('update.downloadSpeed', { speed }) }}</span>
        </template>
      </div>
    </div>
    <p v-else class="update-dialog__message" data-testid="update-dialog-message">{{ message }}</p>

    <template #foot>
      <template v-if="update.status.value === 'downloading'">
        <Button
          data-testid="cancel-update-download"
          variant="secondary"
          :loading="update.busy.value"
          @click="void update.cancelDownload()"
        >
          {{ t('update.cancelDownload') }}
        </Button>
      </template>
      <template v-else-if="update.status.value === 'downloaded'">
        <Button data-testid="later-update" variant="ghost" @click="close">{{ t('update.later') }}</Button>
        <Button data-testid="restart-to-update" :loading="update.busy.value" @click="void update.restart()">
          {{ t('update.restartAction') }}
        </Button>
      </template>
      <template v-else-if="update.status.value === 'error'">
        <Button data-testid="dismiss-update" variant="ghost" @click="close">{{ t('update.dismiss') }}</Button>
        <Button data-testid="retry-update" :loading="update.busy.value" @click="void update.retry()">
          {{ t('update.retryDownload') }}
        </Button>
      </template>
      <template v-else>
        <Button
          v-if="version"
          data-testid="view-update-notes"
          variant="ghost"
          @click="void update.openReleaseNotes()"
        >
          {{ t('update.viewNotes') }}
        </Button>
        <Button data-testid="skip-update" variant="ghost" @click="void update.skip()">
          {{ t('update.skip') }}
        </Button>
        <Button data-testid="download-update" :loading="update.busy.value" @click="void update.download()">
          {{ t('update.download') }}
        </Button>
      </template>
    </template>
  </Dialog>
</template>

<style scoped>
.update-dialog__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1;
  min-width: 0;
}

.update-dialog__mark {
  flex: none;
  border-radius: var(--radius-md);
}

.update-dialog__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-dialog__title {
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-lg);
  font-weight: var(--weight-medium);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-dialog__date {
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  color: var(--color-text-muted);
}

.update-dialog__message {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  color: var(--color-text-muted);
}

.update-dialog__progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.update-dialog__progress-label {
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  color: var(--color-text);
}

.update-dialog__progress-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--ui-font-size-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.update-dialog__separator {
  color: var(--color-text-faint);
}

.update-dialog__percent {
  color: var(--color-accent-hover);
  font-weight: var(--weight-medium);
}

.update-dialog__progress progress {
  width: 100%;
  height: 6px;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
  accent-color: var(--color-accent);
}

.update-dialog__progress progress::-webkit-progress-bar {
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
}

.update-dialog__progress progress::-webkit-progress-value {
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

.update-dialog__progress progress::-moz-progress-bar {
  border-radius: var(--radius-full);
  background: var(--color-accent);
}

@media (max-width: 420px) {
  .update-dialog__progress-meta {
    gap: var(--space-1-5);
    font-size: var(--ui-font-size-xs);
  }
}
</style>
