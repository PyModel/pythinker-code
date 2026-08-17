<!-- apps/pythinker-web/src/components/UpdateToast.vue -->
<!-- Desktop-only prompt: a new version is ready (or waiting to download).
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

let removeListener: (() => void) | undefined;

function readSkipped(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const visible = computed(() => {
  const current = state.value;
  if (current === undefined) return false;
  if (current.status !== 'downloaded' && !(current.status === 'available' && !current.autoUpdate)) {
    return false;
  }
  return !skipped.value.includes(current.version ?? '');
});

const title = computed(() =>
  state.value?.version
    ? t('update.availableVersion', { version: state.value.version })
    : t('update.available'),
);

async function primary(): Promise<void> {
  if (bridge === undefined || busy.value) return;
  busy.value = true;
  try {
    state.value = await bridge.quitAndInstall();
  } finally {
    busy.value = false;
  }
}

function skip(): void {
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
    state.value = { status: 'downloaded', version: '0.0.0-dev', autoUpdate: true };
    return;
  }
  if (bridge === undefined) return;
  removeListener = bridge.onUpdateState((next) => {
    state.value = next;
  });
  void bridge.getUpdateState().then((next) => {
    state.value = next;
  }, () => {
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
      <div class="msg">{{ t('update.prompt') }}</div>
    </div>
    <div class="acts">
      <button type="button" class="skip" @click="skip">{{ t('update.skip') }}</button>
      <button type="button" class="go" :disabled="busy" @click="void primary()">{{ t('update.install') }}</button>
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
.msg { margin-top: 2px; color: var(--muted); }
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
