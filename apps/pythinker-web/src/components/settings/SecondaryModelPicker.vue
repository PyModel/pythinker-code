<!-- apps/pythinker-web/src/components/settings/SecondaryModelPicker.vue -->
<!-- Two-level model picker for the secondary (subagent) model: a provider-
     grouped model list with a per-model thinking-effort flyout. The trigger
     label reads `model · effort`. -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppModel } from '../../api/types';
import { segmentsFor } from '../../lib/modelThinking';
import Icon from '../ui/Icon.vue';

export interface SecondaryModelOption {
  id: string;
  label: string;
}

export interface SecondaryModelGroup {
  provider: string;
  options: SecondaryModelOption[];
}

export interface SecondaryModelSelection {
  model: string;
  effort?: string;
}

const props = defineProps<{
  modelValue: string;
  effort: string;
  groups: SecondaryModelGroup[];
  modelInfoById: Record<string, AppModel>;
  /** True while the parent config is saving; the trigger stops opening. */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [selection: SecondaryModelSelection];
}>();

const { t } = useI18n();

const menuId = `sm-picker-${Math.random().toString(36).slice(2, 9)}`;

// ---------------------------------------------------------------------------
// State (open menu, hovered model with flyout,
// pane focus for keyboard nav)
// ---------------------------------------------------------------------------
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const flyoutRef = ref<HTMLDivElement | null>(null);

const opened = ref(false);
const upward = ref(false); // menu opens above the trigger when it would overflow
const menuStyle = ref<Record<string, string>>({});
const hoveredModel = ref<string | null>(null);
const activeModel = ref('');
const activeModelIndex = ref(0);
const pane = ref<'models' | 'efforts'>('models');
const effortIndex = ref(0);
const flyoutTop = ref(0);
const flyoutSide = ref<'right' | 'left'>('right');

const optionEls = new Map<string, HTMLElement>();

const FLYOUT_DELAY_MS = 250;
const FLYOUT_FLIP_PX = 188;

let closeTimer: ReturnType<typeof setTimeout> | null = null;

const flat = computed<SecondaryModelOption[]>(() => props.groups.flatMap((group) => group.options));

const selectedLabel = computed(() =>
  props.modelValue
    ? (flat.value.find((option) => option.id === props.modelValue)?.label ?? props.modelValue)
    : '',
);

const triggerLabel = computed(() =>
  props.modelValue
    ? props.effort
      ? `${selectedLabel.value} · ${props.effort}`
      : selectedLabel.value
    : t('settings.noSecondaryModel'),
);

/** Effort options for the hovered model: `null` is the "model default" entry,
 *  shown only while no effort is set. A stored effort the model no longer
 *  declares stays in the list so the current selection stays visible. */
const effortOptions = computed<(string | null)[]>(() => {
  const model = hoveredModel.value;
  if (model === null) return [];
  const segments = segmentsFor(props.modelInfoById[model]);
  const options = props.effort === '' ? [null, ...segments] : [...segments];
  if (
    props.modelValue === model &&
    props.effort !== '' &&
    !segments.includes(props.effort)
  ) {
    options.push(props.effort);
  }
  return options;
});

function isSelectedEffort(option: string | null): boolean {
  if (props.modelValue !== hoveredModel.value) return false;
  return option === null ? props.effort === '' : props.effort === option;
}

function selectedEffortIndex(): number {
  const index = effortOptions.value.findIndex(isSelectedEffort);
  return index >= 0 ? index : 0;
}

function setOptionEl(el: unknown, id: string): void {
  if (el instanceof HTMLElement) optionEls.set(id, el);
  else optionEls.delete(id);
}

