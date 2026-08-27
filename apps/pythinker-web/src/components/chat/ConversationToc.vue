<!-- apps/pythinker-web/src/components/chat/ConversationToc.vue -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatTurn } from '../../types';

export interface ConversationTocItem {
  id: string;
  role: ChatTurn['role'];
  no: number;
  title: string;
  preview: string;
}

const props = defineProps<{
  items: ConversationTocItem[];
  /** Query currently owning the viewport middle. */
  activeTurnId: string | null;
  mobile?: boolean;
  sessionLoading?: boolean;
  /** Temporarily hidden while a wide table actually covers the rail. Kept out
      of `visible` on purpose: the nav must stay mounted so the occlusion can
      be measured and lifted again. Never touches the user's TOC setting. */
  occluded?: boolean;
}>();

const emit = defineEmits<{
  select: [turnId: string];
}>();

const { t } = useI18n();

const navRef = ref<HTMLElement | null>(null);
const focusTurnId = ref<string | null>(null);
const hoverTurnId = ref<string | null>(null);
// Whether the collapsed line stack fits within the chat pane. Prompt previews
// may overlay the reading column, but the anchor itself must remain reachable.
const fits = ref(true);

let observer: ResizeObserver | null = null;

function measure(): void {
  const nav = navRef.value;
  const parent = nav?.offsetParent as HTMLElement | null;
  if (!nav || !parent) return;
  const navRect = nav.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  fits.value = navRect.left >= parentRect.left && navRect.right <= parentRect.right;
}

// The outline is only useful once there is something to navigate, and it never
// shows on mobile or while the session is still loading. `fits` is kept out of
// this computed so the nav stays mounted (and measurable) even when hidden;
// clipping is applied via the `toc-clipped` class instead.
const visible = computed(
  () => !props.mobile && !props.sessionLoading && props.items.length > 1,
);

const tabTurnId = computed(() => {
  if (
    focusTurnId.value !== null &&
    props.items.some((item) => item.id === focusTurnId.value)
  ) {
    return focusTurnId.value;
  }
  if (
    props.activeTurnId !== null &&
    props.items.some((item) => item.id === props.activeTurnId)
  ) {
    return props.activeTurnId;
  }
  return props.items[0]?.id ?? null;
});

const highlightedTurnId = computed(
  () => hoverTurnId.value ?? focusTurnId.value ?? props.activeTurnId,
);
const previewItem = computed(() => {
  const id = hoverTurnId.value ?? focusTurnId.value;
  return id === null ? undefined : props.items.find((item) => item.id === id);
});
const previewTop = ref(0);

function rows(): HTMLButtonElement[] {
  return navRef.value === null
    ? []
    : Array.from(navRef.value.querySelectorAll<HTMLButtonElement>('.toc-row'));
}

function onRowKeydown(index: number, event: KeyboardEvent): void {
  let next = index;
  if (event.key === 'ArrowDown') next = Math.min(props.items.length - 1, index + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.items.length - 1;
  else return;
  event.preventDefault();
  rows()[next]?.focus();
}

function positionPreview(row?: HTMLElement): void {
  const target = row
    ?? rows().find((candidate) => candidate.dataset.turnId === previewItem.value?.id);
  const scroll = target?.parentElement;
  if (!target || !scroll) return;
  previewTop.value = target.offsetTop - scroll.scrollTop + target.offsetHeight / 2;
}

function previewOnHover(itemId: string, event: MouseEvent): void {
  hoverTurnId.value = itemId;
  positionPreview(event.currentTarget as HTMLElement);
}

function previewOnFocus(itemId: string, event: FocusEvent): void {
  focusTurnId.value = itemId;
  positionPreview(event.currentTarget as HTMLElement);
}

function selectTurn(itemId: string): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && navRef.value?.contains(active)) active.blur();
  hoverTurnId.value = null;
  focusTurnId.value = null;
  emit('select', itemId);
}

function onFocusout(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !navRef.value?.contains(next)) focusTurnId.value = null;
}

// The nav is rendered only while `visible` (v-if), so a mount while navRef is
// still null (during sessionLoading, on mobile, or before a second user turn)
// would skip the ResizeObserver setup and leave `fits` at its default `true`.
// Re-initialize whenever the nav is actually rendered so `fits` is measured
// against the real layout instead.
watch(
  visible,
  (isVisible) => {
    observer?.disconnect();
    observer = null;
    if (!isVisible) return;
    void nextTick(() => {
      const nav = navRef.value;
      const parent = nav?.offsetParent as HTMLElement | null;
      if (!nav || !parent) return;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(parent);
      }
      measure();
    });
  },
  { immediate: true },
);

