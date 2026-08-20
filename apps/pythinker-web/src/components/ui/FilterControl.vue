<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { IconName } from '../../lib/icons';
import Icon from './Icon.vue';
import Menu from './Menu.vue';
import MenuItem from './MenuItem.vue';
import Pill from './Pill.vue';
import SegmentedControl from './SegmentedControl.vue';

type FilterOption = {
  value: string;
  label: string;
  icon?: string;
};

const props = defineProps<{
  modelValue: string;
  options: FilterOption[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const current = computed(() => props.options.find((option) => option.value === props.modelValue));
const menuItemSize = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches
  ? 'lg'
  : 'md';
const root = ref<HTMLElement | null>(null);
const compressed = ref(false);
let segmentedWidth = 0;
let resizeObserver: ResizeObserver | null = null;

async function evaluateCompression(): Promise<void> {
  const head = root.value?.closest<HTMLElement>('.dock-work-head');
  if (!head) return;

  const tab = head.querySelector<HTMLElement>('.wp-head-tab');
  const style = getComputedStyle(head);
  const gap = (Number.parseFloat(style.columnGap) || 0) * 2;
  const available = head.clientWidth
    - Number.parseFloat(style.paddingLeft)
    - Number.parseFloat(style.paddingRight)
    - gap;
  const tabWidth = tab?.scrollWidth ?? 0;

  if (!compressed.value) {
    const segmented = root.value?.querySelector<HTMLElement>('.ui-seg');
    if (segmented && segmented.offsetWidth > 0) segmentedWidth = segmented.offsetWidth;
  }

  const shouldCompress = tabWidth + segmentedWidth > available;
  compressed.value = shouldCompress;

  if (!shouldCompress) {
    await nextTick();
    const segmented = root.value?.querySelector<HTMLElement>('.ui-seg');
    if (segmented && segmented.offsetWidth > 0) segmentedWidth = segmented.offsetWidth;
    compressed.value = tabWidth + segmentedWidth > available;
  }
}

const open = ref(false);
const triggerRef = ref<InstanceType<typeof Pill> | null>(null);
const menuBoxRef = ref<HTMLElement | null>(null);
const menuStyle = ref<Record<string, string>>({ left: '0px', top: '0px' });

function triggerElement(): HTMLElement | null {
  return (triggerRef.value?.$el as HTMLElement | undefined) ?? null;
}

async function toggleMenu(): Promise<void> {
  if (open.value) {
    closeMenu();
    return;
  }

  open.value = true;
  await nextTick();
  positionMenu();
  focusMenu();
  window.addEventListener('mousedown', onOutsideMouseDown, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', positionMenu, true);
}

function closeMenu(options?: { refocus?: boolean }): void {
  open.value = false;
  window.removeEventListener('mousedown', onOutsideMouseDown, true);
  window.removeEventListener('keydown', onWindowKeyDown, true);
  window.removeEventListener('resize', positionMenu);
  window.removeEventListener('scroll', positionMenu, true);
  if (options?.refocus) triggerElement()?.focus();
}

function positionMenu(): void {
  const trigger = triggerElement();
  if (!trigger) return;

  const rect = trigger.getBoundingClientRect();
  const menuHeight = menuBoxRef.value?.offsetHeight ?? 0;
  const rootStyle = getComputedStyle(document.documentElement);
  const space2 = Number.parseFloat(rootStyle.getPropertyValue('--space-2')) || 0;
  const space1 = Number.parseFloat(rootStyle.getPropertyValue('--space-1')) || 0;
  const menuWidth = menuBoxRef.value?.offsetWidth ?? 0;
  const left = Math.min(rect.left, Math.max(space2, window.innerWidth - menuWidth - space2));

  if (rect.bottom + space1 + menuHeight <= window.innerHeight - space2) {
    menuStyle.value = { left: `${left}px`, top: `${rect.bottom + space1}px` };
  } else {
    menuStyle.value = { left: `${left}px`, bottom: `${window.innerHeight - rect.top + space1}px` };
  }
}

function focusMenu(): void {
  const menu = menuBoxRef.value;
  if (!menu) return;
  const item = menu.querySelector<HTMLElement>('.ui-menu-item.is-active')
    ?? menu.querySelector<HTMLElement>('.ui-menu-item');
  item?.focus();
}

function openMenu(): void {
  if (!open.value) void toggleMenu();
}

function onFocusOut(event: FocusEvent): void {
  const related = event.relatedTarget as Node | null;
  if (related && (menuBoxRef.value?.contains(related) || triggerElement()?.contains(related))) return;
  closeMenu();
}

function onOutsideMouseDown(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (!target) return;
  if (menuBoxRef.value?.contains(target)) {
    event.stopImmediatePropagation();
    return;
  }
  if (!triggerElement()?.contains(target)) closeMenu();
}

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeMenu({ refocus: true });
}

function onMenuKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = Array.from(menuBoxRef.value?.querySelectorAll<HTMLElement>('.ui-menu-item') ?? []);
  if (items.length === 0) return;
  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const nextIndex = event.key === 'ArrowDown'
    ? (currentIndex + 1) % items.length
    : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
}

function select(value: string): void {
  emit('update:modelValue', value);
  closeMenu({ refocus: true });
}

onMounted(() => {
  const head = root.value?.closest<HTMLElement>('.dock-work-head');
  if (!head || typeof ResizeObserver !== 'function') return;
  resizeObserver = new ResizeObserver(() => void evaluateCompression());
  resizeObserver.observe(head);
  void evaluateCompression();
});

watch(compressed, (value) => {
  if (!value && open.value) closeMenu();
});

watch(
  () => props.options,
  async () => {
    segmentedWidth = 0;
    await nextTick();
    await evaluateCompression();
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (open.value) closeMenu();
});
</script>

<template>
  <span ref="root" class="filter-control">
    <template v-if="compressed">
      <Pill
        ref="triggerRef"
        class="fc-trigger"
        aria-haspopup="menu"
        :aria-expanded="open"
        @click="toggleMenu"
        @keydown.down.prevent="openMenu"
        @keydown.up.prevent="openMenu"
        @focusout="onFocusOut"
      >
        <Icon v-if="current?.icon" :name="current.icon as IconName" size="sm" />
        <span>{{ current?.label }}</span>
        <Icon class="fc-chevron" name="chevron-down" size="sm" />
      </Pill>

      <Teleport to="body">
        <div
          v-if="open"
          ref="menuBoxRef"
          class="fc-menu"
          :style="menuStyle"
          @keydown="onMenuKeyDown"
          @focusout="onFocusOut"
        >
          <Menu>
            <MenuItem
              v-for="option in options"
              :key="option.value"
              role="menuitemradio"
              :active="option.value === modelValue"
              :aria-checked="option.value === modelValue"
              :size="menuItemSize"
              @click="select(option.value)"
            >
              <Icon
                v-if="option.icon"
                :name="option.icon as IconName"
                size="sm"
                :data-icon="option.icon"
              />
              <span class="fc-label">{{ option.label }}</span>
              <Icon
                v-if="option.value === modelValue"
                class="fc-check"
                name="check"
                size="sm"
              />
            </MenuItem>
          </Menu>
        </div>
      </Teleport>
    </template>

    <SegmentedControl
      v-else
      :model-value="modelValue"
      :options="options"
      size="md"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </span>
</template>

<style scoped>
.filter-control {
  display: inline-flex;
  min-width: 0;
}

.fc-chevron {
  color: var(--color-text-faint);
  transition: transform var(--duration-base) var(--ease-out);
}

.fc-trigger[aria-expanded='true'] .fc-chevron {
  transform: rotate(180deg);
}

.fc-menu {
  position: fixed;
  z-index: var(--z-dropdown);
}

.fc-menu :deep(.ui-menu) {
  min-width: 0;
}

.fc-label {
  flex: 1;
  white-space: nowrap;
}

.filter-control :deep(.ui-seg__item[data-icon='circle-check'] .ui-seg__icon),
.fc-menu :deep(.kw-icon[data-icon='circle-check']) {
  transform: scale(0.91);
}

.fc-check {
  color: var(--color-accent);
}
</style>
