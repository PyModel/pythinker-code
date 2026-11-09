<!-- apps/pythinker-web/src/components/ResizeHandle.vue -->
<!-- A thin (~4px) vertical drag bar used to resize the panel to its LEFT. It -->
<!-- owns the width via useResizable and reports changes through v-model:width so -->
<!-- the parent can drive its grid/flex sizing. col-resize cursor, subtle blue -->
<!-- hover highlight, no text-selection while dragging. -->
<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useResizable } from '../composables/useResizable';

const props = withDefaults(
  defineProps<{
    storageKey: string;
    defaultWidth: number;
    min: number;
    max: number;
    reverse?: boolean;
    ariaLabel?: string;
  }>(),
  {},
);

const emit = defineEmits<{
  'update:width': [width: number];
  /** True while dragging — parents disable width transitions so the panel
      tracks the pointer without animation lag. */
  'update:dragging': [dragging: boolean];
}>();

const { t } = useI18n();

const { width, dragging, setWidth, onPointerDown } = useResizable({
  storageKey: props.storageKey,
  defaultWidth: props.defaultWidth,
  min: props.min,
  // Pass a getter so the cap stays reactive: a viewport-derived max can grow
  // after the handle mounts and the next drag will use the new limit.
  max: () => props.max,
  reverse: props.reverse,
});

/** Keyboard step in px, read from the token so the scale stays in one place. */
function stepPx(large: boolean): number {
  const name = large ? '--resize-handle-step-lg' : '--resize-handle-step';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return Number.parseFloat(raw) || (large ? 48 : 16);
}

// A pointer-only handle is unreachable without a mouse: Arrow keys resize, and
// Shift takes the larger step. `reverse` flips the direction so the arrow
// always moves the visible edge the way it points.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  const signed = props.reverse ? -direction : direction;
  setWidth(width.value + signed * stepPx(event.shiftKey));
}

// Surface the restored width immediately, then keep the parent in sync on drag.
emit('update:width', width.value);
watch(width, (w) => emit('update:width', w));
watch(dragging, (d) => emit('update:dragging', d));
</script>

<template>
  <div
    class="rh"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="ariaLabel ?? t('layout.resizeHandleAria')"
    :aria-valuenow="Math.round(width)"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    @pointerdown="onPointerDown"
    @keydown="onKeydown"
  >
    <span class="rh-bar" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.rh {
  width: 4px;
  flex: none;
  cursor: col-resize;
  position: relative;
  align-self: stretch;
  background: transparent;
  touch-action: none;
  /* sits over the 1px column border so the whole 4px strip is grabbable */
  margin: 0 -2px;
  /* above pane-level sticky chrome (chat dock, headers at --z-sticky): its 2px
     overhang into the neighbour pane must stay visible and grabbable */
  z-index: var(--z-dropdown);
}
.rh-bar {
  position: absolute;
  inset: 0;
  background: transparent;
  transition: background 0.12s;
}
.rh:hover .rh-bar,
.rh.dragging .rh-bar {
  background: var(--color-accent);
}
.rh:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
</style>
