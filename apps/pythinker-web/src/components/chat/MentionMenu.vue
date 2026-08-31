<!-- apps/pythinker-web/src/components/chat/MentionMenu.vue -->
<!-- Popup list shown when the user types @ in the Composer textarea: workspace
     file/folder matches (highlighted in name and parent path) plus, when the
     caller feeds them in, skill rows. Stale results dim, a custom scrollbar
     replaces the native one, and the list fades at its scroll edges. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { fileTypeIconSvg, iconSvg } from '../../lib/icons';
import { splitHits } from '../../lib/matchHighlight';
import { useMenuScrollbar } from '../../composables/useMenuScrollbar';
import type { MentionItem } from '../../composables/useMentionMenu';
import type { FileItem } from '../../types';
import Spinner from '../ui/Spinner.vue';
import { useOpenMenu } from '../ui/openMenus';

// Re-exported for the .vue consumers (Composer / ChatDock / ConversationPane)
// that import FileItem from this component.
export type { FileItem };

const props = withDefaults(
  defineProps<{
    items: MentionItem[];
    activeIndex: number;
    loading?: boolean;
    /** True while the shown results belong to a superseded query. */
    stale?: boolean;
    layout?: 'popup' | 'sheet';
  }>(),
  { loading: false, stale: false, layout: 'popup' },
);

const emit = defineEmits<{
  select: [item: MentionItem];
  hover: [index: number];
}>();

const { t } = useI18n();

const menuEl = ref<HTMLElement | null>(null);
useOpenMenu(menuEl);
const scrollEl = ref<HTMLElement | null>(null);
const activeIndex = computed(() => props.activeIndex);
const refreshKey = computed(() => props.items);

const { thumb, scrollStyle, thumbStyle, onScroll, onThumbPointerDown } = useMenuScrollbar({
  menuEl,
  scrollEl,
  maxHeightVar: '--p-mention-menu-h',
  activeIndex,
  refreshKey,
  fitToViewport: props.layout !== 'sheet',
});

/** Parent directory of a path ('' when the path has no directory part). */
function parentDir(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? '' : trimmed.slice(0, idx);
}

function namePieces(item: Extract<MentionItem, { kind: 'file' | 'folder' }>) {
  const path = item.file.path.endsWith('/') ? item.file.path.slice(0, -1) : item.file.path;
  return splitHits(item.file.name, item.file.matchPositions, Math.max(0, path.length - item.file.name.length));
}

function metaPieces(item: Extract<MentionItem, { kind: 'file' | 'folder' }>) {
  return splitHits(parentDir(item.file.path), item.file.matchPositions, 0);
}

function skillPieces(item: Extract<MentionItem, { kind: 'skill' }>) {
  return splitHits(item.skill.name, item.matchPositions, 0);
}

function itemKey(item: MentionItem): string {
  return item.kind === 'skill' ? `skill:${item.skill.name}` : item.file.path;
}
</script>

<template>
  <div ref="menuEl" class="mention-menu" :class="{ 'is-sheet': props.layout === 'sheet' }" data-menu-frame>
    <!-- Loading state (no results yet) -->
    <div v-if="props.loading && props.items.length === 0" class="mention-state dim" role="status">
      {{ t('mention.searching') }}
    </div>

    <!-- Empty state (not loading, no items) -->
    <div v-else-if="props.items.length === 0" class="mention-state dim" role="status">
      {{ t('mention.noMatch') }}
    </div>

    <Spinner
      v-if="props.loading && props.items.length > 0"
      class="mention-spin"
      size="sm"
      :label="t('mention.searching')"
    />

    <div
      ref="scrollEl"
      class="mention-scroll"
      role="listbox"
      :style="scrollStyle"
      @scroll="onScroll"
    >
      <div
        v-for="(item, i) in props.items"
        :id="`composer-mention-option-${i}`"
        :key="itemKey(item)"
        class="mention-item"
        :class="{ active: i === props.activeIndex, stale: props.stale && item.kind !== 'skill' }"
        role="option"
        :aria-selected="i === props.activeIndex"
        @mouseenter="emit('hover', i)"
        @mousedown.prevent="emit('select', item)"
      >
        <template v-if="item.kind === 'skill'">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span class="mention-icon" v-html="iconSvg('sparkles', 'sm')" aria-hidden="true" />
          <span class="mention-name">
            <template v-for="(piece, j) in skillPieces(item)" :key="j">
              <span v-if="piece.hit" class="mention-hit">{{ piece.text }}</span>
              <template v-else>{{ piece.text }}</template>
            </template>
          </span>
          <span class="mention-meta">{{ item.skill.description }}</span>
        </template>
        <template v-else>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span class="mention-icon" v-html="fileTypeIconSvg(item.file.path, item.file.name)" aria-hidden="true" />
          <span class="mention-name">
            <template v-for="(piece, j) in namePieces(item)" :key="j">
              <span v-if="piece.hit" class="mention-hit">{{ piece.text }}</span>
              <template v-else>{{ piece.text }}</template>
            </template>
          </span>
          <span v-if="parentDir(item.file.path)" class="mention-meta">
            <template v-for="(piece, j) in metaPieces(item)" :key="j">
              <span v-if="piece.hit" class="mention-hit">{{ piece.text }}</span>
              <template v-else>{{ piece.text }}</template>
            </template>
          </span>
        </template>
      </div>
    </div>

    <div
      v-if="thumb && props.items.length > 0"
      class="scroll-thumb"
      :style="thumbStyle"
      @pointerdown="onThumbPointerDown"
    />
  </div>
