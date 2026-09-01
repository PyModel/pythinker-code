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
        :tooltip="dismissLabel ?? t('common.dismiss')"
        @click="emit('dismiss', dismissToken)"
      ><Icon name="close" size="sm" /></IconButton>
    </div>
  </div>
</template>

<style scoped>
.ui-action-toast-host { position: absolute; right: max(var(--space-4), calc((100% - var(--read-max)) / 2 + var(--space-4))); bottom: calc(var(--dock-h, 76px) + var(--space-2)); z-index: var(--z-toast); max-width: calc(100vw - 32px); }
.ui-action-toast { display: flex; align-items: center; gap: var(--space-2); padding: 4px 6px 4px 14px; background: var(--color-surface-raised); border: 0.5px solid var(--color-line); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); color: var(--color-text); font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.45; white-space: nowrap; }
.ui-action-toast__body { min-width: 0; }
.ui-action-toast__body :deep(button) { margin-inline: var(--space-1); padding: 0; border: 0; background: none; color: var(--color-accent); cursor: pointer; font: inherit; }
.ui-action-toast__body :deep(button:hover) { color: var(--color-accent-hover); text-decoration: underline; }
.ui-action-toast__body :deep(button:focus-visible) { outline: none; border-radius: var(--radius-xs); box-shadow: var(--p-focus-ring); }
.ui-action-toast__close { flex: none; }

@media (max-width: 640px) {
  .ui-action-toast-host { right: var(--space-3); left: var(--space-3); }
  .ui-action-toast { white-space: normal; }
}
</style>
