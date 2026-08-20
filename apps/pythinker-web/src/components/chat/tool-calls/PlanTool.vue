<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel } from '../../../lib/toolMeta';
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
const selectedOption = computed(() => {
  const value = arg.value?.selectedOption ?? arg.value?.selected_option;
  return typeof value === 'string' ? value : '';
});
const reviewState = computed<'pending' | 'approved' | 'rejected' | 'cancelled'>(() => {
  if (props.tool.status === 'running') return 'pending';
  const output = (props.tool.output ?? []).join(' ').toLowerCase();
  if (output.includes('cancelled') || output.includes('canceled')) return 'cancelled';
  if (output.includes('rejected')) return 'rejected';
  if (output.includes('approved')) return 'approved';
  return props.tool.status === 'ok' ? 'approved' : 'rejected';
});
const reviewLabel = computed(() => t(`tools.plan.review.${reviewState.value}`));
const canExpand = computed(() => true);
const open = ref(props.tool.defaultExpanded === true);

function toggle(): void {
  open.value = !open.value;
}

function openPlan(): void {
  if (props.tool.planPath) emit('openFile', { path: props.tool.planPath });
}

watch(
  () => [props.tool.defaultExpanded, props.tool.output?.length, props.tool.status] as const,
  () => {
    if (props.tool.defaultExpanded === true) open.value = true;
  },
);
</script>

<template>
  <ToolRow
    :status="tool.status"
    :icon="toolGlyph(tool.name)"
    :name="toolLabel(tool.name)"
    :arg="!open ? selectedOption : ''"
    :time="tool.timing"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <div class="plan-review">{{ reviewLabel }}</div>
    <button v-if="tool.planPath" class="plan-path" type="button" @click="openPlan">
      <span>{{ t('tools.plan.pathOnlyHint') }}</span>
      <span class="plan-path-value">{{ tool.planPath }}</span>
    </button>
    <div v-if="selectedOption" class="plan-option">
      <span>{{ t('tools.plan.selectedOption') }}</span>
      <span>{{ selectedOption }}</span>
    </div>
    <ToolOutputBlock
      v-if="tool.output?.length"
      :lines="tool.output"
      :empty-text="t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.plan-review {
  color: var(--color-text-muted);
}
.plan-path {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.plan-path:hover {
  background: var(--color-hover);
}
.plan-path:focus-visible {
  outline: var(--p-focus-ring);
}
.plan-path-value {
  color: var(--color-accent);
  word-break: break-all;
}
.plan-option {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-2);
}
.plan-option > :first-child {
  color: var(--color-text-muted);
}
</style>
