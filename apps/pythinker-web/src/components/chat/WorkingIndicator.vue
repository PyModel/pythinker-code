<script setup lang="ts">
import MascotSprite from '../MascotSprite.vue';

defineProps<{ label: string }>();
</script>

<template>
  <div class="working-indicator" role="status">
    <span class="wi-mascot" aria-hidden="true">
      <MascotSprite state="running" :size="40" />
    </span>
    <span class="wi-label ui-shimmer">{{ label }}</span>
  </div>
</template>

<style scoped>
.working-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  font: var(--text-sm)/var(--leading-normal) var(--font-ui);
  color: var(--color-text-muted);
}
.wi-mascot { flex: none; width: 40px; }
</style>
