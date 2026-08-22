<!-- apps/pythinker-web/src/components/chat/TurnFold.vue -->
<!-- Settled + live fold for the "work" part of an assistant turn (reference
     TurnFold): while the turn is live/parked a 1s interval keeps the header
     "Worked 1m3s" ticking; while streaming, only the single
     `streamingTailIndex` item gets stream markers, the header hides and the
     body opens (two-phase open, so streaming→settled animates closed instead
     of collapsing). The body carries `inert` while closed so it is skipped by
     focus traversal. -->
<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolMedia } from '../../types';
import type { AssistantRenderBlock } from '../chatTurnRendering';
import { formatLiveDuration, renderBlockKey } from '../chatTurnRendering';
import Icon from '../ui/Icon.vue';
import Markdown from './Markdown.vue';
import ThinkingBlock from './ThinkingBlock.vue';
import ToolCall from './ToolCall.vue';
import ActivityRun from './ActivityRun.vue';

const props = withDefaults(
  defineProps<{
    items: AssistantRenderBlock[];
    /** True while the owning turn is the session's in-flight turn. */
    live?: boolean;
    /** Live turn before its first content streamed (no stream markers yet). */
    parked?: boolean;
    /** ms epoch when the turn's first block started (earliest thinking
     *  startedAt); absent on the pythinker wire — falls back to `createdMs`. */
    seedMs?: number;
    /** ms epoch when the turn was created. */
    createdMs?: number;
    /** ms epoch when the turn ended; absent on the pythinker wire. */
    endedMs?: number;
    /** Source index of the single streaming tail item, or null when settled. */
    streamingTailIndex?: number | null;
    /** Client-side measured settled duration (ms). */
    durationMs?: number;
    toolDiffPanel?: boolean;
    mobile?: boolean;
  }>(),
  {
    live: false,
    parked: false,
    seedMs: undefined,
    createdMs: undefined,
    endedMs: undefined,
    streamingTailIndex: null,
    durationMs: undefined,
    toolDiffPanel: false,
    mobile: false,
  },
);

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
  openAgent: [toolCallId: string];
  openThinking: [blockIndex: number];
}>();

const { t } = useI18n();

const streaming = computed(() => props.streamingTailIndex !== null);
const state = computed<'live' | 'parked' | 'settled'>(() =>
  props.live ? (props.parked ? 'parked' : 'live') : 'settled',
);

// Two-phase open: `bodyOpen` mounts the body (grid 1fr), `bodyShown` flips
// only after a double rAF so the expand transition renders; closing runs the
// collapse transition first, then unmounts 200ms later. Streaming keeps the
// body open, so a live turn never collapses mid-stream.
const open = ref(false);
const expanded = computed(() => streaming.value || open.value);
const bodyOpen = ref(expanded.value);
const bodyShown = ref(expanded.value);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

watch(expanded, (value) => {
  if (value) {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (bodyOpen.value) {
      bodyShown.value = true;
      return;
    }
    bodyOpen.value = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bodyShown.value = true;
      });
    });
    return;
  }
  bodyShown.value = false;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    bodyOpen.value = false;
  }, 200);
});

const pinScroll = inject<(el: HTMLElement) => void>('pinScroll', () => undefined);
const headEl: Ref<HTMLElement | null> = ref(null);

function toggle(): void {
  open.value = !open.value;
  void nextTick(() => {
    const el = headEl.value;
    if (el) pinScroll(el);
  });
}

// Live/parked ticking: refresh `nowMs` once a second so the header label
// "Worked 1m3s" advances without re-rendering the whole conversation.
const nowMs = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

