<!-- apps/pythinker-web/src/components/ui/ErrorBoundary.vue -->
<!-- Catches a render/setup error thrown by anything in the default slot and
     shows a recoverable panel in its place, so one broken view cannot take the
     whole app down with it. `retry` remounts the subtree by bumping a key. -->
<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from './Button.vue';
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

withDefaults(
  defineProps<{
    /** Cover the viewport instead of filling the parent box. */
    fullscreen?: boolean;
    /** Show the corner close button (emits `close`). */
    closable?: boolean;
    /** Replaces the generic title — e.g. `common.asyncLoadFailed`. */
    message?: string;
  }>(),
  { fullscreen: false, closable: false },
);

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const failed = ref(false);

onErrorCaptured((error) => {
  failed.value = true;
  // Reported once here; the boundary swallows it so the parent tree survives.
  console.error('[error-boundary]', error);
  return false;
});

// Clearing the flag swaps the v-if branch, which remounts the slot subtree.
function retry(): void {
  failed.value = false;
}

defineExpose({ failed, retry });
</script>

<template>
  <div v-if="failed" class="error-boundary" :class="{ fullscreen }" role="alert">
    <IconButton
      v-if="closable"
      class="error-boundary-close"
      size="sm"
      :label="t('thinking.close')"
      @click="emit('close')"
    >
      <Icon name="close" size="sm" />
    </IconButton>
    <Icon class="error-boundary-icon" name="alert-triangle" size="lg" />
    <p class="error-boundary-title">{{ message ?? t('common.errorBoundaryTitle') }}</p>
    <Button variant="secondary" size="sm" @click="retry">
      {{ t('common.errorBoundaryRetry') }}
    </Button>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-6);
}
.error-boundary.fullscreen {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--color-bg);
}
.error-boundary-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
}
.error-boundary-icon {
  color: var(--color-warning);
}
.error-boundary-title {
  margin: 0;
  font: var(--text-sm)/var(--leading-normal) var(--font-ui);
  color: var(--color-text-muted);
}
</style>
