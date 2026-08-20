<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel, toolSummary } from '../../../lib/toolMeta';
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

defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
}>();

const { t } = useI18n();
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
const resultCount = computed(() => props.tool.output?.length ?? 0);
const canExpand = computed(() => resultCount.value > 0);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
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
    <ToolOutputBlock
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>
