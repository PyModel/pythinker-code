<!-- apps/pythinker-web/src/components/ui/AsyncLoadFailed.vue -->
<!-- `errorComponent` for a lazily-loaded view whose chunk failed to arrive.
     Same panel as ErrorBoundary, different copy: a chunk that never loaded
     cannot be retried in place, so the reader is told to close the view. -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Icon from './Icon.vue';
import IconButton from './IconButton.vue';

const { t } = useI18n();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="error-boundary fullscreen" role="alert">
    <IconButton
      class="error-boundary-close"
      size="sm"
      :label="t('thinking.close')"
      @click="emit('close')"
    >
      <Icon name="close" size="sm" />
    </IconButton>
    <Icon class="error-boundary-icon" name="alert-triangle" size="lg" />
    <p class="error-boundary-title">{{ t('common.asyncLoadFailed') }}</p>
  </div>
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
