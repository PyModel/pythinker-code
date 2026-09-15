<!-- apps/pythinker-web/src/components/ui/WorkspaceGuideArrow.vue -->
<!-- Clean curved SVG arrow annotation pointing to the workspace folder picker. -->
<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    direction?: 'left' | 'right';
  }>(),
  {
    label: '',
    direction: 'left',
  },
);
</script>

<template>
  <div class="ws-guide-arrow" :class="`dir-${direction}`" aria-hidden="true">
    <svg class="ws-guide-arrow__svg" viewBox="0 0 40 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M 37 8 C 25 4, 13 8, 4 8"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <path
        d="M 8 5 L 3 8 L 8 11"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="label" class="ws-guide-arrow__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.ws-guide-arrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 16px;
  color: var(--color-text-faint);
  pointer-events: none;
  user-select: none;
  white-space: nowrap;
  transition: color var(--duration-base) var(--ease-out);
}

.ws-guide-arrow__svg {
  width: 40px;
  height: 16px;
  flex: none;
  overflow: visible;
  color: inherit;
}

.ws-guide-arrow__label {
  font: var(--text-xs)/1 var(--font-ui);
  letter-spacing: -0.01em;
  color: inherit;
}

.dir-right {
  flex-direction: row-reverse;
}

.dir-right .ws-guide-arrow__svg {
  transform: scaleX(-1);
}

@media (max-width: 720px) {
  .ws-guide-arrow {
    display: none;
  }
}
</style>
