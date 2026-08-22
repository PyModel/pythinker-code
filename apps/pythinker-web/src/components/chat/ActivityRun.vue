<!-- apps/pythinker-web/src/components/chat/ActivityRun.vue -->
<!-- Aggregate per-run block (reference ActivityRun): folds a run of
     consecutive thinking + tool items into a collapsible row whose header
     pins the status glyph to the last running item, joins a clause summary
     ("current · done") and ticks a live elapsed timer while the run is
     running. Body renders ThinkingBlock + ToolCall items. The pythinker wire
     has no daemon run boundaries, so runs are the render layer's per-turn
     best-effort grouping (see assistantRenderBlocks). -->
<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolMedia } from '../../types';
import { normalizeToolName, toolSummary } from '../../lib/toolMeta';
import type { IconName } from '../../lib/icons';
import { blockStartedMs, formatLiveDuration, isSettledThinking, runItemKey, type RunItem } from '../chatTurnRendering';
import Icon from '../ui/Icon.vue';
import ThinkingBulb from '../ui/ThinkingBulb.vue';
import ThinkingBlock from './ThinkingBlock.vue';
import ToolCall from './ToolCall.vue';

type RunStatus = 'running' | 'error' | 'done';

type ClauseFragment = { text: string; tone?: 'normal' | 'danger' | 'faint' };
type Clause = { fragments: ClauseFragment[] };

/** Tool kinds with a dedicated localized done/doing clause; everything else
 *  falls back to the generic "tool call" summary (reference `tools.activity`). */
const CLAUSE_KINDS = new Set([
  'read',
  'bash',
  'grep',
  'search',
  'glob',
  'ls',
  'web_fetch',
  'edit',
  'write',
]);

const TOOL_ICONS: Record<string, IconName> = {
  read: 'file-text',
  bash: 'terminal',
  edit: 'pencil',
  multi_edit: 'pencil',
  write: 'file-plus',
  grep: 'search',
  search: 'search',
  glob: 'glob',
  ls: 'folder',
  web_fetch: 'globe',
  todo: 'check-list',
  task: 'loading-spinner',
  waitfor: 'clock',
};

const props = withDefaults(
  defineProps<{
    items: RunItem[];
    mobile?: boolean;
    /** True while this run is the live turn's streaming tail run. */
    streaming?: boolean;
    toolDiffPanel?: boolean;
  }>(),
  { mobile: false, streaming: false, toolDiffPanel: false },
);

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
  openAgent: [toolCallId: string];
}>();

const { t } = useI18n();

const last = computed(() => props.items.at(-1) ?? null);

// The item the status glyph pins to: the streaming thinking tail (while this
// run is streaming) or the last still-running tool; null once settled.
const statusItem = computed<RunItem | null>(() => {
  if (props.streaming && last.value?.kind === 'thinking') return last.value;
  for (let index = props.items.length - 1; index >= 0; index -= 1) {
    const item = props.items[index];
    if (item?.kind === 'tool' && item.tool.status === 'running') return item;
  }
  return null;
});

const status = computed<RunStatus>(() => {
  if (props.streaming) return 'running';
  for (const item of props.items) {
    if (item.kind === 'tool' && item.tool.status === 'running') return 'running';
  }
  for (const item of props.items) {
    if (item.kind === 'tool' && item.tool.status === 'error') return 'error';
  }
  return 'done';
});

// Running runs start open; settled runs start closed.
const open = ref(status.value === 'running');
const expanded = computed(() => open.value);

const pinScroll = inject<(el: HTMLElement) => void>('pinScroll', () => undefined);
const headEl: Ref<HTMLElement | null> = ref(null);

// Live elapsed: measured from the run's earliest known start (the wire carries
// no item startedAt, so the first "running" observation stands in), ticking on
// a 1s interval; the settled duration is captured once when the run ends.
let startedAtMs: number | null = null;
const settledElapsedMs = ref<number | undefined>(undefined);
const nowMs = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