// ---------------------------------------------------------------------------
// Flyout open/close timing
// ---------------------------------------------------------------------------
function cancelClose(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function scheduleClose(): void {
  cancelClose();
  closeTimer = setTimeout(() => {
    hoveredModel.value = null;
    if (pane.value === 'efforts') pane.value = 'models';
  }, FLYOUT_DELAY_MS);
}

function setActiveModel(id: string): void {
  if (id !== activeModel.value) {
    activeModel.value = id;
    activeModelIndex.value = Math.max(0, flat.value.findIndex((option) => option.id === id));
  }
}

// ---------------------------------------------------------------------------
// Positioning (menu fixed against the trigger; flyout absolute over the
// hovered option row, flipping side + up to stay in the viewport)
// ---------------------------------------------------------------------------
function positionMenu(): void {
  const trigger = triggerRef.value;
  const menu = menuRef.value;
  if (!trigger || !menu) return;
  const triggerRect = trigger.getBoundingClientRect();
  const menuHeight = menu.offsetHeight;
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  upward.value = spaceBelow < menuHeight + 8 && triggerRect.top > menuHeight;
  const right = Math.max(8, window.innerWidth - triggerRect.right);
  menuStyle.value = upward.value
    ? {
        right: `${right}px`,
        bottom: `${window.innerHeight - triggerRect.top + 4}px`,
        top: 'auto',
      }
    : {
        right: `${right}px`,
        top: `${triggerRect.bottom + 4}px`,
        bottom: 'auto',
      };
}

function positionFlyout(): void {
  const menu = menuRef.value;
  const option = hoveredModel.value === null ? undefined : optionEls.get(hoveredModel.value);
  if (!menu || !option) return;
  const menuRect = menu.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  const flyoutHeight = flyoutRef.value?.offsetHeight ?? 0;
  const maxTop = Math.max(0, window.innerHeight - 8 - flyoutHeight - menuRect.top);
  flyoutTop.value = Math.max(0, Math.min(optionRect.top - menuRect.top - 4, menu.offsetHeight - 40, maxTop));
  const spaceRight = window.innerWidth - menuRect.right;
  flyoutSide.value = spaceRight >= FLYOUT_FLIP_PX || spaceRight >= menuRect.left ? 'right' : 'left';
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------
function open(): void {
  if (opened.value || props.disabled) return;
  opened.value = true;
  activeModel.value = props.modelValue || flat.value[0]?.id || '';
  activeModelIndex.value = Math.max(0, flat.value.findIndex((option) => option.id === activeModel.value));
  hoveredModel.value = null;
  pane.value = 'models';
  void nextTick(positionMenu);
}

function close({ restoreFocus = false }: { restoreFocus?: boolean } = {}): void {
  if (!opened.value) return;
  cancelClose();
  opened.value = false;
  hoveredModel.value = null;
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus());
}

function toggle(): void {
  if (opened.value) close({ restoreFocus: true });
  else open();
}

function hideFlyout(): void {
  hoveredModel.value = null;
  pane.value = 'models';
}

/** Hover/activate a model row; `moveFocus` also pushes keyboard focus into the
 *  effort flyout. */
function focusModel(id: string, { moveFocus = false } = {}): void {
  setActiveModel(id);
  cancelClose();
  hoveredModel.value = id;
  void nextTick(positionFlyout);
  if (moveFocus) {
    pane.value = 'efforts';
    effortIndex.value = selectedEffortIndex();
  }
}

function commit(option: string | null): void {
  const model = hoveredModel.value;
  if (model === null) return;
  const selection: SecondaryModelSelection = {
    model,
    ...(option === null ? {} : { effort: option }),
  };
  if (selection.model !== props.modelValue || (selection.effort ?? '') !== props.effort) {
    emit('select', selection);
  }
  close({ restoreFocus: true });
}

// Keep the keyboard-active option visible inside the scrollable list.
function scrollActiveIntoView(): void {
  void nextTick(() => {
    menuRef.value
      ?.querySelector('.sm-picker__option.is-kb-active')
      ?.scrollIntoView({ block: 'nearest' });
  });
}

// ---------------------------------------------------------------------------
// Keyboard navigation (models pane ↕, flyout pane →, Esc/← back)
// ---------------------------------------------------------------------------
function stepModel(delta: number): void {
  const options = flat.value;
  if (options.length === 0) return;
  const next = options[(activeModelIndex.value + delta + options.length) % options.length]!;
  setActiveModel(next.id);
  if (hoveredModel.value !== null) focusModel(next.id);
  scrollActiveIntoView();
}

function stepEffort(delta: number): void {
  const options = effortOptions.value;
  if (options.length === 0) return;
  effortIndex.value = (effortIndex.value + delta + options.length) % options.length;
  scrollActiveIntoView();
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (!opened.value) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      open();
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (pane.value === 'models') stepModel(1);
    else stepEffort(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (pane.value === 'models') stepModel(-1);
    else stepEffort(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    focusModel(activeModel.value, { moveFocus: true });
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (hoveredModel.value !== null) hideFlyout();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (pane.value === 'models') focusModel(activeModel.value, { moveFocus: true });
    else commit(effortOptions.value[effortIndex.value] ?? null);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const toFirst = event.key === 'Home';
    if (pane.value === 'models') {
      const options = flat.value;
      if (options.length === 0) return;
      const id = (toFirst ? options[0] : options.at(-1))!.id;
      setActiveModel(id);
      if (hoveredModel.value !== null) focusModel(id);
    } else {
      effortIndex.value = toFirst ? 0 : effortOptions.value.length - 1;
    }
    scrollActiveIntoView();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close({ restoreFocus: true });
  }
}

// ---------------------------------------------------------------------------
// Global listeners: click-outside, scroll + resize repositioning
// ---------------------------------------------------------------------------
function onPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (triggerRef.value?.contains(target) || menuRef.value?.contains(target)) return;
  close();
}

function onScroll(event: Event): void {
  if (!opened.value) return;
  if (menuRef.value?.contains(event.target instanceof Node ? event.target : null)) {
    positionFlyout();
    return;
  }
  close();
  positionMenu();
}

function onResize(): void {
  if (opened.value) positionMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
  cancelClose();
});
</script>