watch(
  [() => props.activeTurnId, visible],
  ([activeTurnId, isVisible]) => {
    if (!isVisible || activeTurnId === null) return;
    void nextTick(() => {
      const activeRow = rows().find((row) => row.dataset.turnId === activeTurnId);
      if (typeof activeRow?.scrollIntoView === 'function') {
        activeRow.scrollIntoView({ block: 'nearest' });
      }
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <!-- Conversation outline: one short line per user query, centered beside
       the chat. Hover or focus reveals one prompt preview. -->
  <nav
    v-if="visible"
    ref="navRef"
    class="conversation-toc"
    :class="{ 'toc-clipped': !fits || occluded }"
    :aria-label="t('conversation.toc')"
    :aria-hidden="fits && !occluded ? undefined : true"
    @mouseleave="hoverTurnId = null"
    @focusout="onFocusout"
  >
    <div class="toc-scroll" @scroll="positionPreview()">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        class="toc-row"
        :class="{
          active: activeTurnId === item.id,
          highlighted: highlightedTurnId === item.id,
          previewing: hoverTurnId === item.id || focusTurnId === item.id,
        }"
        :data-turn-id="item.id"
        :tabindex="tabTurnId === item.id ? 0 : -1"
        :aria-current="activeTurnId === item.id ? 'location' : undefined"
        :aria-label="item.title"
        @mouseenter="previewOnHover(item.id, $event)"
        @focus="previewOnFocus(item.id, $event)"
        @keydown="onRowKeydown(index, $event)"
        @click="selectTurn(item.id)"
      >
        <span class="toc-marker" aria-hidden="true" />
      </button>
    </div>
    <button
      v-if="previewItem"
      type="button"
      class="toc-preview"
      :style="{ top: `${previewTop}px` }"
      :aria-label="previewItem.title"
      tabindex="-1"
      @click="selectTurn(previewItem.id)"
    >
      <span class="toc-preview__prompt">{{ previewItem.title }}</span>
      <span v-if="previewItem.preview" class="toc-preview__response">{{ previewItem.preview }}</span>
    </button>
  </nav>
</template>

<style scoped>
.conversation-toc {
  --toc-preview-max-width: 360px;

  position: absolute;
  z-index: var(--z-sticky);
  top: 50%;
  transform: translateY(-50%);
  /* The chat pane begins immediately after the app sidebar, so this keeps the
     prompt anchor beside that sidebar while a preview reveals into the chat. */
  left: var(--space-4);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.toc-scroll {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  width: calc(var(--space-8) + var(--space-05));
  padding: 0;
  max-height: min(
    50dvh,
    max(
      0px,
      calc(
        100dvh - var(--chat-dock-height, 0px) - var(--chat-dock-height, 0px) - var(--space-8)
      )
    )
  );
  overflow-y: auto;
  scrollbar-width: none;
}
.toc-scroll::-webkit-scrollbar { display: none; }
.toc-row {
  position: relative;
  display: flex;
  align-items: center;
  width: calc(var(--space-8) + var(--space-05));
  min-height: calc(var(--space-2) + var(--space-05));
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.toc-row:focus-visible { outline: none; }
.toc-row:focus-visible .toc-marker { box-shadow: var(--p-focus-ring); }

.toc-marker {
  flex: none;
  width: calc(var(--space-3) + var(--space-05));
  height: var(--space-05);
  border-radius: var(--radius-full);
  background: var(--color-text-faint);
  transition:
    width var(--duration-base) var(--ease-out),
    height var(--duration-base) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}
.toc-row.active .toc-marker {
  background: var(--color-text-strong);
}
.toc-row:has(+ .toc-row + .toc-row.previewing) .toc-marker,
.toc-row.previewing + .toc-row + .toc-row .toc-marker {
  width: var(--space-4);
}
.toc-row:has(+ .toc-row.previewing) .toc-marker,
.toc-row.previewing + .toc-row .toc-marker {
  width: calc(var(--space-5) + var(--space-05));
}
.toc-row.previewing .toc-marker,
.toc-row:focus .toc-marker {
  width: calc(var(--space-8) + var(--space-05));
  height: calc(var(--space-05) * 1.5);
  background: var(--color-text-strong);
}

.toc-preview {
  position: absolute;
  z-index: var(--z-dropdown);
  left: calc(var(--space-8) + var(--space-4));
  transform: translateY(calc(0px - var(--space-1)));
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(
    var(--toc-preview-max-width),
    calc(
      100cqw - var(--space-4) - var(--space-8) - var(--space-4) - var(--space-4)
    )
  );
  padding: var(--space-4);
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-xl);
  background: var(--color-surface-raised);
  color: var(--color-text);
  box-shadow: var(--shadow-menu);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.toc-preview:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring-strong), var(--shadow-menu);
}
.toc-preview__prompt,
.toc-preview__response {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
}
.toc-preview__prompt {
  -webkit-line-clamp: 2;
  color: var(--color-text-strong);
  font-size: max(var(--text-lg), var(--content-font-size));
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
}
.toc-preview__response {
  -webkit-line-clamp: 3;
  color: var(--color-text-muted);
  font-size: var(--content-font-size);
  line-height: var(--leading-relaxed);
}

@media (prefers-reduced-motion: reduce) {
  .toc-marker { transition: none; }
}

/* When the chat pane cannot fit the collapsed line stack, keep it mounted for
   measurement but hidden. */
.conversation-toc.toc-clipped {
  visibility: hidden;
  pointer-events: none;
}
</style>
