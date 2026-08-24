<script lang="ts">
export interface FilterSelectOption {
  value: string;
  label: string;
  /** Status-dot variant rendered before the label when set (e.g.
      `open`/`done` in the session-admin filter — same tokens as StatusDot). */
  dot?: string;
}

export function moveOptionFocus(index: number, delta: number, count: number): number {
  return count === 0 ? -1 : (index + delta + count) % count;
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import Icon from './Icon.vue';
import Menu from './Menu.vue';
import MenuItem from './MenuItem.vue';

const props = defineProps<{
  modelValue: string;
  label: string;
  options: FilterSelectOption[];
  ariaLabel?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const current = computed(() => props.options.find((option) => option.value === props.modelValue));

function itemElements(): HTMLElement[] {
  return Array.from(root.value?.querySelectorAll<HTMLElement>('.filter-select__menu button') ?? []);
}

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (open.value) {
    document.addEventListener('mousedown', onOutside);
    await nextTick();
    itemElements()[props.options.findIndex((option) => option.value === props.modelValue)]?.focus();
  } else {
    document.removeEventListener('mousedown', onOutside);
  }
}

function select(value: string): void {
  emit('update:modelValue', value);
  close();
}

function close(): void {
  open.value = false;
  document.removeEventListener('mousedown', onOutside);
}

function onOutside(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close();
}

// Imperative open for call sites that trigger the menu from elsewhere (e.g. a
// keyboard shortcut or an external button).
defineExpose({ open: () => void toggle() });

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    root.value?.querySelector<HTMLButtonElement>('.filter-select__trigger')?.focus();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  if (!open.value) {
    void toggle();
    return;
  }
  const items = itemElements();
  const index = items.indexOf(document.activeElement as HTMLElement);
  items[moveOptionFocus(Math.max(index, 0), event.key === 'ArrowDown' ? 1 : -1, items.length)]?.focus();
}

onBeforeUnmount(close);
</script>

<template>
  <div ref="root" class="filter-select" @keydown="onKeydown">
    <button
      class="filter-select__trigger"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="ariaLabel ?? label"
      @click="toggle"
    >
      <span v-if="label" class="filter-select__label">{{ label }}</span>
      <span class="filter-select__value">{{ current?.label }}</span>
      <Icon name="chevron-down" size="sm" />
    </button>
    <Menu v-if="open" class="filter-select__menu">
      <MenuItem
        v-for="option in options"
        :key="option.value"
        :active="option.value === modelValue"
        @click="select(option.value)"
      >
        <span class="filter-select__check"><Icon v-if="option.value === modelValue" name="check" size="sm" /></span>
        <span v-if="option.dot" class="sa-dot" :class="[`sa-dot--${option.dot}`]" aria-hidden="true" />
        {{ option.label }}
      </MenuItem>
    </Menu>
  </div>
</template>

<style scoped>
.filter-select { position: relative; min-width: 0; }
.filter-select__trigger {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.filter-select__trigger:hover { background: var(--color-hover); }
.filter-select__trigger:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.filter-select__label { color: var(--color-text-muted); }
.filter-select__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-select__menu { position: absolute; top: calc(100% + var(--space-1)); right: 0; z-index: var(--z-dropdown); }
.filter-select__check { width: 16px; flex: none; }
/* Per-option status dot: small filled circle marking the
   option's state; variant classes pick the colour (open/done). */
.sa-dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); }
.sa-dot--open { background: var(--color-success); }
.sa-dot--done { background: var(--color-done); }
</style>
