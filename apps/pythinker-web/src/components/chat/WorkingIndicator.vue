<script setup lang="ts">
import Spinner from '../ui/Spinner.vue';

defineProps<{ label: string }>();
</script>

<template>
  <div class="working-indicator" role="status">
    <Spinner size="sm" :label="label" />
    <span class="wi-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.working-indicator { display: inline-flex; align-items: center; gap: var(--space-2); align-self: flex-start; font: var(--text-sm)/var(--leading-normal) var(--font-ui); color: var(--color-text-muted); }
</style>
