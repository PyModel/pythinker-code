<script setup lang="ts">
defineProps<{
  name: string;
  mono?: boolean;
  off?: boolean;
}>();

defineSlots<{
  glyph(): unknown;
  default(): unknown;
  actions(): unknown;
  detail(): unknown;
}>();
</script>

<template>
  <div class="listing-row" :class="{ off }">
    <div class="listing-top">
      <div class="listing-main">
        <slot name="glyph" />
        <span class="listing-name" :class="{ mono }">{{ name }}</span>
        <slot />
      </div>
      <div class="row-actions">
        <slot name="actions" />
      </div>
    </div>
    <slot name="detail" />
  </div>
</template>

<style scoped src="./settings.css"></style>
