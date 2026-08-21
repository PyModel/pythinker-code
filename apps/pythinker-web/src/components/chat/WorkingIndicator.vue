<script setup lang="ts">
import MascotSprite from '../MascotSprite.vue';

defineProps<{ label: string }>();
</script>

<template>
  <div class="working-indicator" role="status">
    <span class="wi-mascot" aria-hidden="true">
      <MascotSprite state="running" :size="40" />
    </span>
    <span class="wi-label">{{ label }}</span>
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
.wi-label { animation: wi-breathe 1.6s var(--ease-in-out) infinite; }
@keyframes wi-breathe {
  0%, to { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .wi-label { animation: none; }
}
</style>
