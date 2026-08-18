<!-- apps/pythinker-web/src/components/ui/ThinkingIndicator.vue -->
<!-- The chat waiting indicator. Keep the exact Braille mark consistent with the TUI. -->
<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg';
  fast?: boolean;
  label?: string;
}>(), {
  size: 'md',
  label: 'Waiting for response…',
});
</script>

<template>
  <span
    class="ui-thinking-indicator"
    :class="[
      `ui-thinking-indicator--${size}`,
      { 'ui-thinking-indicator--fast': fast },
    ]"
    :aria-label="label"
    role="status"
  >
    <span aria-hidden="true">⣷</span>
  </span>
</template>

<style scoped>
.ui-thinking-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 1;
  color: var(--color-accent);
  font-family: var(--font-mono);
  user-select: none;
  animation: ui-thinking-indicator-pulse 960ms ease-in-out infinite alternate;
}
.ui-thinking-indicator--sm { width: 14px; height: 14px; font-size: 14px; }
.ui-thinking-indicator--md { width: 18px; height: 18px; font-size: 18px; }
.ui-thinking-indicator--lg { width: 24px; height: 24px; font-size: 24px; }
.ui-thinking-indicator--fast { animation-duration: 480ms; }

@keyframes ui-thinking-indicator-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-thinking-indicator { animation: none; }
}
</style>
