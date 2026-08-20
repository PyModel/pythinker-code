<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TaskItem } from '../../types';
import { effortLabel } from '../../lib/modelThinking';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import StatusGlyph from './StatusGlyph.vue';

type ReferenceTaskItem = Omit<TaskItem, 'state'> & {
  agentId?: string;
  model?: string;
  thinkingEffort?: string;
  state: TaskItem['state'] | 'cancelled';
};

defineProps<{ tasks: TaskItem[]; filter: string }>();

const emit = defineEmits<{
  cancel: [taskId: string];
  open: [taskId: string];
}>();

const { t } = useI18n();

function referenceTask(task: TaskItem): ReferenceTaskItem {
  return task as ReferenceTaskItem;
}

function emptyKey(filter: string): string {
  if (filter === 'running') return 'tasks.emptyRunning';
  if (filter === 'done') return 'tasks.emptyDone';
  if (filter === 'active') return 'tasks.emptyRecent';
  return 'tasks.emptyTasks';
}

function modelDisplay(task: TaskItem): string | undefined {
  const { model, thinkingEffort } = referenceTask(task);
  return [model, thinkingEffort ? effortLabel(thinkingEffort) : undefined].filter(Boolean).join(' · ') || undefined;
}

function stateLabel(task: TaskItem): string {
  const state = referenceTask(task).state;
  if (state === 'done') return t('tasks.stateDone');
  if (state === 'fail') return t('tasks.stateFail');
  if (state === 'cancelled') return t('tasks.stateCancelled');
  return t('tasks.running');
}

function taskNumber(task: TaskItem, index: number): string {
  return String(task.dynamicWorkflowIndex ?? index + 1).padStart(2, '0');
}

function isOpenable(task: TaskItem): boolean {
  return Boolean(referenceTask(task).agentId || task.output?.length);
}
</script>

<template>
  <div v-if="tasks.length === 0" class="sg-empty">{{ t(emptyKey(filter)) }}</div>
  <div v-else class="sg-grid">
    <article
      v-for="(task, index) in tasks"
      :key="task.id"
      class="sg-card"
      :class="[`s-${referenceTask(task).state}`, { openable: isOpenable(task) }]"
    >
      <button
        v-if="isOpenable(task)"
        class="sg-open"
        type="button"
        :aria-label="task.name"
        @click="emit('open', referenceTask(task).agentId ?? task.id)"
      />
      <div class="sg-top">
        <span class="sg-num">{{ taskNumber(task, index) }}</span>
        <span class="sg-name">{{ task.name }}</span>
      </div>
      <div v-if="task.meta" class="sg-desc">{{ task.meta }}</div>
      <div class="sg-foot">
        <div v-if="modelDisplay(task)" class="sg-model">
          <span>{{ modelDisplay(task) }}</span>
        </div>
        <div class="sg-status">
          <span class="sg-state">
            <StatusGlyph v-if="referenceTask(task).state === 'run'" status="run" />
            <Icon
              v-else-if="referenceTask(task).state === 'done'"
              class="sg-ic-done"
              name="check"
              size="sm"
            />
            <Icon v-else name="close" size="sm" />
            {{ stateLabel(task) }}
          </span>
          <span v-if="task.timing" class="sg-time">
            <Icon name="clock" size="sm" />
            {{ task.timing }}
          </span>
        </div>
      </div>
      <IconButton
        v-if="referenceTask(task).state === 'run'"
        class="sg-cancel"
        size="sm"
        :label="t('tasks.stop')"
        @click.stop="emit('cancel', task.id)"
      >
        <Icon name="close" size="sm" />
      </IconButton>
    </article>
  </div>
</template>

<style scoped>
.sg-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-faint);
  font-size: var(--text-sm);
  user-select: none;
}

.sg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--p-subagent-card-min), 1fr));
  gap: var(--space-2);
}

.sg-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-selected);
}

.sg-card.openable {
  cursor: pointer;
}

.sg-card.openable:hover {
  background: var(--color-selected-hover);
}

.sg-card:not(.openable) {
  cursor: not-allowed;
}

.sg-open {
  position: absolute;
  inset: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  cursor: pointer;
}

.sg-open:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.sg-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sg-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-weight: var(--weight-medium);
}

.sg-num {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.sg-card:has(.sg-cancel) .sg-top {
  padding-right: calc(var(--icon-button-sm) + var(--space-1));
}

@media (hover: none) {
  .sg-card:has(.sg-cancel) .sg-top {
    padding-right: calc(var(--touch-target-min) + var(--space-1));
  }
}

.sg-desc {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-caption);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sg-foot {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sg-model {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.sg-model span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sg-status {
  display: flex;
  align-items: center;
}

.sg-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-autospace: normal;
}

.sg-ic-done {
  color: var(--color-success);
  transform: scale(0.91);
}

.s-fail .sg-state {
  color: var(--color-danger);
}

.sg-time {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  text-autospace: normal;
}

.sg-cancel {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  color: var(--color-text-muted);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
}

.sg-card:hover .sg-cancel,
.sg-cancel:focus-visible {
  opacity: 1;
}

.sg-cancel:hover {
  color: var(--color-danger);
}

@media (hover: none) {
  .sg-cancel {
    top: 0;
    right: 0;
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    opacity: 1;
  }
}
</style>
