<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Spinner from '../ui/Spinner.vue';
import {
  clearSearchHighlights,
  findMatches,
  setSearchHighlights,
} from '../../lib/transcriptSearch';

const props = defineProps<{
  pane: HTMLElement;
  mobile?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const inputRef = useTemplateRef<HTMLInputElement>('input');
const query = shallowRef('');
const searching = shallowRef(false);
const ranges = shallowRef<Range[]>([]);
const currentIndex = shallowRef(0);
const truncated = shallowRef(false);
const composing = shallowRef(false);
const rings = shallowRef<Array<Record<'top' | 'left' | 'width' | 'height', string>>>([]);
const resultCount = computed(() => ranges.value.length);
const showResults = computed(() => query.value.trim() !== '');
const resultLabel = computed(() => {
  if (searching.value) return t('conversation.search.searching');
  if (!showResults.value) return '';
  if (resultCount.value === 0) return t('conversation.search.noResults');
  const values = { current: currentIndex.value + 1, total: resultCount.value };
  return truncated.value
    ? t('conversation.search.resultsCapped', values)
    : t('conversation.search.results', values);
});

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

function transcriptRoot(): Element | null {
  return props.pane.querySelector('.chat');
}

function updateRings(): void {
  const range = ranges.value[currentIndex.value];
  if (!range) {
    rings.value = [];
    return;
  }
  const paneRect = props.pane.getBoundingClientRect();
  rings.value = Array.from(range.getClientRects(), (rect) => ({
    top: `${rect.top - paneRect.top + props.pane.scrollTop}px`,
    left: `${rect.left - paneRect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }));
}

function scheduleRingUpdate(): void {
  if (rings.value.length === 0) return;
  if (ringTimer !== null) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    ringTimer = null;
    updateRings();
  }, 120);
}

function firstVisibleIndex(matches: Range[]): number {
  const paneTop = props.pane.getBoundingClientRect().top;
  const index = matches.findIndex((range) => {
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    return last !== undefined && last.bottom >= paneTop;
  });
  return index === -1 ? 0 : index;
}

function revealCurrent(): void {
  const range = ranges.value[currentIndex.value];
  setSearchHighlights(ranges.value, currentIndex.value);
  const element = range?.startContainer instanceof Element
    ? range.startContainer
    : range?.startContainer.parentElement;
  element?.scrollIntoView({ block: 'center' });
  updateRings();
}

function runSearch(direction: 'first' | 'backward' | false = 'first'): void {
  if (searchTimer !== null) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  searching.value = false;
  const root = transcriptRoot();
  const value = query.value.trim();
  if (!root || value === '') {
    ranges.value = [];
    truncated.value = false;
    currentIndex.value = 0;
    clearSearchHighlights();
    updateRings();
    return;
  }
  const previous = ranges.value[currentIndex.value];
  const previousNode = previous?.startContainer;
  const previousOffset = previous?.startOffset;
  const result = findMatches(root, value);
  ranges.value = result.ranges;
  truncated.value = result.truncated;
  if (result.ranges.length === 0) {
    currentIndex.value = 0;
    clearSearchHighlights();
    updateRings();
    return;
  }
  if (direction !== false) {
    const visible = firstVisibleIndex(result.ranges);
    currentIndex.value = direction === 'backward'
      ? (visible - 1 + result.ranges.length) % result.ranges.length
      : visible;
    revealCurrent();
    return;
  }
  const preserved = result.ranges.findIndex(
    (range) => range.startContainer === previousNode && range.startOffset === previousOffset,
  );
  currentIndex.value = preserved >= 0 ? preserved : firstVisibleIndex(result.ranges);
  setSearchHighlights(result.ranges, currentIndex.value);
  updateRings();
}

function scheduleSearch(): void {
  if (searchTimer !== null) clearTimeout(searchTimer);
  if (query.value.trim() === '') {
    searching.value = false;
    runSearch();
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(() => runSearch(), 150);
}

function navigate(offset: number): void {
  if (resultCount.value === 0) return;
  currentIndex.value = (currentIndex.value + offset + resultCount.value) % resultCount.value;
  revealCurrent();
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || composing.value || event.isComposing) return;
  event.preventDefault();
  if (searchTimer !== null) {
    runSearch(event.shiftKey ? 'backward' : 'first');
    return;
  }
  navigate(event.shiftKey ? -1 : 1);
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || composing.value || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  emit('close');
}

function isRingNode(node: Node): boolean {
  return node instanceof Element && (
    node.classList.contains('tsearch-rings') || node.closest('.tsearch-rings') !== null
  );
}

function ignoreMutation(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes' && mutation.target === props.pane) return true;
  if (isRingNode(mutation.target)) return true;
  if (mutation.type !== 'childList') return false;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every(isRingNode);
}

function observeMutations(mutations: MutationRecord[]): void {
  if (query.value.trim() === '' || mutations.every(ignoreMutation) || searchTimer !== null) return;
  if (mutationTimer !== null) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    if (searchTimer === null) runSearch(false);
  }, 150);
}

onMounted(() => {
  void nextTick(() => inputRef.value?.focus());
  if (typeof MutationObserver === 'function') {
    observer = new MutationObserver(observeMutations);
    observer.observe(props.pane, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['inert', 'style', 'class'],
    });
  }
  props.pane.addEventListener('scroll', scheduleRingUpdate, { passive: true });
  window.addEventListener('resize', scheduleRingUpdate, { passive: true });
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(updateRings);
    resizeObserver.observe(props.pane);
    const content = props.pane.querySelector('.content-wrap');
    if (content) resizeObserver.observe(content);
  }
});

onUnmounted(() => {
  if (searchTimer !== null) clearTimeout(searchTimer);
  if (mutationTimer !== null) clearTimeout(mutationTimer);
  if (ringTimer !== null) clearTimeout(ringTimer);
  observer?.disconnect();
  resizeObserver?.disconnect();
  props.pane.removeEventListener('scroll', scheduleRingUpdate);
  window.removeEventListener('resize', scheduleRingUpdate);
  clearSearchHighlights();
});
</script>

<template>
  <div class="tsearch" :class="{ mobile }" role="search" @keydown="onSearchKeydown">
    <div class="tsearch-main">
      <Icon class="tsearch-icon" name="search" size="sm" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="text"
        class="tsearch-input"
        :placeholder="t('conversation.search.placeholder')"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        @input="scheduleSearch"
        @keydown="onInputKeydown"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      >
      <Spinner v-if="searching" class="tsearch-spin" size="sm" :label="t('conversation.search.searching')" />
      <span class="tsearch-sep" aria-hidden="true" />
      <IconButton
        class="tsearch-close"
        size="sm"
        :label="t('conversation.search.close')"
        @click="emit('close')"
      >
        <Icon name="close" />
      </IconButton>
    </div>
    <div class="tsearch-foot-wrap" :class="{ open: showResults }" :inert="!showResults">
      <div class="tsearch-foot">
        <IconButton
          size="sm"
          :label="t('conversation.search.previous')"
          :disabled="resultCount === 0"
          @click="navigate(-1)"
        >
          <Icon name="arrow-up" />
        </IconButton>
        <IconButton
          size="sm"
          :label="t('conversation.search.next')"
          :disabled="resultCount === 0"
          @click="navigate(1)"
        >
          <Icon name="arrow-down" />
        </IconButton>
        <span class="tsearch-count" aria-live="polite">{{ resultLabel }}</span>
      </div>
    </div>
    <Teleport :to="pane">
      <div class="tsearch-rings">
        <div
          v-for="(ring, index) in rings"
          :key="index"
          class="tsearch-ring"
          :style="ring"
        />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tsearch {
  position: absolute;
  top: calc(var(--panel-head-h, 48px) + var(--space-3));
  right: var(--space-3);
  z-index: var(--z-sticky);
  width: min(var(--p-findbar-w), calc(100% - var(--space-3) * 2));
  background: var(--color-surface-raised);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-menu);
  animation: pythinker-card-in var(--duration-slow) var(--ease-out);
}
.tsearch.mobile { top: var(--space-3); }
.tsearch::after {
  content: '';
  position: absolute;
  inset: 0;
  border: inherit;
  border-color: var(--color-composer-focus-line);
  border-radius: var(--radius-2xl);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-slow) var(--ease-in-out);
}
.tsearch:focus-within::after { opacity: 1; }
.tsearch-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  min-height: calc(var(--space-8) + 2 * var(--space-1));
}
.tsearch-icon {
  flex: none;
  margin-left: var(--space-1);
  color: var(--color-text-muted);
}
.tsearch-input {
  flex: 1;
  min-width: 0;
  height: var(--space-8);
  padding: 0;
  border: none;
  background: transparent;
  font-family: var(--font-ui);
  font-size: var(--ui-font-size);
  color: var(--color-text);
}
.tsearch-input:focus-visible { outline: none; }
.tsearch-input::placeholder { color: var(--color-text-muted); }
.tsearch-spin { display: inline-flex; flex: none; }
.tsearch-sep {
  flex: none;
  width: var(--p-hairline);
  height: var(--space-4);
  background: var(--color-line);
}
.tsearch .tsearch-close { border-radius: var(--radius-full); }
.tsearch-foot-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-slow) var(--ease-out);
}
.tsearch-foot-wrap.open { grid-template-rows: 1fr; }
.tsearch-foot {
  overflow: hidden;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
}
.tsearch-foot-wrap.open .tsearch-foot {
  padding: var(--space-1) var(--space-2);
  border-top: var(--p-hairline) solid var(--color-line);
}
.tsearch-count {
  margin-left: auto;
  padding-right: var(--space-1);
  font-size: var(--ui-font-size-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
  user-select: none;
}
.tsearch-rings {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.tsearch-ring {
  position: absolute;
  box-sizing: content-box;
  border: var(--p-findring-w) solid var(--color-warning);
  margin: calc(-1 * var(--p-findring-w));
  border-radius: var(--radius-xs);
  pointer-events: none;
}
</style>
