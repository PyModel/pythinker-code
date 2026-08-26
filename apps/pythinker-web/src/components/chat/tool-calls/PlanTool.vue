<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, SessionPlanEntry, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel } from '../../../lib/toolMeta';
import Button from '../../ui/Button.vue';
import Icon from '../../ui/Icon.vue';
import ToolRow from '../ToolRow.vue';
import ToolOutputBlock from './ToolOutputBlock.vue';

// Lazy: markstream's katex worker fails to resolve under vitest's node loader,
// and PlanTool only needs markdown when a plan projection exists.
const Markdown = defineAsyncComponent(() => import('../Markdown.vue'));

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
// The plan markdown projection captured from the plan_review approval display,
// keyed by tool-call id (provided by ConversationPane from client.sessionPlans).
const resolvePlan = inject<(toolCallId: string) => SessionPlanEntry | undefined>('resolvePlan');
const revealSavedPlan = inject<(agentId: string, toolCallId: string) => Promise<boolean>>('revealSavedPlan');
const plan = computed(() => resolvePlan?.(props.tool.id));
const planMarkdown = computed(() => (plan.value?.plan && plan.value.plan.length > 0 ? plan.value.plan : ''));
const savedPlanPath = computed(() => plan.value?.path ?? props.tool.planPath);
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

function revealPlan(): void {
  const savedPlan = plan.value;
  if (savedPlan?.path === undefined) return;
  void revealSavedPlan?.(savedPlan.agentId, savedPlan.toolCallId);
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
    <div v-if="savedPlanPath" class="plan-path">
      <span>{{ t('tools.plan.pathOnlyHint') }}</span>
      <span class="plan-path-value">{{ savedPlanPath }}</span>
      <Button
        v-if="plan?.path"
        variant="ghost"
        size="sm"
        @click.stop="revealPlan"
      >
        <Icon name="external-link" size="sm" />
        {{ t('tools.plan.revealInFileManager') }}
      </Button>
    </div>
    <div v-if="planMarkdown" class="plan-md">
      <Markdown :text="planMarkdown" :open-file="(target) => emit('openFile', target)" />
    </div>
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
.plan-md {
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-well);
  color: var(--color-text);
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
  text-align: left;
}
.plan-path-value {
  color: var(--color-accent);
  word-break: break-all;
}
.plan-path :deep(.ui-button) {
  justify-self: start;
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
