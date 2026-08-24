<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useOpenMenu } from './openMenus';

type Alignment = 'start' | 'end';

const props = withDefaults(defineProps<{
  anchor: HTMLElement | null;
  open: boolean;
  align?: Alignment;
  /** Accessible name for the panel. The panel is a dialog, not a menu: the slot
      holds plain buttons and switches, not `menuitem` children. */
  label?: string;
}>(), {
  align: 'start',
  label: undefined,
});

const emit = defineEmits<{
  close: [];
}>();

const panelRef = ref<HTMLElement | null>(null);
useOpenMenu(panelRef);
const panelStyle = ref<Record<string, string>>({});
let opener: HTMLElement | null = null;
let listenersAttached = false;
let panelResizeObserver: ResizeObserver | null = null;

function positionPanel(): void {
  const anchor = props.anchor;
  const panel = panelRef.value;
  if (!anchor || !panel) return;

  const anchorRect = anchor.getBoundingClientRect();
  const gap = 4;
  const margin = 16;
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const preferredLeft = props.align === 'end'
    ? anchorRect.right - panelWidth
    : anchorRect.left;
  const maxLeft = Math.max(margin, window.innerWidth - margin - panelWidth);
  let left = Math.min(Math.max(preferredLeft, margin), maxLeft);
  let top = anchorRect.bottom + gap;

  if (top + panelHeight > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - panelHeight - gap);
  }

  const maxTop = Math.max(margin, window.innerHeight - margin - panelHeight);
  top = Math.min(Math.max(top, margin), maxTop);
  left = Math.min(Math.max(left, margin), maxLeft);
  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

function onViewportChange(): void {
  if (props.open) positionPanel();
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (target instanceof Node && (panelRef.value?.contains(target) || props.anchor?.contains(target))) return;
  emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

function attachListeners(): void {
  if (listenersAttached) return;
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  // The panel is measured once on open, but its content arrives later: a menu
  // that opens on a spinner and then fills with rows grows downward past the
  // viewport, because only `top` was written. Re-place it whenever it resizes.
  if (typeof ResizeObserver !== 'undefined' && panelRef.value) {
    panelResizeObserver = new ResizeObserver(onViewportChange);
    panelResizeObserver.observe(panelRef.value);
  }
  listenersAttached = true;
}

function detachListeners(): void {
  if (!listenersAttached) return;
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  listenersAttached = false;
}

function focusPanel(): void {
  const panel = panelRef.value;
  if (!panel) return;
  const first = panel.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  (first ?? panel).focus();
}

function restoreFocusIfNeeded(): void {
  const panel = panelRef.value;
  const activeElement = document.activeElement;
  if (!panel || !(activeElement instanceof Node) || !panel.contains(activeElement)) return;

  const target = props.anchor ?? opener;
  if (target?.isConnected) target.focus();
}

watch(() => props.open, (open, wasOpen) => {
  if (open) {
    if (!wasOpen) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    void nextTick(() => {
      if (!props.open) return;
      positionPanel();
      attachListeners();
      // The panel is teleported to the end of <body>, so a keyboard user would
      // otherwise have to tab through the rest of the page to reach it.
      focusPanel();
    });
    return;
  }

  restoreFocusIfNeeded();
  detachListeners();
  panelStyle.value = {};
}, { immediate: true });

watch([() => props.anchor, () => props.align], () => {
  if (props.open) void nextTick(positionPanel);
});

onBeforeUnmount(() => {
  restoreFocusIfNeeded();
  detachListeners();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="popover"
      :style="panelStyle"
      role="dialog"
      :aria-label="label"
      tabindex="-1"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.popover {
  position: fixed;
  z-index: 200;
  box-sizing: border-box;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--panel);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ink) 18%, transparent);
}
</style>
