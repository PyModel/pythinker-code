<!-- Pythinker robot mascot — same mark as install.sh / public/pythinker_animated.svg -->
<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg' | 'xl';
    animated?: boolean;
    label?: string;
    interactive?: boolean;
  }>(),
  {
    size: 'sm',
    animated: true,
    label: 'Pythinker Code',
    interactive: false,
  },
);

const emit = defineEmits<{ click: [] }>();

function onClick(): void {
  if (!props.interactive) return;
  emit('click');
}
</script>

<template>
  <img
    :src="animated ? '/pythinker_animated.svg' : '/icon.svg'"
    class="pythinker-logo"
    :class="[`size-${size}`, { interactive }]"
    :alt="label"
    :role="interactive ? 'button' : 'img'"
    @click="onClick"
  />
</template>

<style scoped>
.pythinker-logo {
  display: block;
  object-fit: contain;
  flex: none;
}
.size-sm {
  height: 28px;
  width: auto;
}
.size-md {
  height: 44px;
  width: auto;
}
.size-lg {
  height: 64px;
  width: auto;
}
.size-xl {
  height: 96px;
  width: auto;
}
.pythinker-logo.interactive {
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.18s ease;
}
.pythinker-logo.interactive:hover {
  transform: scale(1.06);
}
@media (prefers-reduced-motion: reduce) {
  .pythinker-logo.interactive:hover {
    transform: none;
  }
}
</style>
