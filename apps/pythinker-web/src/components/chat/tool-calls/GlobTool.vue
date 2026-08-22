<!-- apps/pythinker-web/src/components/chat/tool-calls/GlobTool.vue -->
<!-- Glob/LS card. For canonical `glob` calls each output line is a file path
     rendered as a clickable row that opens the file; `ls` (a listing) falls
     back to the plain output block. -->
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

const isGlob = computed(() => normalizeToolName(props.tool.name) === 'glob');

const summary = computed(() => toolSummary(props.tool.name, props.tool.arg));
const fileRows = computed(() => (props.tool.output ?? []).filter((line) => line.trim().length > 0));
const fileCount = computed(() => fileRows.value.length);
const canExpand = computed(() => fileCount.value > 0);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
}

function openFile(path: string): void {
  const trimmed = path.trim();
  if (trimmed) emit('openFile', { path: trimmed });
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
      <span v-if="tool.status === 'ok'" class="chip">{{ t('tools.chip.files', { count: fileCount }) }}</span>
    </template>
    <div v-if="isGlob" class="file-list">
      <button
        v-for="(file, i) in fileRows"
        :key="i"
        type="button"
        class="file-row"
        @click="openFile(file)"
      >
        {{ file }}
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
.file-list {
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
.file-row {
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.file-row:hover {
  background: var(--color-hover);
  color: var(--color-accent);
}
.file-row:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
</style>