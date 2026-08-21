<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { normalizeToolName, toolGlyph, toolLabel } from '../../../lib/toolMeta';
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
const objective = computed(() => typeof arg.value?.objective === 'string' ? arg.value.objective : '');
const criterion = computed(() => {
  const value = arg.value?.completionCriterion ?? arg.value?.completion_criterion;
  return typeof value === 'string' ? value : '';
});
const status = computed(() => typeof arg.value?.status === 'string' ? arg.value.status : '');
const toolKey = computed(() => normalizeToolName(props.tool.name));
const statusLabel = computed(() => {
  if (status.value === 'active') return t('status.goalStatusActive');
  if (status.value === 'blocked') return t('status.goalStatusBlocked');
  if (status.value === 'complete') return t('status.goalStatusComplete');
  return status.value;
});
/** Header pill: updategoal shows its status (Active/Done/Blocked); creategoal
 *  always shows a constant "Active" pill (reference GoalTool trailing). */
const pill = computed<{ label: string; cls: string } | null>(() => {
  if (toolKey.value === 'updategoal' && statusLabel.value) {
    const cls = status.value === 'complete' ? 'pill-done'
      : status.value === 'blocked' ? 'pill-blocked'
      : 'pill-active';
    return { label: statusLabel.value, cls };
  }
  if (toolKey.value === 'creategoal') return { label: t('status.goalStatusActive'), cls: 'pill-active' };
  return null;
});
const summary = computed(() => {
  if (toolKey.value === 'updategoal' && statusLabel.value) return statusLabel.value;
  return objective.value && criterion.value
    ? t('tools.goal.objectiveWithCriterion', { objective: objective.value, criterion: criterion.value })
    : objective.value;
});
const budget = computed(() => {
  const value = arg.value?.value;
  const unit = arg.value?.unit;
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string') return '';
  if (['turns', 'tokens', 'milliseconds', 'seconds', 'minutes', 'hours'].includes(unit)) {
    return t(`tools.goal.${unit}`, { value });
  }
  return t('tools.goal.budget', { value, unit });
});
const canExpand = computed(
  () => status.value.length > 0 || budget.value.length > 0 || (props.tool.output?.length ?? 0) > 0,
);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
}

watch(
  () => [props.tool.defaultExpanded, props.tool.output?.length, props.tool.status, props.tool.arg] as const,
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
      <span v-if="pill" class="tl-pill" :class="pill.cls">{{ pill.label }}</span>
    </template>
    <div v-if="budget" class="goal-budget">{{ budget }}</div>
    <ToolOutputBlock
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.tl-pill {
  font-size: var(--text-xs);
  line-height: 1.5;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  flex: none;
  white-space: nowrap;
}
.tl-pill.pill-active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}
.tl-pill.pill-done {
  color: var(--color-success);
  background: var(--color-success-soft);
}
.tl-pill.pill-blocked {
  color: var(--color-warning);
  background: var(--color-warning-soft);
}
.goal-budget {
  color: var(--color-text-muted);
}
</style>
