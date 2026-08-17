<script setup lang="ts">
type ChipVariant = 'neutral' | 'active';

const props = withDefaults(defineProps<{
  label?: string;
  variant?: ChipVariant;
}>(), {
  variant: 'neutral',
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button
    type="button"
    class="chip"
    :class="variant"
    @click="emit('click', $event)"
  >
    <span class="icon" aria-hidden="true">
      <span v-if="$slots.icon" class="icon-default"><slot name="icon" /></span>
      <span class="close-glyph">×</span>
    </span>
    <span v-if="label || $slots.label || $slots.default" class="label">
      <slot name="label">{{ label }}<slot /></slot>
    </span>
  </button>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}

.chip.neutral {
  background: var(--panel);
}

.chip.active {
  border-color: color-mix(in srgb, var(--blue) 30%, var(--line));
  background: color-mix(in srgb, var(--soft) 60%, var(--panel));
  color: var(--blue);
}

.chip:hover {
  background: var(--hover);
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  line-height: 1;
}

.icon-default :deep(svg) {
  display: block;
  width: 16px;
  height: 16px;
}

.close-glyph {
  display: none;
  font-size: var(--ui-font-size-lg);
  line-height: 1;
}

.chip:hover .icon-default {
  display: none;
}

.chip:hover .close-glyph {
  display: inline;
}

.label {
  min-width: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
