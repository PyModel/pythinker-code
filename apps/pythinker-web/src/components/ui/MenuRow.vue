<script setup lang="ts">
withDefaults(defineProps<{
  count?: number;
  active?: boolean;
  selected?: boolean;
  disabled?: boolean;
}>(), {
  active: false,
  selected: false,
  disabled: false,
});
</script>

<template>
  <button
    type="button"
    class="menu-row"
    :class="{ active, selected, disabled }"
    :disabled="disabled"
  >
    <span v-if="$slots.leading" class="leading"><slot name="leading" /></span>
    <span class="label">
      <slot name="label"><slot /></slot>
    </span>
    <span v-if="count !== undefined" class="count">{{ count }}</span>
    <span v-if="$slots.trailing" class="trailing"><slot name="trailing" /></span>
  </button>
</template>

<style scoped>
.menu-row {
  /* Default 14px: 14 + 13 = 27px; 14 - 1 = 13px. */
  width: 100%;
  height: calc(var(--ui-font-size) + 13px);
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-md);
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: calc(var(--ui-font-size) - 1px);
  font-weight: 400;
  line-height: 1;
  text-align: left;
  cursor: pointer;
}

.menu-row:hover {
  background: var(--hover);
}

.menu-row.active,
.menu-row.selected {
  background: color-mix(in srgb, var(--soft) 45%, var(--panel));
}

.menu-row:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

.menu-row.disabled,
.menu-row:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.leading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
}

.leading :deep(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  flex: none;
  color: var(--muted);
}

.trailing {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  margin-left: auto;
}
</style>
