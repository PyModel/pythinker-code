<!-- apps/pythinker-web/src/components/chat/tool-calls/GrepTool.vue -->
<!-- Grep/Search card. For canonical `grep` calls the output lines are parsed
     as `path:line:text` matches and rendered as clickable rows that open the
     file at the hit line; alias shapes (e.g. web search) fall back to the
     plain output block. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { normalizeToolName, toolGlyph, toolLabel, toolSummary } from '../../../lib/toolMeta';
import ToolRow from '../ToolRow.vue';
import ToolOutputBlock from './ToolOutputBlock.vue';

const props = withDefaults(
  defineProps<{
    tool: ToolCall;
    mobile?: boolean;
    stackPosition?: 'single' | 'first' | 'middle' | 'last';
    toolDiffPanel?: boolean;
  }>(),
  { mobile: false, stackPosition: 'single', toolDiffPanel: false },
);

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
}>();

const { t } = useI18n();

interface MatchRow {
  path?: string;
  line?: number;
  text: string;
}

/** `path:line:text` — the ripgrep match line shape (colon or dash separator
    before the text, so a colon inside `path:line` itself still parses). */
const MATCH_LINE_RE = /^(.+?):(\d+)[:-](.*)$/;

const isGrep = computed(() => normalizeToolName(props.tool.name) === 'grep');

const arg = computed<Record<string, unknown> | null>(() => {
  try {
    const value: unknown = JSON.parse(props.tool.arg);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
});
const pattern = computed(() => {
  const value = arg.value?.pattern ?? arg.value?.query ?? arg.value?.regex;
  return typeof value === 'string' ? value : '';
});
const scope = computed(() => {
  const value = arg.value?.path ?? arg.value?.glob ?? arg.value?.include;
  return typeof value === 'string' ? value : '';
});
const summary = computed(() =>
  pattern.value && scope.value
    ? t('tools.summary.inScope', { value: pattern.value, scope: scope.value })
    : toolSummary(props.tool.name, props.tool.arg),
);

const rows = computed<MatchRow[]>(() =>
  (props.tool.output ?? [])
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const m = MATCH_LINE_RE.exec(line);
      return m
        ? { path: m[1], line: Number(m[2]), text: (m[3] ?? '').trim() }
        : { text: line };
    }),
);
const resultCount = computed(() => rows.value.length);
const canExpand = computed(() => resultCount.value > 0);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
}

function openRow(row: MatchRow): void {
  if (row.path) emit('openFile', { path: row.path, line: row.line });
}

watch(
  () => [props.tool.defaultExpanded, props.tool.output?.length, props.tool.status] as const,
  () => {
    if (props.tool.defaultExpanded === true && canExpand.value) open.value = true;
  },
);
</script>

<template>
  <ToolRow
    :status="tool.status"
    :icon="toolGlyph(tool.name)"
    :name="toolLabel(tool.name)"
    :arg="!open ? summary : ''"
    :time="tool.timing"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #trailing>
      <span v-if="tool.status === 'ok'" class="chip">{{ t('tools.chip.results', { count: resultCount }) }}</span>
    </template>
    <div v-if="isGrep" class="match-list">
      <button
        v-for="(row, i) in rows"
        :key="i"
        type="button"
        class="match-row"
        :class="{ link: !!row.path }"
        @click="openRow(row)"
      >
        <span v-if="row.path" class="mref">{{ row.path }}:{{ row.line }}</span>
        <span class="mtext">{{ row.text }}</span>
      </button>
    </div>
    <ToolOutputBlock
      v-else
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.match-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  padding: var(--space-1);
  max-height: calc(19.2 * 1lh);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.match-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 2px var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--color-text);
  text-align: left;
  cursor: default;
}
.match-row.link {
  cursor: pointer;
}
.match-row.link:hover {
  background: var(--color-hover);
}
.match-row:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.mref {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-faint);
}
.match-row.link:hover .mref {
  color: var(--color-accent);
}
.mtext {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>