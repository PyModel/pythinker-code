<script setup lang="ts">
import { onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

const { duration = 8000, dismissToken } = defineProps<{
  duration?: number;
  dismissLabel?: string;
  dismissToken?: string | number;
}>();
const emit = defineEmits<{ dismiss: [token?: string | number] }>();
const { t } = useI18n();

let timer: ReturnType<typeof setTimeout> | null = null;
let deadline = 0;
let remaining = duration;

function start(delay: number): void {
  if (delay <= 0) {
    emit('dismiss', dismissToken);
    return;
  }
  timer = setTimeout(() => emit('dismiss', dismissToken), delay);
  deadline = Date.now() + delay;
}

function pause(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  remaining = Math.max(0, deadline - Date.now());
}

function resume(): void {
  if (timer === null) start(remaining);
}

start(duration);
onUnmounted(() => {
  if (timer !== null) clearTimeout(timer);
});
</script>

<template>
  <div class="ui-action-toast-host">
    <div class="ui-action-toast" role="status" @pointerenter="pause" @pointerleave="resume">
      <span class="ui-action-toast__body"><slot /></span>
      <IconButton
        class="ui-action-toast__close"
        size="sm"
        :label="dismissLabel ?? t('common.dismiss')"
        @click="emit('dismiss', dismissToken)"
      ><Icon name="close" size="sm" /></IconButton>
    </div>
  </div>
</template>

<style scoped>
.ui-action-toast-host { pointer-events: none; }
.ui-action-toast { display: flex; align-items: center; gap: var(--space-3); min-width: 260px; max-width: min(420px, calc(100vw - 32px)); padding: var(--space-3); border: 1px solid var(--color-line); border-radius: var(--radius-lg); background: var(--color-surface-raised); box-shadow: var(--shadow-lg); color: var(--color-text); pointer-events: auto; }
.ui-action-toast__body { flex: 1; min-width: 0; font-size: var(--text-sm); }
.ui-action-toast__close { flex: none; }
@media (max-width: 640px) { .ui-action-toast { max-width: none; width: 100%; } }
</style>