function stopTicking(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

watch(
  state,
  (value, previous) => {
    if (value !== 'settled') {
      nowMs.value = Date.now();
      if (tickInterval === null) {
        tickInterval = setInterval(() => {
          nowMs.value = Date.now();
        }, 1000);
      }
    } else {
      stopTicking();
    }
    // A live turn that parks/settles no longer forces the body open.
    if (previous === 'live' && value !== 'live') open.value = false;
  },
  { immediate: true },
);

onUnmounted(() => {
  stopTicking();
  if (closeTimer !== null) clearTimeout(closeTimer);
});

// Earliest start of the turn: min(seedMs, createdMs) when both are present.
const seedMs = computed(() => {
  if (props.seedMs === undefined) return props.createdMs;
  if (props.createdMs === undefined) return props.seedMs;
  return Math.min(props.seedMs, props.createdMs);
});

const elapsedMs = computed<number | undefined>(() => {
  if (state.value === 'settled') {
    if (props.durationMs !== undefined) return Math.max(0, props.durationMs);
    if (seedMs.value === undefined || props.endedMs === undefined) return undefined;
    return Math.max(0, props.endedMs - seedMs.value);
  }
  if (seedMs.value === undefined) return undefined;
  return Math.max(0, nowMs.value - seedMs.value);
});

const workedLabel = computed(() => {
  const elapsed = elapsedMs.value;
  if (elapsed === undefined) return t('conversation.fold.workedUnknown');
  // Whole-second compact form ("1m3s") in BOTH live and settled states — the
  // reference uses the same formatter for both, so a settle keeps the exact
  // label instead of switching "1m3s" → "1m3.0s" mid-turn.
  const label = formatLiveDuration(elapsed);
  return label ? t('conversation.fold.worked', { duration: label }) : t('conversation.fold.workedUnknown');
});

function blockStreaming(block: AssistantRenderBlock): boolean {
  return props.streamingTailIndex !== null
    && 'sourceIndex' in block
    && block.sourceIndex === props.streamingTailIndex;
}

function runStreaming(block: Extract<AssistantRenderBlock, { kind: 'activity-run' }>): boolean {
  if (props.streamingTailIndex === null) return false;
  const last = block.items.at(-1);
  return last !== undefined && last.sourceIndex === props.streamingTailIndex;
}
</script>

<template>
  <div v-if="items.length > 0" class="turn-fold" :class="{ open: expanded, streaming }">
    <button
      v-if="!streaming"
      ref="headEl"
      type="button"
      class="tf-head"
      :aria-expanded="open"
      :title="workedLabel"
      @click="toggle"
    >
      <span class="tf-sum">{{ workedLabel }}</span>
      <Icon class="tf-car" name="chevron-right" size="sm" aria-hidden="true" />
    </button>
    <div v-if="bodyOpen" class="tf-body" :class="{ open: bodyShown }" :inert="!expanded">
      <div class="tf-body-inner">
        <template v-for="(block, index) in items" :key="renderBlockKey(block, index)">
          <ThinkingBlock
            v-if="block.kind === 'thinking'"
            :text="block.thinking"
            :mobile="mobile"
            :streaming="blockStreaming(block)"
            @open="emit('openThinking', block.sourceIndex)"
          />
          <div v-else-if="block.kind === 'text' && block.text" class="msg">
            <Markdown
              :text="block.text"
              :streaming="blockStreaming(block)"
              :open-file="(target) => emit('openFile', target)"
            />
          </div>
          <ActivityRun
            v-else-if="block.kind === 'activity-run'"
            :items="block.items"
            :mobile="mobile"
            :streaming="runStreaming(block)"
            :tool-diff-panel="toolDiffPanel"
            @open-media="emit('openMedia', $event)"
            @open-file="emit('openFile', $event)"
            @open-tool-diff="emit('openToolDiff', $event)"
            @open-agent="emit('openAgent', $event)"
            @open-thinking="emit('openThinking', $event)"
          />
          <ToolCall
            v-else-if="block.kind === 'tool'"
            :tool="block.tool"
            :mobile="mobile"
            :tool-diff-panel="toolDiffPanel"
            @open-media="emit('openMedia', $event)"
            @open-file="emit('openFile', $event)"
            @open-tool-diff="emit('openToolDiff', $event)"
            @open-agent="emit('openAgent', $event)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turn-fold { display: flex; flex-direction: column; }
.tf-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2) 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-faint);
  font: var(--text-sm)/1 var(--font-ui);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-base) var(--ease-out);
}
.tf-head:hover { color: var(--color-text); }
.tf-head:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-accent-soft); }
.tf-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--weight-regular); }
.tf-car { color: var(--color-text-faint); flex: none; transition: transform var(--duration-base) var(--ease-out); }
.turn-fold.open .tf-car { transform: rotate(90deg); }
.tf-body {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  transition: grid-template-rows var(--duration-base) var(--ease-out);
}
.tf-body.open { grid-template-rows: minmax(0, 1fr); }
.tf-body-inner { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.tf-body-inner > .msg,
.tf-body-inner > :deep(.think),
.tf-body-inner > :deep(.tool-group),
.tf-body-inner > :deep(.agent-card),
.tf-body-inner > :deep(.agent-group),
.tf-body-inner > :deep(.box),
.tf-body-inner > :deep(.dynamic-workflow-card),
.tf-body-inner > :deep(.activity-run),
.tf-body-inner > :deep(.media-tool) { margin-top: var(--chat-block-gap); }
.tf-body-inner .msg { font-size: var(--ui-font-size); line-height: 1.6; color: var(--color-text); font-weight: var(--weight-medium); }
.tf-body-inner .msg :deep(p) { margin: 0; }
.tf-body-inner .msg :deep(p + p) { margin-top: var(--space-2); }
</style>