function stopTicking(): void {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

watch(
  status,
  (value, previous) => {
    if (value === 'running') {
      if (previous !== undefined && previous !== 'running') open.value = true;
      if (startedAtMs === null) startedAtMs = Date.now();
      settledElapsedMs.value = undefined;
      nowMs.value = Date.now();
      if (tickInterval === null) {
        tickInterval = setInterval(() => {
          nowMs.value = Date.now();
        }, 1000);
      }
      return;
    }
    if (previous === 'running') {
      open.value = false;
      if (startedAtMs !== null) settledElapsedMs.value = Date.now() - startedAtMs;
      startedAtMs = null;
    }
    stopTicking();
  },
  { immediate: true },
);

onUnmounted(stopTicking);

// ---- Header: status glyph + clause summary ---------------------------------

const glyphName = computed<IconName>(() => {
  if (status.value === 'done') return 'check';
  if (status.value === 'error') return 'close';
  const current = statusItem.value ?? last.value;
  if (!current) return 'tool';
  if (current.kind === 'thinking') return 'thinking';
  const kind = normalizeToolName(current.tool.name);
  let icon = kind === 'askuserquestion' ? 'help-circle' : TOOL_ICONS[kind];
  if (!icon && current.tool.name.toLowerCase().includes('skill')) icon = 'bolt';
  return icon ?? 'tool';
});

const elapsedLabel = computed(() => {
  if (status.value !== 'running' || startedAtMs === null) return '';
  return formatLiveDuration(nowMs.value - startedAtMs);
});

function kindClauseText(kind: string, count: number): string {
  return CLAUSE_KINDS.has(kind)
    ? t(`conversation.activityRun.doneClause.${kind as 'read'}`, { count })
    : t('conversation.activityRun.other', { count });
}

function failedFragment(count: number): ClauseFragment {
  return { text: t('conversation.activityRun.failedClause', { count }), tone: 'danger' };
}

function joinClauses(clauses: Clause[]): string {
  return clauses.map((clause) => clause.fragments.map((f) => f.text).join('')).join(' · ');
}

/** Settled summary: per-kind clauses ("Read 2 files · fetched 1 page") plus
 *  the captured elapsed duration as a faint tail fragment. */
function buildSettledClauses(): { clauses: Clause[]; plain: string } {
  const order: string[] = [];
  const byKind = new Map<string, { count: number; errors: number }>();
  for (const item of props.items) {
    if (item.kind === 'thinking') continue;
    const kind = normalizeToolName(item.tool.name);
    let entry = byKind.get(kind);
    if (!entry) {
      entry = { count: 0, errors: 0 };
      byKind.set(kind, entry);
      order.push(kind);
    }
    entry.count++;
    if (item.tool.status === 'error') entry.errors++;
  }
  const clauses: Clause[] = [];
  for (const kind of order) {
    const entry = byKind.get(kind);
    if (!entry) continue;
    const fragments: ClauseFragment[] = [
      { text: kindClauseText(kind, entry.count), tone: 'normal' },
    ];
    if (entry.errors > 0) fragments.push(failedFragment(entry.errors));
    clauses.push({ fragments });
  }
  if (settledElapsedMs.value !== undefined) {
    const label = formatLiveDuration(settledElapsedMs.value);
    if (label) clauses.push({ fragments: [{ text: label, tone: 'faint' }] });
  }
  return { clauses, plain: joinClauses(clauses) };
}

/** Live summary: the current item ("Running bash …" / "Thinking…") followed
 *  by the already-done kinds in faint, then the ticking elapsed fragment. */
function buildLiveClauses(): { current: Clause | null; done: Clause[]; plain: string } {
  const others = props.items.filter(
    (item) => item !== statusItem.value && !(item.kind === 'tool' && item.tool.status === 'running'),
  );
  const order: string[] = [];
  const byKind = new Map<string, { count: number; errors: number }>();
  for (const item of others) {
    if (item.kind === 'thinking') continue;
    const kind = normalizeToolName(item.tool.name);
    let entry = byKind.get(kind);
    if (!entry) {
      entry = { count: 0, errors: 0 };
      byKind.set(kind, entry);
      order.push(kind);
    }
    entry.count++;
    if (item.tool.status === 'error') entry.errors++;
  }
  const done: Clause[] = [];
  for (const kind of order) {
    const entry = byKind.get(kind);
    if (!entry) continue;
    const fragments: ClauseFragment[] = [
      { text: kindClauseText(kind, entry.count), tone: 'faint' },
    ];
    if (entry.errors > 0) fragments.push(failedFragment(entry.errors));
    done.push({ fragments });
  }
  const current = statusItem.value === null ? null : currentClause(statusItem.value);
  const clauses: Clause[] = current ? [current, ...done] : done;
  return { current, done, plain: joinClauses(clauses) };
}

function currentClause(item: RunItem): Clause {
  if (item.kind === 'thinking') {
    return { fragments: [{ text: t('conversation.activityRun.thinking'), tone: 'normal' }] };
  }
  const kind = normalizeToolName(item.tool.name);
  let subject = toolSummary(item.tool.name, item.tool.arg);
  if (kind === 'write' && subject) {
    const suffix = t('tools.chip.created');
    if (subject.endsWith(suffix)) subject = subject.slice(0, -suffix.length).trimEnd();
  }
  const text =
    subject && CLAUSE_KINDS.has(kind)
      ? t(`conversation.activityRun.doing.${kind as 'read'}`, { subject })
      : t('conversation.activityRun.busy');
  return { fragments: [{ text, tone: 'normal' }] };
}

const headerClauses = computed<Clause[]>(() => {
  if (status.value !== 'running') return buildSettledClauses().clauses;
  const { current, done } = buildLiveClauses();
  const clauses: Clause[] = [];
  if (current) clauses.push(current);
  clauses.push(...done);
  const elapsed = elapsedLabel.value;
  if (elapsed) clauses.push({ fragments: [{ text: elapsed, tone: 'faint' }] });
  return clauses;
});

const titleText = computed(() => {
  if (status.value !== 'running') return buildSettledClauses().plain;
  return [buildLiveClauses().plain, elapsedLabel.value].filter(Boolean).join(' · ');
});

function toneClass(tone: ClauseFragment['tone']): string | undefined {
  if (tone === 'danger') return 'ar-danger';
  if (tone === 'faint') return 'ar-faint';
  return undefined;
}

function toggle(): void {
  open.value = !open.value;
  if (props.streaming) return;
  void nextTick(() => {
    const el = headEl.value;
    if (el) pinScroll(el);
  });
}

/** Only the run's last thinking item streams (the daemon streams one tail
 *  item at a time; a settled thinking block never animates). The durationMs
 *  guard mirrors the reference `_()`: a thinking whose step ended keeps its
 *  frozen "Thinking · Ns" label instead of shimmering forever while the run
 *  stays open. */
function isItemStreaming(item: RunItem): boolean {
  return (
    props.streaming &&
    item.kind === 'thinking' &&
    !isSettledThinking(item) &&
    item.sourceIndex === (last.value?.sourceIndex ?? -1)
  );
}
</script>

<template>
  <div v-if="items.length > 0" class="activity-run" :class="{ open: expanded }">
    <button
      ref="headEl"
      type="button"
      class="ar-head"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span
        class="ar-glyph"
        :class="{
          run: status === 'running',
          bulb: glyphName === 'thinking',
          err: status === 'error',
          ok: status === 'done',
        }"
        role="status"
        :aria-label="status"
      >
        <ThinkingBulb
          v-if="glyphName === 'thinking'"
          :animated="status === 'running'"
          size="sm"
          aria-hidden="true"
        />
        <Icon v-else :name="glyphName" size="sm" aria-hidden="true" />
      </span>
      <span class="ar-sum" :class="{ 'ui-shimmer': status === 'running' }" :title="titleText">
        <template v-for="(clause, ci) in headerClauses" :key="ci">
          <span v-if="ci > 0" class="ar-sep"> · </span>
          <template v-for="(fragment, fi) in clause.fragments" :key="fi">
            <span :class="toneClass(fragment.tone)">{{ fragment.text }}</span>
          </template>
        </template>
      </span>
      <Icon class="ar-car" name="chevron-right" size="sm" aria-hidden="true" />
    </button>
    <div class="ar-body" :class="{ open: expanded }" :inert="!expanded">
      <div class="ar-body-inner">
        <template v-for="item in items" :key="runItemKey(item)">
          <ThinkingBlock
            v-if="item.kind === 'thinking'"
            :text="item.thinking"
            :mobile="mobile"
            :streaming="isItemStreaming(item)"
            :started-at-ms="blockStartedMs(item.startedAt)"
            :duration-ms="item.durationMs"
          />
          <ToolCall
            v-else
            :tool="item.tool"
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
.activity-run {
  display: flex;
  flex-direction: column;
  animation: pythinker-card-in var(--duration-base) var(--ease-out);
}
.ar-head {
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
.ar-head:hover { color: var(--color-text); }
.ar-head:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-accent-soft); }
.ar-glyph { display: inline-flex; align-items: center; flex: none; color: var(--color-text-faint); }
.ar-glyph.ok { color: var(--color-success); }
.ar-glyph.err { color: var(--color-danger); }
.ar-glyph.run {
  color: var(--color-text-muted);
  animation: ar-breathe 1.6s var(--ease-in-out) infinite;
}
/* The thinking bulb already animates its own filament; breathing the wrapper on
   top of it multiplies the two opacities and washes the tungsten out. */
.ar-glyph.run.bulb {
  animation: none;
}
@keyframes ar-breathe {
  0%, to { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .ar-glyph.run { animation: none; }
}
.ar-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--weight-regular); }
.ar-car { color: var(--color-text-faint); flex: none; transition: transform var(--duration-base) var(--ease-out); }
.activity-run.open .ar-car { transform: rotate(90deg); }
.ar-body {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  transition: grid-template-rows var(--duration-base) var(--ease-out);
}
.ar-body.open { grid-template-rows: minmax(0, 1fr); }
.ar-body-inner { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-1); }
.ar-sep,
.ar-faint { color: var(--color-text-faint); }
.ar-danger { color: var(--color-danger); }
</style>