<!-- apps/pythinker-web/src/components/ui/Spinner.vue -->
<!-- Design-system §03 Spinner: the DEFAULT loader. Artwork mirrors the registry
     'loading-spinner' icon (eight rotating ticks) so every loader site shares
     one look; sizes/aria stay local because <Icon> only covers sm/md/lg tokens. -->
<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}>(), {
  size: 'md',
  label: 'Loading',
});
</script>

<template>
  <span class="ui-spinner" :class="`ui-spinner--${size}`" role="status" :aria-label="label">
    <svg class="ui-spinner__svg" viewBox="0 0 24 24" aria-hidden="true">
      <g class="ui-spinner__ring" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="12" y1="2.5" x2="12" y2="6" />
        <line x1="18.72" y1="5.28" x2="16.24" y2="7.76" />
        <line x1="21.5" y1="12" x2="18" y2="12" />
        <line x1="18.72" y1="18.72" x2="16.24" y2="16.24" />
        <line x1="12" y1="21.5" x2="12" y2="18" />
        <line x1="5.28" y1="18.72" x2="7.76" y2="16.24" />
        <line x1="2.5" y1="12" x2="6" y2="12" />
        <line x1="5.28" y1="5.28" x2="7.76" y2="7.76" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
.ui-spinner { display: inline-flex; flex: none; color: var(--color-accent); }
.ui-spinner--sm { width: 14px; height: 14px; }
.ui-spinner--md { width: 18px; height: 18px; }
.ui-spinner--lg { width: 28px; height: 28px; }

.ui-spinner__svg { width: 100%; height: 100%; animation: ui-spinner-rotate 0.8s linear infinite; }
.ui-spinner__ring { fill: none; }

@keyframes ui-spinner-rotate {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-spinner__svg { animation-duration: 1.6s; }
}
</style>