<template>
  <div class="sm-picker" :class="{ 'is-open': opened }">
    <button
      ref="triggerRef"
      class="sm-picker__trigger"
      type="button"
      role="combobox"
      :aria-controls="menuId"
      :aria-expanded="opened"
      aria-haspopup="dialog"
      :aria-label="t('settings.secondaryModel')"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <span class="sm-picker__value" :class="{ 'is-placeholder': !modelValue }">
        <span>{{ triggerLabel }}</span>
      </span>
      <Icon class="sm-picker__chevron" name="chevron-down" size="sm" />
    </button>

    <Teleport to="body">
      <div
        v-if="opened"
        :id="menuId"
        ref="menuRef"
        class="sm-picker__menu"
        :class="{ 'sm-picker__menu--up': upward }"
        :style="menuStyle"
        role="dialog"
        :aria-label="t('settings.secondaryModel')"
      >
        <div class="sm-picker__models" role="listbox" :aria-label="t('settings.secondaryModel')">
          <template v-for="group in groups" :key="group.provider">
            <div class="sm-picker__group">{{ group.provider }}</div>
            <button
              v-for="option in group.options"
              :key="option.id"
              :ref="(el) => setOptionEl(el, option.id)"
              type="button"
              class="sm-picker__option"
              :class="{
                'is-selected': option.id === modelValue,
                'is-active': option.id === activeModel,
                'is-kb-active': pane === 'models' && option.id === activeModel,
              }"
              role="option"
              :aria-selected="option.id === modelValue"
              @mouseenter="focusModel(option.id)"
              @mouseleave="scheduleClose"
              @click="focusModel(option.id, { moveFocus: true })"
            >
              <Icon class="sm-picker__check" name="check" size="sm" />
              <span class="sm-picker__option-label">{{ option.label }}</span>
              <Icon class="sm-picker__flyout-caret" name="chevron-right" size="sm" />
            </button>
          </template>
        </div>

        <div
          v-if="hoveredModel !== null"
          ref="flyoutRef"
          class="sm-picker__flyout"
          :class="`sm-picker__flyout--${flyoutSide}`"
          :style="{ top: `${flyoutTop}px` }"
          role="listbox"
          :aria-label="t('settings.secondaryModelEffort')"
          @mouseenter="cancelClose"
          @mouseleave="scheduleClose"
        >
          <div class="sm-picker__group">{{ t('settings.secondaryModelEffort') }}</div>
          <button
            v-for="(option, index) in effortOptions"
            :key="option ?? '__default__'"
            type="button"
            class="sm-picker__option"
            :class="{
              'is-selected': isSelectedEffort(option),
              'is-kb-active': pane === 'efforts' && index === effortIndex,
              'is-muted': option === null,
            }"
            role="option"
            :aria-selected="isSelectedEffort(option)"
            @mouseenter="pane = 'efforts'; effortIndex = index"
            @click="commit(option)"
          >
            <Icon class="sm-picker__check" name="check" size="sm" />
            <span class="sm-picker__option-label">
              {{ option ?? t('settings.secondaryModelEffortAuto') }}
            </span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.sm-picker {
  position: relative;
  width: 100%;
  font-family: var(--font-ui);
}

.sm-picker__trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 38px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: transparent;
  box-shadow: none;
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}
.sm-picker__trigger:focus-visible,
.sm-picker.is-open .sm-picker__trigger {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: var(--p-focus-ring);
}
.sm-picker__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.sm-picker__value {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
}
.sm-picker__value > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sm-picker__value.is-placeholder {
  color: var(--color-text-faint);
}

.sm-picker__chevron {
  flex: none;
  color: var(--color-text-muted);
  transition: transform var(--duration-fast) var(--ease-out);
}
.sm-picker.is-open .sm-picker__chevron {
  transform: rotate(180deg);
}

.sm-picker__menu {
  position: fixed;
  z-index: var(--z-modal-dropdown);
  width: 252px;
  max-width: calc(100vw - 64px);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: var(--color-menu-bg-frost);
  -webkit-backdrop-filter: var(--p-menu-backdrop);
  backdrop-filter: var(--p-menu-backdrop);
  box-shadow: var(--shadow-lg);
}

.sm-picker__models {
  max-height: 280px;
  overflow-y: auto;
  padding: var(--space-1);
  border-radius: var(--radius-md);
}

.sm-picker__flyout {
  position: absolute;
  width: 180px;
  max-height: 280px;
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: var(--color-menu-bg-frost);
  -webkit-backdrop-filter: var(--p-menu-backdrop);
  backdrop-filter: var(--p-menu-backdrop);
  box-shadow: var(--shadow-lg);
}
.sm-picker__flyout--right {
  left: calc(100% + var(--space-1));
}
.sm-picker__flyout--left {
  right: calc(100% + var(--space-1));
}

.sm-picker__group {
  padding: var(--space-2) var(--space-2) var(--space-1);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

.sm-picker__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.sm-picker__option:hover,
.sm-picker__option.is-active {
  background: var(--color-hover);
  color: var(--color-text-strong);
}
.sm-picker__option.is-muted {
  color: var(--color-text-muted);
}

.sm-picker__option-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm-picker__check {
  flex: none;
  color: transparent;
}
.sm-picker__option.is-selected .sm-picker__check {
  color: var(--color-accent);
}

.sm-picker__flyout-caret {
  flex: none;
  margin-left: auto;
  color: var(--color-text-faint);
}
</style>