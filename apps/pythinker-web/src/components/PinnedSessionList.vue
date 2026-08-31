<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useResizable } from '../composables/useResizable';
import { safeGetString, STORAGE_KEYS } from '../lib/storage';
import type { Session } from '../types';
import SessionRow from './SessionRow.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';

const props = defineProps<{
  sessions: Session[];
  activeId: string;
  collapsed: boolean;
  pendingBySession: Record<string, { approvals: number; questions: number }>;
  unreadBySession: Record<string, boolean>;
}>();

const emit = defineEmits<{
  select: [id: string];
  rename: [id: string, title: string];
  generateTitle: [id: string, onTitle: (title: string | null) => void];
  archive: [id: string];
  fork: [id: string];
  export: [id: string];
  pin: [id: string];
  setEmoji: [id: string, emoji: string | null];
  reorder: [ids: string[]];
  toggleCollapsed: [];
}>();

const { t } = useI18n();
const draggingId = ref<string | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const rowsRef = ref<HTMLElement | null>(null);
const viewportHeight = ref(window.innerHeight);
const contentHeight = ref<number | null>(null);
const minHeight = ref(100);
const layoutMaxHeight = ref(Math.round(window.innerHeight * 0.6));
const scrolled = ref(false);
const moreBelow = ref(false);
const hasPersistedHeight = ref(safeGetString(STORAGE_KEYS.sidebarPinnedHeight) !== null);

const resizable = computed(() => !props.collapsed && props.sessions.length > 3);
const maxHeight = computed(() => {
  const content = contentHeight.value;
  const layout = layoutMaxHeight.value;
  return Math.max(minHeight.value, content && content > 0 ? Math.min(layout, content) : layout);
});

const {
  width: height,
  dragging,
  clamp,
  setWidth: setHeight,
  onPointerDown,
} = useResizable({
  storageKey: STORAGE_KEYS.sidebarPinnedHeight,
  defaultWidth: Math.round(window.innerHeight * 0.4),
  min: () => minHeight.value,
  max: () => maxHeight.value,
  axis: 'y',
});

const visibleHeight = computed(() => clamp(height.value));

function normalSessionsElement(): HTMLElement | null {
  const next = rootRef.value?.nextElementSibling;
  return next instanceof HTMLElement && next.classList.contains('sessions') ? next : null;
}

function rowHeight(element: Element | null): number | null {
  if (!(element instanceof HTMLElement)) return null;
  const measured = element.getBoundingClientRect().height || element.offsetHeight;
  return Number.isFinite(measured) && measured > 0 ? measured : null;
}

function measureRows(): void {
  const rows = rowsRef.value;
  if (!rows) return;
  const first = rowHeight(rows.children.item(0));
  const second = rowHeight(rows.children.item(1));
  const heights = [first, second].filter((value): value is number => value !== null);
  minHeight.value = Math.round(heights.length > 0 ? heights.reduce((sum, value) => sum + value, 0) : 100);
  contentHeight.value = rows.scrollHeight > 0 ? rows.scrollHeight : null;
  scrolled.value = rows.scrollTop > 0;
  moreBelow.value = rows.scrollTop + rows.clientHeight < rows.scrollHeight - 1;
}

function normalSessionReserve(element: HTMLElement | null): number {
  if (!element) return 96;
  const top = element.getBoundingClientRect().top;
  const rows = [...element.querySelectorAll<HTMLElement>('.se')].filter(
    (row) => row.closest('.group-sessions.collapsed') === null,
  );
  const first = rows[0]?.getBoundingClientRect();
  const third = rows[2]?.getBoundingClientRect();
  const padding = Number.parseFloat(getComputedStyle(element).paddingBottom);
  const bottomPadding = Number.isFinite(padding) ? padding : 0;
  if (third && third.height > 0) return Math.round(third.bottom - top + element.scrollTop + bottomPadding);
  if (first && first.height > 0) return Math.round(first.height * 3 + bottomPadding);
  return 96;
}

