<script lang="ts">
export interface MultiSelectOption {
  id: string;
  name: string;
}

export function filterMultiSelectOptions(options: MultiSelectOption[], query: string): MultiSelectOption[] {
  const needle = query.trim().toLowerCase();
  return needle === '' ? options : options.filter((option) => option.name.toLowerCase().includes(needle));
}

export function toggleMultiSelectValue(values: string[], id: string): string[] {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Checkbox from './Checkbox.vue';
import Icon from './Icon.vue';
import Input from './Input.vue';
import Menu from './Menu.vue';

const props = defineProps<{
  modelValue: string[];
  label: string;
  options: MultiSelectOption[];
  allLabel: string;
  searchPlaceholder: string;
  selectAllLabel: string;
  emptyLabel: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const { t } = useI18n();
const root = ref<HTMLElement | null>(null);
const searchInput = ref<InstanceType<typeof Input> | null>(null);
const open = ref(false);
const query = ref('');
const selected = computed(() => props.options.filter((option) => props.modelValue.includes(option.id)));
const shownTags = computed(() => selected.value.slice(0, 2));
const filtered = computed(() => filterMultiSelectOptions(props.options, query.value));
const allSelected = computed(() => props.options.length > 0 && props.modelValue.length === props.options.length);

async function toggleOpen(): Promise<void> {
  open.value = !open.value;
  if (open.value) {
    document.addEventListener('mousedown', onOutside);
    await nextTick();
    searchInput.value?.focus();
  } else close();
}

function close(): void {
  open.value = false;
  query.value = '';
  document.removeEventListener('mousedown', onOutside);
}

function onOutside(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) close();
}

function toggleValue(id: string): void {
  emit('update:modelValue', toggleMultiSelectValue(props.modelValue, id));
}

function toggleAll(): void {
  emit('update:modelValue', allSelected.value ? [] : props.options.map((option) => option.id));
}

onBeforeUnmount(close);
</script>

<template>
  <div ref="root" class="multi-select">
    <div
      class="multi-select__trigger"
      role="button"
      tabindex="0"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-label="label"
      @click="toggleOpen"
      @keydown.enter.prevent="toggleOpen"
      @keydown.space.prevent="toggleOpen"
      @keydown.esc.prevent="close"
    >
      <span v-if="selected.length === 0" class="multi-select__placeholder">{{ allLabel }}</span>
      <span v-for="option in shownTags" v-else :key="option.id" class="multi-select__tag">
        <span>{{ option.name }}</span>
        <button
          class="multi-select__remove"
          type="button"
          :aria-label="t('admin.removeTag', { name: option.name })"
          @click.stop="toggleValue(option.id)"
          @keydown.enter.stop.prevent="toggleValue(option.id)"
        ><Icon name="close" size="sm" /></button>
      </span>
      <span v-if="selected.length > shownTags.length" class="multi-select__more">+{{ selected.length - shownTags.length }}</span>
      <Icon name="chevron-down" size="sm" />
    </div>
    <Menu v-if="open" class="multi-select__menu" role="dialog" @keydown.esc.prevent="close">
      <div class="multi-select__search">
        <Input ref="searchInput" v-model="query" size="sm" :placeholder="searchPlaceholder" />
      </div>
      <div class="multi-select__option" @click="toggleAll">
        <span @click.stop><Checkbox :model-value="allSelected" @update:model-value="toggleAll" /></span>
        {{ selectAllLabel }}
      </div>
      <div class="multi-select__separator" role="separator" />
      <div class="multi-select__options">
        <div v-for="option in filtered" :key="option.id" class="multi-select__option" :class="{ active: modelValue.includes(option.id) }" @click="toggleValue(option.id)">
          <span @click.stop><Checkbox :model-value="modelValue.includes(option.id)" @update:model-value="toggleValue(option.id)" /></span>
          <span class="multi-select__name">{{ option.name }}</span>
        </div>
        <div v-if="filtered.length === 0" class="multi-select__empty">{{ emptyLabel }}</div>
      </div>
    </Menu>
  </div>
</template>

<style scoped>
.multi-select { position: relative; min-width: 0; }
.multi-select__trigger {
  min-height: 32px;
  max-width: 320px;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.multi-select__trigger:hover { background: var(--color-hover); }
.multi-select__trigger:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.multi-select__placeholder { padding: 0 var(--space-1); color: var(--color-text-muted); }
.multi-select__tag { min-width: 0; display: inline-flex; align-items: center; gap: var(--space-1); padding: 2px 6px; border-radius: var(--radius-full); background: var(--color-surface-sunken); }
.multi-select__tag > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.multi-select__remove { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: var(--radius-full); }
.multi-select__remove { padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.multi-select__remove:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.multi-select__more { color: var(--color-text-muted); }
.multi-select__menu { position: absolute; top: calc(100% + var(--space-1)); left: 0; z-index: var(--z-dropdown); width: min(320px, calc(100vw - var(--space-4))); }
.multi-select__search { padding: var(--space-1); }
.multi-select__separator { height: 1px; margin: var(--space-1) 0; background: var(--color-line); }
.multi-select__options { max-height: 240px; overflow: auto; }
.multi-select__option { min-height: 32px; display: flex; align-items: center; gap: var(--space-2); padding: 6px 10px; border-radius: var(--radius-sm); color: var(--color-text); font-size: var(--text-base); cursor: pointer; }
.multi-select__option:hover { background: var(--color-hover); }
.multi-select__option.active { background: var(--color-selected); }
.multi-select__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.multi-select__empty { padding: var(--space-3); color: var(--color-text-muted); text-align: center; }
</style>
