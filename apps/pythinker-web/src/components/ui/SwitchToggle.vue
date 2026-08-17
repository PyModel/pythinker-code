<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function toggle(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggle();
}
</script>

<template>
  <button
    type="button"
    class="switch-toggle"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="toggle"
    @keydown="onKeydown"
  >
    <span class="track" aria-hidden="true" />
    <span class="thumb" aria-hidden="true" />
  </button>
</template>

<style scoped>
.switch-toggle {
  position: relative;
  width: 28px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: none;
  cursor: pointer;
}

.track,
.thumb {
  position: absolute;
  display: block;
}

.track {
  inset: 0;
  border-radius: 999px;
  background: var(--line);
  transition: background-color 150ms ease;
}

.switch-toggle[aria-checked="true"] .track {
  background: var(--blue);
}

.thumb {
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--panel);
  transition: transform 150ms ease;
}

.switch-toggle[aria-checked="true"] .thumb {
  transform: translateX(12px);
}

.switch-toggle:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

.switch-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
