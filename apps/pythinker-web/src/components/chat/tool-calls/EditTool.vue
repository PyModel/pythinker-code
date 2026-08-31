<!-- apps/pythinker-web/src/components/chat/tool-calls/EditTool.vue -->
<!-- Edit/Write card. Header shows the file's basename as a button that opens
     the file; the trailing area carries a `+added / −removed` diffbar (two
     proportional segments) for edits, or a `created` chip for a successful
     write. The expanded body renders the inline diff from the tool's inputs
     (sharing the side-panel DiffLines renderer) and falls back to the raw
     output when the call cannot be diffed from its args (replace_all, append,
     oversized inputs) or when the side diff panel owns the diff. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DiffViewLine, FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { diffStats } from '../../../lib/diffLines';
import { buildEditDiffLines, extractEditPath } from '../../../lib/toolDiff';
import { normalizeToolName, toolGlyph, toolLabel } from '../../../lib/toolMeta';
import { fileTypeIconSvg } from '../../../lib/icons';
import DiffLines from '../DiffLines.vue';
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

const status = computed(() => props.tool.status);
const label = computed(() => toolLabel(props.tool.name));
const glyph = computed(() => toolGlyph(props.tool.name));
const isWrite = computed(() => normalizeToolName(props.tool.name) === 'write');

const path = computed(() => extractEditPath(props.tool.arg) ?? '');

/** Last path segment — the clickable name in the header. */
function baseName(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.at(-1) ?? p;
}
/** Directory portion of the path (both separators), empty for a bare name. */
function dirName(p: string): string {
  return /^(.*)[\\/][^\\/]+[\\/]?$/.exec(p)?.[1] ?? '';
}

const editDiff = computed<DiffViewLine[] | null>(() => buildEditDiffLines(props.tool));
const stats = computed(() => {
  const diff = editDiff.value;
  if (diff && props.tool.status !== 'error') return diffStats(diff);
  return { added: 0, removed: 0 };
});
const hasDiffs = computed(() => stats.value.added > 0 || stats.value.removed > 0);

const hasOutput = computed(() => !!props.tool.output && props.tool.output.length > 0);
const open = ref(false);
const canExpand = computed(() => hasOutput.value && !props.toolDiffPanel);

function toggle(): void {
  if (props.toolDiffPanel) {
    emit('openToolDiff', props.tool.id);
    return;
  }
  if (hasOutput.value) open.value = !open.value;
}

function openFile(): void {
  if (path.value) emit('openFile', { path: path.value });
}
</script>

<template>
  <ToolRow
    :status="status"
    :icon="glyph"
    :name="label"
    :arg="''"
    :time="tool.timing"
    :open="open"
    :expandable="canExpand || toolDiffPanel"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #title>
      <span class="tl-name">{{ label }}</span>
      <span v-if="path" class="tl-ficon" aria-hidden="true" v-html="fileTypeIconSvg(path)" />
      <button v-if="path" type="button" class="tl-file" @click.stop="openFile">{{ baseName(path) }}</button>
      <span v-if="path" class="tl-faint">{{ dirName(path) }}</span>
      <span v-if="!path" class="tl-dim">{{ path || tool.arg }}</span>
    </template>
    <template #trailing>
      <template v-if="hasDiffs">
        <span v-if="stats.added > 0" class="tl-add">+{{ stats.added }}</span>
        <span v-if="stats.removed > 0" class="tl-del">−{{ stats.removed }}</span>
        <span class="diffbar" aria-hidden="true">
          <span class="seg-add" :style="{ flexGrow: stats.added }" />
          <span class="seg-del" :style="{ flexGrow: stats.removed }" />
        </span>
      </template>
      <span v-else-if="isWrite && tool.status === 'ok'" class="chip">{{ t('tools.chip.created') }}</span>
    </template>
    <div v-if="editDiff && !toolDiffPanel" class="diff-wrap">
      <DiffLines :lines="editDiff" />
    </div>
    <ToolOutputBlock v-else :lines="tool.output" empty-text="Waiting for output…" />
  </ToolRow>
</template>

<style scoped>
.tl-name {
  color: var(--emph, var(--color-text));
  font-weight: var(--weight-medium);
  flex: none;
  transition: color var(--duration-slow) var(--ease-out);
}
.tl-ficon {
  display: inline-flex;
  align-items: center;
  align-self: center;
  flex: none;
}
.tl-ficon :deep(svg) {
  display: block;
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
.tl-add {
  color: var(--color-success);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  flex: none;
}
.tl-del {
  color: var(--color-danger);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  flex: none;
}
.diffbar {
  display: inline-flex;
  width: 36px;
  height: 3px;
  border-radius: var(--radius-full);
  overflow: hidden;
  gap: 1px;
  flex: none;
}
.seg-add {
  background: var(--color-success);
}
.seg-del {
  background: var(--color-danger);
}
.diff-wrap {
  margin-top: var(--space-2);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  overflow-x: auto;
}
</style>