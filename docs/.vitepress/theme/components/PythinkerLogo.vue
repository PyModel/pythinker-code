<script setup lang="ts">
import logoUrl from '../Pythinker.png'

withDefaults(defineProps<{ size?: number }>(), { size: 56 })
</script>

<template>
  <img
    class="PythinkerLogo"
    :src="logoUrl"
    :width="size"
    :height="size"
    alt="Pythinker"
  />
</template>

<style scoped>
.PythinkerLogo {
  display: block;
  object-fit: contain;
}
</style>
