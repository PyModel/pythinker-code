<!-- apps/pythinker-web/src/components/UpdateToast.vue -->
<!-- Desktop-only prompt for every stage of an update the user can act on:
     found, downloading, ready to install, and a download that failed after one
     was found. Automatic downloads are the default, so without the first two
     stages a user is told nothing at all until the download happens to finish.
     Unlike WarningToasts this never auto-dismisses — it asks a question. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const bridge = typeof window !== 'undefined' ? window.pythinkerDesktop : undefined;
const state = ref<DesktopUpdateState>();
const busy = ref(false);
/** Versions the user skipped. Persisted per version so the prompt does not
    return for the same build; an unnamed version is skipped for the session. */
const SKIP_KEY = 'pythinker.update.skipped';
const skipped = ref<string[]>(readSkipped());
/** An update was found in this session. A failure is only worth reporting once
    that is true — a check that fails while the machine is offline is not news. */
const sawUpdate = ref(false);
const errorDismissed = ref(false);

let removeListener: (() => void) | undefined;

function readSkipped(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function applyState(next: DesktopUpdateState): void {
  if (next.status === 'available' || next.status === 'downloading' || next.status === 'downloaded') {
    sawUpdate.value = true;
    errorDismissed.value = false;
  }
  state.value = next;
}

const failed = computed(() => state.value?.status === 'error' && sawUpdate.value);

const visible = computed(() => {
  const current = state.value;
  if (current === undefined) return false;
  if (current.status === 'error') return failed.value && !errorDismissed.value;
  if (current.status !== 'available' && current.status !== 'downloading' && current.status !== 'downloaded') {
    return false;
  }
  return !skipped.value.includes(current.version ?? '');
});

/** Only these two states can start an install; a download in flight cannot. */
const installable = computed(
  () => state.value?.status === 'available' || state.value?.status === 'downloaded',
);

const title = computed(() => {
  if (failed.value) return t('update.failed');
  return state.value?.version
    ? t('update.availableVersion', { version: state.value.version })
    : t('update.available');
});

const message = computed(() => {
  const current = state.value;
  if (current === undefined) return '';
  if (current.status === 'error') return current.message ?? '';
  if (current.status === 'downloaded') return t('update.restart');
  if (current.status === 'downloading') {
    return current.percent === undefined
      ? t('update.downloading')
      : t('update.downloadingPercent', { percent: Math.round(current.percent) });
  }
  return current.autoUpdate ? t('update.downloading') : t('update.prompt');
});

const primaryLabel = computed(() => (failed.value ? t('update.retry') : t('update.install')));
const secondaryLabel = computed(() => (failed.value ? t('update.dismiss') : t('update.skip')));

async function primary(): Promise<void> {
  if (bridge === undefined || busy.value) return;
  busy.value = true;
  try {
    applyState(failed.value ? await bridge.checkForUpdates() : await bridge.quitAndInstall());
  } finally {
    busy.value = false;
  }
}

function secondary(): void {
  if (failed.value) {
    errorDismissed.value = true;
    return;
  }
  const next = [...skipped.value, state.value?.version ?? ''];
  skipped.value = next;
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify(next.filter((v) => v !== '')));
  } catch {
    // A blocked localStorage still skips for this session.
  }
}

onMounted(() => {
  // Dev-only preview: the real updater stays disabled outside packaged builds,
  // so `?updateDemo=1` on the Vite dev server is the only way to see this.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('updateDemo')) {
    applyState({ status: 'downloaded', version: '0.0.0-dev', autoUpdate: true });
    return;
  }
  if (bridge === undefined) return;
  removeListener = bridge.onUpdateState((next) => {
    applyState(next);
  });
  void bridge.getUpdateState().then(applyState, () => {
    // A failed initial read leaves the prompt hidden until the next event.
  });
});

onUnmounted(() => {
  removeListener?.();
});
</script>

<template>
  <div v-if="visible" class="update-toast" role="status" aria-live="polite">
    <div class="body">
      <div class="title">{{ title }}</div>
      <div class="msg">{{ message }}</div>
    </div>
    <div class="acts">
      <button type="button" class="skip" @click="secondary">{{ secondaryLabel }}</button>
      <button
        type="button"
        class="go"
        :disabled="busy || !(installable || failed)"
        @click="void primary()"
      >
        {{ primaryLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.update-toast {
  position: fixed;
  right: 16px;
  /* Sits above the WarningToasts stack (bottom: 84px) so the two never overlap. */
  bottom: 152px;
  z-index: 61;
  width: min(360px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.12);
  font-size: var(--ui-font-size);
  line-height: 1.45;
}
.title { color: var(--ink); font-weight: 600; overflow-wrap: anywhere; }
.msg { margin-top: 2px; color: var(--muted); overflow-wrap: anywhere; }
.acts { display: flex; justify-content: flex-end; gap: 8px; }
.skip,
.go {
  padding: 5px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--muted);
  font: inherit;
  font-size: var(--ui-font-size-xs);
  cursor: pointer;
}
.skip:hover { color: var(--ink); }
.go { border-color: transparent; background: var(--blue); color: #fff; font-weight: 600; }
.go:disabled { opacity: 0.6; cursor: default; }

@media (max-width: 640px) {
  .update-toast {
    left: 12px;
    right: 12px;
    bottom: calc(150px + env(safe-area-inset-bottom));
    width: auto;
  }
}
</style>