</template>

<style scoped>
/* The popup surface. `[data-menu-frame]` keys the rule to the frame, which is
   the positioned anchor for the scroller and thumb. */
.mention-menu[data-menu-frame] {
  position: absolute;
  bottom: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  padding: var(--space-1-5) var(--space-3);
  background: var(--color-menu-bg);
  border: .5px solid var(--color-line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-menu);
  z-index: var(--z-dropdown);
}

.mention-menu.is-sheet[data-menu-frame] {
  position: static;
  padding: 0;
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  z-index: auto;
}

.mention-scroll {
  max-height: var(--p-mention-menu-h);
  margin: 0 calc(-1 * var(--menu-row-hug));
  padding: 0 var(--menu-row-hug);
  overflow-y: auto;
  scrollbar-width: none;
}
.mention-scroll::-webkit-scrollbar { display: none; }

.scroll-thumb {
  position: absolute;
  right: var(--menu-scrollbar-edge);
  width: var(--menu-scrollbar-width);
  border-radius: var(--radius-full);
  background: var(--color-menu-scrollbar);
  transition: background var(--duration-base) var(--ease-out);
  cursor: default;
  touch-action: none;
  z-index: var(--z-raised);
}
.mention-menu:hover .scroll-thumb { background: var(--color-menu-scrollbar-hover); }
.scroll-thumb::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(-1 * var(--space-2));
  right: 0;
}

.mention-state {
  padding: var(--space-2) var(--space-1);
  font-family: var(--font-ui);
  font-size: var(--ui-b2);
}

.dim { color: var(--color-text-muted); }

.mention-spin {
  position: absolute;
  top: var(--space-2);
  right: var(--space-3);
  color: var(--color-text-muted);
  z-index: var(--z-raised);
}

.mention-item {
  display: flex;
  align-items: center;
  gap: var(--menu-row-gap-icon);
  margin: 0 calc(-1 * var(--menu-row-hug));
  padding: var(--menu-row-padding-block) var(--space-2);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  border-radius: var(--radius-menu-row);
  transition: opacity var(--duration-slow) var(--ease-out);
}
.mention-item + .mention-item { margin-top: var(--menu-rows-seam); }
.mention-item:hover { background: var(--color-hover); }
.mention-item.active { background: var(--color-selected); }
.mention-item:hover .mention-icon,
.mention-item.active .mention-icon { color: var(--color-text-strong); }
.mention-item:hover .mention-name,
.mention-item.active .mention-name { color: var(--color-text-strong); }

/* Stale rows (results of a superseded query) dim until the new results land. */
.mention-item.stale { opacity: var(--opacity-stale); }

@media (hover: none) {
  .mention-item {
    min-height: var(--touch-target-min);
    padding-top: var(--menu-row-touch-padding-block);
    padding-bottom: var(--menu-row-touch-padding-block);
  }
}

.mention-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--p-ic-sm);
  height: var(--p-ic-sm);
  color: var(--color-text-faint);
  flex-shrink: 0;
}

/* Pin every glyph to the same box so rows line up regardless of icon kind. */
.mention-icon :deep(svg) {
  width: var(--p-ic-sm);
  height: var(--p-ic-sm);
  display: block;
}

.mention-name {
  color: var(--color-text);
  font-weight: var(--weight-medium);
  flex-shrink: 0;
}
.mention-name .mention-hit {
  color: var(--color-text-strong);
  font-weight: var(--weight-semibold);
}

.mention-meta {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-meta .mention-hit { color: var(--color-text); }
</style>