function measureLayout(): void {
  measureRows();
  const rows = rowsRef.value;
  const normal = normalSessionsElement();
  const stackHeight =
    (rows?.getBoundingClientRect().height ?? 0) + (normal?.getBoundingClientRect().height ?? 0);
  const viewportCap = Math.round(viewportHeight.value * 0.6);
  layoutMaxHeight.value = Math.max(
    minHeight.value,
    stackHeight > 0 ? Math.min(viewportCap, Math.round(stackHeight) - normalSessionReserve(normal)) : viewportCap,
  );
  height.value = hasPersistedHeight.value
    ? clamp(height.value)
    : clamp(Math.round(viewportHeight.value * 0.4));
}

function onRowsScroll(): void {
  measureRows();
}

function onResize(): void {
  viewportHeight.value = window.innerHeight;
  measureLayout();
}

function resizeWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  measureLayout();
  const step = event.shiftKey ? 48 : 16;
  const delta = event.key === 'ArrowDown' ? step : -step;
  const next = clamp(visibleHeight.value + delta);
  if (next === visibleHeight.value) return;
  hasPersistedHeight.value = true;
  setHeight(next);
}

function startResize(event: PointerEvent): void {
  measureLayout();
  const measured = rowsRef.value?.getBoundingClientRect().height;
  if (measured && measured > 0) height.value = clamp(measured);
  onPointerDown(event);
}

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

