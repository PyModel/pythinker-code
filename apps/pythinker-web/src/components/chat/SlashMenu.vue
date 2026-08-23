<!-- apps/pythinker-web/src/components/chat/SlashMenu.vue -->
<!-- Popup list of slash commands shown above the Composer textarea. The typed
     query is highlighted in both the command name and its description — either
     via explicit `query`/`ranges` props or computed
     locally from the `query` prop. Custom scrollbar + edge fade shared with
     the mention menu. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SlashCommand } from '../../lib/slashCommands';
import { computeSlashRanges, splitByRanges } from '../../lib/matchHighlight';
import { useMenuScrollbar } from '../../composables/useMenuScrollbar';

/** Highlight ranges for one slash item, keyed by field. */
export interface SlashItemRanges {
  name?: Array<[number, number]>;
  desc?: Array<[number, number]>;
}

const props = withDefaults(
  defineProps<{
    items: SlashCommand[];
    activeIndex: number;
    /** The typed query (without the leading `/` required — stripped internally). */
    query?: string;
    /** Per-item highlight ranges; falls back to computing from `query`. */
    ranges?: SlashItemRanges[];
  }>(),
  { query: '', ranges: () => [] },
);

const emit = defineEmits<{
  select: [item: SlashCommand];
  hover: [index: number];
}>();

const { t } = useI18n();

const menuEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const activeIndex = computed(() => props.activeIndex);
const refreshKey = computed(() => props.items);

const { thumb, scrollStyle, thumbStyle, onScroll, onThumbPointerDown } = useMenuScrollbar({
  menuEl,
  scrollEl,
  maxHeightVar: '--p-slash-menu-h',
  activeIndex,
  refreshKey,
});

/** Per-row render data: translated description + highlighted name/desc pieces. */
const rows = computed(() =>
  props.items.map((item, index) => {
    const desc = item.isSkill ? item.desc : t(item.desc);
    const ranges = props.ranges[index] ?? computeSlashRanges(props.query, item.name, desc);
    return {
      item,
      namePieces: splitByRanges(item.name, ranges.name),
      desc,
      descPieces: splitByRanges(desc, ranges.desc),
    };
  }),
);
</script>

<template>
  <div ref="menuEl" class="slash-menu" data-menu-frame>
    <!-- Empty state (no command matches the query) -->
    <div v-if="props.items.length === 0" class="slash-empty" role="status">
      {{ t('composer.noCommands') }}
    </div>

    <div
      ref="scrollEl"
      class="slash-scroll"
      role="listbox"
      :style="scrollStyle"
      @scroll="onScroll"
    >
      <div
        v-for="(row, i) in rows"
        :id="`composer-slash-option-${i}`"
        :key="`${row.item.name}-${i}`"
        class="slash-item"
        :class="{ active: i === props.activeIndex }"
        role="option"
        :aria-selected="i === props.activeIndex"
        @mouseenter="emit('hover', i)"
        @mousedown.prevent="emit('select', row.item)"
      >
        <span class="slash-name">
          <template v-for="(piece, j) in row.namePieces" :key="j">
            <span v-if="piece.hit" class="slash-match">{{ piece.text }}</span>
            <template v-else>{{ piece.text }}</template>
          </template>
        </span>
        <span class="slash-desc">
          <template v-for="(piece, j) in row.descPieces" :key="j">
            <span v-if="piece.hit" class="slash-desc-match">{{ piece.text }}</span>
            <template v-else>{{ piece.text }}</template>
          </template>
        </span>
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
.slash-menu[data-menu-frame] {
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

.slash-scroll {
  max-height: var(--p-slash-menu-h);
  margin: 0 calc(-1 * var(--menu-row-hug));
  padding: 0 var(--menu-row-hug);
  overflow-y: auto;
  scrollbar-width: none;
}
.slash-scroll::-webkit-scrollbar { display: none; }

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
.slash-menu:hover .scroll-thumb { background: var(--color-menu-scrollbar-hover); }
.scroll-thumb::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(-1 * var(--space-2));
  right: 0;
}

.slash-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0 calc(-1 * var(--menu-row-hug));
  padding: var(--menu-row-padding-block) var(--menu-row-padding-inline);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--ui-b2);
  border-radius: var(--radius-menu-row);
}
.slash-item + .slash-item { margin-top: var(--menu-rows-seam); }
.slash-item:hover { background: var(--color-hover); }
.slash-item.active { background: var(--color-selected); }

.slash-name {
  flex: none;
  max-width: 60%;
  color: var(--color-text);
  font-weight: var(--weight-medium);
  min-width: 0;
  line-height: var(--leading-normal);
  overflow-wrap: anywhere;
}
.slash-match { font-weight: var(--weight-semibold); }

.slash-desc {
  flex: 1;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--ui-b2);
  font-weight: var(--weight-regular);
  line-height: var(--leading-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slash-desc-match { font-weight: var(--weight-semibold); }

.slash-empty {
  padding: var(--space-1-5) var(--space-1);
  color: var(--color-text-muted);
}

@media (hover: none) {
  .slash-item {
    min-height: var(--touch-target-min);
    padding-top: var(--menu-row-touch-padding-block);
    padding-bottom: var(--menu-row-touch-padding-block);
  }
}

@media (max-width: 520px) {
  .slash-item {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-05);
  }
  .slash-name { max-width: none; }
}
</style>