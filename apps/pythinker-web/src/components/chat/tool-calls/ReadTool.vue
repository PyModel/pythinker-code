<!-- apps/pythinker-web/src/components/chat/tool-calls/ReadTool.vue -->
<!-- Read card. The header shows the file's basename as a button (plus dirname
     and line range) that opens the file at the read offset; the expanded body
     repeats the clickable path and, when the engine emitted `line\tcontent`
     lines, renders them with their file line numbers (1-based from the call's
     start offset — the numbers the engine emits). Anything unparseable falls
     back to the plain output block. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolChip, toolGlyph, toolLabel } from '../../../lib/toolMeta';
import { fileTypeIconSvg } from '../../../lib/icons';
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

const chip = computed(() => toolChip(props.tool));

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

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

const path = computed(
  () =>
    str(arg.value?.path) ??
    str(arg.value?.file_path) ??
    str(arg.value?.filePath) ??
    str(arg.value?.filename) ??
    '',
);
const start = computed(
  () => num(arg.value?.offset) ?? num(arg.value?.line_start) ?? num(arg.value?.start_line),
);
const end = computed(() => {
  const d = arg.value;
  if (!d) return undefined;
  const len = num(d.limit) ?? num(d.length);
  return num(d.line_end) ?? num(d.end_line) ?? (start.value !== undefined && len !== undefined ? start.value + len : undefined);
});
const rangeLabel = computed(() =>
  start.value !== undefined && end.value !== undefined
    ? `:${start.value}-${end.value}`
    : start.value !== undefined
      ? `:${start.value}`
      : '',
);

/** Last path segment — the clickable name in the header. */
function baseName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.at(-1) ?? p;
}
/** Directory portion of the path (both separators), empty for a bare name. */
function dirName(p: string): string {
  return /^(.*)[\\/][^\\/]+[\\/]?$/.exec(p)?.[1] ?? '';
}

interface ReadParse {
  contents: string[];
  lineNumbers: number[];
}

/** `line\tcontent` rows as emitted by the engine's Read tool. */
const READ_LINE_RE = /^(\d+)\t(.*)$/;

function parseReadOutput(output: string[] | undefined): ReadParse | null {
  if (!output || output.length === 0) return null;
  const lines = output.at(-1) === '' ? output.slice(0, -1) : output;
  if (lines.length === 0) return null;
  const contents: string[] = [];
  const lineNumbers: number[] = [];
  for (const line of lines) {
    const m = READ_LINE_RE.exec(line);
    if (!m) return null;
    lineNumbers.push(Number(m[1]));
    contents.push(m[2] ?? '');
  }
  return { contents, lineNumbers };
}

const parsed = computed<ReadParse | null>(() =>
  props.tool.status === 'ok' ? parseReadOutput(props.tool.output) : null,
);
const hasOutput = computed(() => !!props.tool.output && props.tool.output.length > 0);
const canExpand = computed(() => parsed.value !== null || hasOutput.value);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
}

function openPath(): void {
  if (path.value) emit('openFile', { path: path.value, line: start.value });
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
    :arg="''"
    :time="tool.timing"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #title>
      <span class="tl-name">{{ toolLabel(tool.name) }}</span>
      <span v-if="path" class="tl-ficon" aria-hidden="true" v-html="fileTypeIconSvg(path)" />
      <button v-if="path" type="button" class="tl-file" @click.stop="openPath">{{ baseName(path) }}</button>
      <span v-if="path" class="tl-faint">{{ dirName(path) }}</span>
      <span v-if="rangeLabel" class="tl-faint">{{ rangeLabel }}</span>
      <span v-if="!path" class="tl-dim">{{ path || tool.arg }}</span>
    </template>
    <template #trailing>
      <span v-if="chip" class="chip">{{ chip }}</span>
    </template>
    <button v-if="path" type="button" class="path-link" @click="openPath">{{ path }}</button>
    <div v-if="parsed" class="read-code">
      <div v-for="(line, i) in parsed.contents" :key="i" class="read-line">
        <span class="read-no">{{ parsed.lineNumbers[i] }}</span>
        <span class="read-text">{{ line }}</span>
      </div>
    </div>
    <ToolOutputBlock
      v-else
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.tl-ficon {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex: none;
}
.tl-ficon :deep(svg) {
  display: block;
}
.tl-name {
  color: var(--emph, var(--color-text));
  font-weight: var(--weight-medium);
  flex: none;
  transition: color var(--duration-slow) var(--ease-out);
}
.tl-file {
  color: var(--emph, var(--color-text));
  line-height: var(--leading-tight);
  flex: none;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  padding: 0 1px;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  transition: color var(--duration-slow) var(--ease-out);
}
.tl-file:hover {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.tl-file:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.tl-dim {
  color: var(--color-text-muted);
  line-height: var(--leading-tight);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-faint {
  color: var(--color-text-faint);
  line-height: var(--leading-tight);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.path-link {
  display: block;
  width: 100%;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  padding: 0 0 var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.path-link:hover {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.path-link:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.read-line {
  display: flex;
  font-size: var(--text-xs);
}
.read-no {
  flex: none;
  min-width: 4ch;
  padding-right: var(--space-2);
  text-align: right;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
  user-select: none;
}
.read-text {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>