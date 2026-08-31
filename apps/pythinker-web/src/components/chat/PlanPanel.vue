<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, SessionPlanEntry } from '../../types';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import Markdown from './Markdown.vue';

defineProps<{
  plan?: SessionPlanEntry;
  planModeOn?: boolean;
  openFile?: (target: FilePreviewRequest) => void;
  revealSavedPlan?: (agentId: string, toolCallId: string) => Promise<boolean>;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="plan-panel">
    <div v-if="plan?.selectedOption" class="plan-review-row">
      <span class="plan-review-label">{{ t('tools.plan.selectedOption') }}</span>
      <span>{{ plan.selectedOption }}</span>
    </div>
    <div v-if="plan?.feedback" class="plan-review-row plan-review-feedback">
      <span class="plan-review-label">{{ t('tools.plan.feedback') }}</span>
      <span>{{ plan.feedback }}</span>
    </div>
    <Markdown v-if="plan?.plan" :text="plan.plan" :open-file="openFile" />
    <div v-else-if="plan?.path" class="plan-path-only">
      <span class="plan-path-hint">{{ t('tools.plan.pathOnlyHint') }}</span>
      <span class="plan-path">{{ plan.path }}</span>
      <Button
        v-if="revealSavedPlan"
        variant="ghost"
        size="sm"
        @click="void revealSavedPlan(plan.agentId, plan.toolCallId)"
      >
        <Icon name="external-link" size="sm" />
        {{ t('tools.plan.revealInFileManager') }}
      </Button>
    </div>
    <div v-else class="plan-empty">
      <Icon class="plan-empty-ico" name="file-edit" size="lg" />
      <span>{{ t(planModeOn ? 'status.planEmptyArmed' : 'status.planEmptyIdle') }}</span>
    </div>
  </div>
</template>

<style scoped>
.plan-panel { display: flex; flex-direction: column; gap: var(--space-2); }
.plan-review-row { display: flex; gap: var(--space-2); font-size: var(--text-sm); }
.plan-review-label, .plan-review-feedback { color: var(--color-text-muted); }
.plan-review-label { flex: none; }
.plan-path-only { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1); }
.plan-path-hint { color: var(--color-text-muted); font-size: var(--text-sm); }
.plan-path { max-width: 100%; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-6) var(--space-4); color: var(--color-text-faint); font-size: var(--text-sm); }
.plan-empty-ico { width: var(--p-empty-ico); height: var(--p-empty-ico); color: var(--color-line-strong); }
</style>