onMounted(async () => {
  await nextTick();
  measureLayout();
  const normal = normalSessionsElement();
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(measureLayout);
    if (rowsRef.value) resizeObserver.observe(rowsRef.value);
    if (normal) resizeObserver.observe(normal);
  }
  if (typeof MutationObserver === 'function' && normal) {
    mutationObserver = new MutationObserver(measureLayout);
    mutationObserver.observe(normal, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('resize', onResize);
});

watch(
  () => [props.sessions.length, props.collapsed],
  () => nextTick(measureLayout),
);
watch(height, () => {
  if (dragging.value) hasPersistedHeight.value = true;
  nextTick(measureRows);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  window.removeEventListener('resize', onResize);
});

function dragStart(id: string, event: DragEvent): void {
  draggingId.value = id;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
}

function drop(targetId: string, event: DragEvent): void {
  event.preventDefault();
  const sourceId = draggingId.value ?? event.dataTransfer?.getData('text/plain');
  draggingId.value = null;
  if (!sourceId || sourceId === targetId) return;
  const ids = props.sessions.map((session) => session.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  emit('reorder', ids);
}
</script>

<template>
  <section v-if="sessions.length" ref="rootRef" class="pinned">
    <header class="pinned-label">
      <span class="pinned-title">{{ t('sidebar.pinned') }}</span>
      <IconButton
        class="pinned-toggle"
        :class="{ 'pinned-toggle--on': collapsed }"
        size="sm"
        :label="collapsed ? t('sidebar.expandPinned') : t('sidebar.collapsePinned')"
        @click.stop="emit('toggleCollapsed')"
      >
        <Icon :name="collapsed ? 'chevron-right' : 'chevron-down'" />
      </IconButton>
    </header>
    <template v-if="!collapsed">
      <div class="pinned-rows-wrap" :class="{ scrolled, 'more-below': moreBelow }">
        <div
          ref="rowsRef"
          class="pinned-rows"
          :style="resizable ? { maxHeight: `${visibleHeight}px` } : undefined"
          @scroll="onRowsScroll"
        >
          <div
            v-for="session in sessions"
            :key="session.id"
            class="pin-row"
            :class="{ dragging: draggingId === session.id }"
            draggable="true"
            @dragstart="dragStart(session.id, $event)"
            @dragend="draggingId = null"
            @dragover.prevent
            @drop="drop(session.id, $event)"
          >
            <SessionRow
              :session="session"
              :active="session.id === activeId"
              :pinned="true"
              :approval-count="pendingBySession[session.id]?.approvals ?? 0"
              :question-count="pendingBySession[session.id]?.questions ?? 0"
              :unread="unreadBySession[session.id] ?? false"
              @select="emit('select', $event)"
              @rename="(id, title) => emit('rename', id, title)"
              @generate-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
              @archive="emit('archive', $event)"
              @fork="emit('fork', $event)"
              @export="emit('export', $event)"
              @pin="emit('pin', $event)"
              @set-emoji="(id, emoji) => emit('setEmoji', id, emoji)"
            />
          </div>
        </div>
        <span class="pinned-seam pinned-seam--top" aria-hidden="true"></span>
        <span class="pinned-seam pinned-seam--bottom" aria-hidden="true"></span>
      </div>
      <div
        v-if="resizable || dragging"
        class="pinned-resize"
        :class="{ dragging }"
        role="separator"
        aria-orientation="horizontal"
        :aria-label="t('sidebar.resizePinnedAria')"
        :aria-valuenow="Math.round(visibleHeight)"
        :aria-valuemin="Math.round(minHeight)"
        :aria-valuemax="Math.round(maxHeight)"
        tabindex="0"
        @pointerdown="startResize"
        @keydown="resizeWithKeyboard"
      >
        <span class="pinned-resize-bar" aria-hidden="true"></span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pinned {
  flex: none;
  min-width: 0;
  padding: var(--space-3) var(--sb-inset) 0;
}
.pinned-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0 var(--space-2) var(--space-1);
  color: var(--faint);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-section-label);
  text-transform: uppercase;
  user-select: none;
}
.pinned-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pinned-toggle { color: var(--faint); opacity: 0; transition: opacity var(--duration-base) var(--ease-out); }
.pinned-label:hover .pinned-toggle,
.pinned-label:focus-within .pinned-toggle,
.pinned-toggle--on { opacity: 1; }
.pinned-toggle:hover { color: var(--dim); }
.pinned-toggle :deep(svg) { width: 13px; height: 13px; }
.pinned-rows { max-height: 40vh; overflow-y: auto; padding: 0 var(--sb-inset); scrollbar-gutter: stable; }
.pinned-rows::-webkit-scrollbar { width: var(--space-1); }
.pinned-rows::-webkit-scrollbar-track { background: transparent; }
.pinned-rows::-webkit-scrollbar-thumb { background: transparent; border-radius: var(--radius-full); }
.pinned-rows:hover::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--color-text) 12%, transparent); }
.pinned-rows::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--color-text) 25%, transparent); }
.pinned-rows-wrap {
  position: relative;
  margin: 0 calc(var(--sb-inset) * -1);
  --pinned-seam-down: linear-gradient(to bottom, color-mix(in srgb, var(--color-text) 3%, transparent), transparent);
  --pinned-seam-up: linear-gradient(to top, color-mix(in srgb, var(--color-text) 3%, transparent), transparent);
}
.pinned-seam {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--space-3);
  pointer-events: none;
  opacity: 0;
  z-index: var(--z-raised);
  transition: opacity var(--duration-base) var(--ease-out);
}
.pinned-seam--top { top: 0; border-top: var(--p-hairline) solid var(--line); background: var(--pinned-seam-down); }
.pinned-seam--bottom { bottom: 0; border-bottom: var(--p-hairline) solid var(--line); background: var(--pinned-seam-up); }
.pinned-rows-wrap.scrolled .pinned-seam--top,
.pinned-rows-wrap.more-below .pinned-seam--bottom { opacity: 1; }
.pinned-resize {
  height: var(--space-1);
  position: relative;
  background: transparent;
  cursor: row-resize;
  touch-action: none;
  margin: calc(var(--space-05) * -1) calc(var(--sb-inset) * -1);
  z-index: var(--z-dropdown);
}
.pinned-resize-bar {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: var(--space-05);
  translate: 0 -50%;
  background: transparent;
  transition: background var(--duration-fast) var(--ease-out);
}
.pinned-resize:hover .pinned-resize-bar { background: var(--color-selected); }
.pinned-resize.dragging .pinned-resize-bar { background: var(--color-line-strong); }
.pinned-resize:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.pin-row.dragging { opacity: 0.45; }
</style>
