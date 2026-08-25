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

// Width the rail needs inside the chat once its labels are fully
// revealed on hover/focus: 24px node column + 10px gap + 220px label, plus a
// small buffer. Kept in sync with the `.toc-row` / `.toc-label` rules below.
const EXPANDED_WIDTH = 288;

const navRef = ref<HTMLElement | null>(null);
const focusTurnId = ref<string | null>(null);
// Whether the rail, once expanded, fits within the chat pane. When it would
// overflow, we hide the outline rather than showing a clipped panel.
const fits = ref(true);

let observer: ResizeObserver | null = null;

function measure(): void {
  const nav = navRef.value;
  const parent = nav?.offsetParent as HTMLElement | null;
  if (!nav || !parent) return;
  const navRect = nav.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const readingColumn = parent.querySelector<HTMLElement>('.content-wrap');
  const clearsReadingColumn =
    readingColumn === null || navRect.right <= readingColumn.getBoundingClientRect().left;
  fits.value = parentRect.right - navRect.left >= EXPANDED_WIDTH && clearsReadingColumn;
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
  <!-- Conversation outline: one connected timeline node per user query,
       vertically centered beside the chat. Hover or focus reveals labels. -->
  <nav
    v-if="visible"
    ref="navRef"
    class="conversation-toc"
    :class="{ 'toc-clipped': !fits || occluded }"
    :aria-label="t('conversation.toc')"
    :aria-hidden="fits && !occluded ? undefined : true"
    @focusout="onFocusout"
  >
    <div class="toc-scroll">
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        class="toc-row"
        :class="{ active: activeTurnId === item.id }"
        :data-turn-id="item.id"
        :tabindex="tabTurnId === item.id ? 0 : -1"
        :aria-current="activeTurnId === item.id ? 'location' : undefined"
        @focus="focusTurnId = item.id"
        @keydown="onRowKeydown(index, $event)"
        @click="emit('select', item.id)"
      >
        <span class="toc-node" aria-hidden="true" />
        <span class="toc-label">{{ item.title }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.conversation-toc {
  position: absolute;
  z-index: var(--z-sticky);
  top: 50%;
  transform: translateY(-50%);
  /* The chat pane begins immediately after the app sidebar, so this keeps the
     timeline beside that sidebar while labels reveal into the chat. */
  left: var(--space-4);
  display: flex;
  flex-direction: column;
  justify-content: center;
  opacity: 0.5;
  transition: opacity var(--duration-base) var(--ease-out);
}
/* Invisible hover bridge: the collapsed rail is only 24px wide, so this
   extends the hover target on both sides to make the outline easy to open and
   forgiving to stay within. Kept at z-index 0 so it sits behind the rows
   (which are raised to z-index 1) and cannot swallow their clicks. */
.conversation-toc::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -14px;
  right: -48px;
  z-index: 0;
}
.conversation-toc:hover,
.conversation-toc:focus-within { opacity: 1; }

.toc-scroll {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: var(--space-2);
  border: .5px solid transparent;
  border-radius: var(--radius-lg);
  background: transparent;
  box-shadow: none;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  scrollbar-width: none;
  transition:
    background var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}
.toc-scroll::-webkit-scrollbar { display: none; }
.conversation-toc:hover .toc-scroll,
.conversation-toc:focus-within .toc-scroll {
  border-color: var(--color-line);
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-menu);
}
.toc-row::before {
  content: "";
  position: absolute;
  top: -1px;
  bottom: -1px;
  left: calc(var(--space-2) + 12px);
  width: var(--p-hairline);
  background: var(--color-line);
  pointer-events: none;
}
.toc-row:first-child::before { top: 50%; }
.toc-row:last-child::before { bottom: 50%; }

.toc-row {
  position: relative;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 28px;
  min-width: 24px;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-dropdown-row);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-base) var(--ease-out);
}
.toc-row:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.toc-row:hover { background: var(--color-hover); }

.toc-node {
  position: relative;
  z-index: var(--z-raised);
  width: 7px;
  height: 7px;
  margin-inline: auto;
  border: var(--p-hairline) solid var(--color-text-muted);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  transition:
    transform var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.toc-label {
  display: block;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  text-overflow: ellipsis;
  transition:
    max-width var(--duration-base) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

/* Hover / focus: reveal labels to the right. */
.conversation-toc:hover .toc-label,
.conversation-toc:focus-within .toc-label { max-width: 220px; opacity: 1; }

.toc-row.active .toc-node {
  border-color: var(--color-accent);
  background: var(--color-accent);
  box-shadow: var(--p-focus-ring);
  transform: scale(1.28);
}
.conversation-toc:hover .toc-row.active,
.conversation-toc:focus-within .toc-row.active { background: var(--color-selected); }
.toc-row.active .toc-label { color: var(--color-accent); font-weight: var(--weight-medium); }
.toc-row:hover .toc-node { border-color: var(--color-text); transform: scale(1.28); }
.toc-row.active:hover .toc-node { border-color: var(--color-accent); }
.toc-row:hover .toc-label { color: var(--color-text); }

/* When the chat pane cannot fit the expanded labels or the collapsed rail
   reaches the reading column, it stays mounted for measurement but hidden. */
.conversation-toc.toc-clipped {
  visibility: hidden;
  pointer-events: none;
}
</style>
