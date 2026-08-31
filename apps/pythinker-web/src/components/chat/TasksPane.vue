<script setup lang="ts">
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TaskItem } from '../../types';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import StatusGlyph from './StatusGlyph.vue';

type ExtendedTaskItem = Omit<TaskItem, 'state'> & {
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

function extendedTask(task: TaskItem): ExtendedTaskItem {
  return task as ExtendedTaskItem;
}

function emptyKey(filter: string): string {
  if (filter === 'running') return 'tasks.emptyRunning';
  if (filter === 'done') return 'tasks.emptyDone';
  if (filter === 'active') return 'tasks.emptyRecent';
  return 'tasks.emptyTasks';
}

function isOpenable(task: TaskItem): boolean {
  return task.kind === 'subagent' || Boolean(task.output?.length || task.meta);
}

function openTask(task: TaskItem): void {
  if (!isOpenable(task)) return;
  emit('open', extendedTask(task).agentId ?? task.id);
}

function stateLabel(task: TaskItem): string {
  const state = extendedTask(task).state;
  if (state === 'done') return t('tasks.stateDone');
  if (state === 'fail') return t('tasks.stateFail');
  if (state === 'cancelled') return t('tasks.stateCancelled');
  return t('tasks.running');
}

const modelDisplayResolver = inject<(modelId: string | undefined) => string | undefined>('modelDisplay');
const subagentEffort = inject<(effort: string | undefined) => string | undefined>('subagentEffort');

function modelDisplay(task: TaskItem): string | undefined {
  if (task.kind !== 'subagent') return undefined;
  const raw = extendedTask(task).model;
  return modelDisplayResolver?.(raw) ?? raw;
}

function thinkingDisplay(task: TaskItem): string | undefined {
  if (task.kind !== 'subagent') return undefined;
  return subagentEffort?.(extendedTask(task).thinkingEffort);
}
</script>

<template>
  <div class="taskspane">
    <div class="tp-list">
      <div v-if="tasks.length === 0" class="tp-empty">{{ t(emptyKey(filter)) }}</div>
      <div
        v-for="task in tasks"
        v-else
        :key="task.id"
        class="tp-row"
        :class="{
          fail: extendedTask(task).state === 'fail',
          expandable: isOpenable(task),
        }"
      >
        <div class="tp-main">
          <button
            v-if="isOpenable(task)"
            class="tp-open"
            type="button"
            :aria-label="task.name"
            @click="openTask(task)"
          />
          <span class="tp-glyph" role="img" :aria-label="stateLabel(task)">
            <StatusGlyph v-if="extendedTask(task).state === 'run'" status="run" />
            <Icon v-else-if="extendedTask(task).state === 'done'" class="tp-done" name="check" size="sm" />
            <Icon
              v-else-if="extendedTask(task).state === 'cancelled'"
              class="tp-cancelled"
              name="close"
              size="sm"
            />
            <Icon v-else class="tp-fail" name="close" size="sm" />
          </span>
          <span class="tp-name">{{ task.name }}</span>
          <span v-if="task.meta" class="tp-meta">{{ task.meta }}</span>
          <span v-if="modelDisplay(task)" class="tp-model">{{ modelDisplay(task) }}</span>
          <span v-if="thinkingDisplay(task)" class="tp-model">{{ thinkingDisplay(task) }}</span>
          <span v-if="task.timing" class="tp-time">{{ task.timing }}</span>
          <IconButton
            v-if="extendedTask(task).state === 'run'"
            class="tp-stop"
            size="sm"
            :label="t('tasks.stop')"
            @click.stop="emit('cancel', task.id)"
          >
            <Icon name="close" size="sm" />
          </IconButton>
          <Icon v-if="isOpenable(task)" class="tp-chevron" name="chevron-right" size="sm" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.taskspane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-05);
}

.tp-row {
  padding: var(--space-1) 0;
}

.tp-row.fail .tp-name {
  color: var(--color-danger);
}

.tp-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
}

.tp-row.expandable > .tp-main {
  position: relative;
  border-radius: var(--radius-lg);
  padding: var(--space-1) var(--space-2);
  margin: calc(-1 * var(--space-1)) 0;
}

.tp-row.expandable > .tp-main:hover {
  background: var(--color-hover);
}

.tp-row:not(.expandable) {
  cursor: not-allowed;
}

.tp-open {
  position: absolute;
  inset: 0;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  cursor: pointer;
}

.tp-open:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.tp-chevron {
  flex: none;
  color: var(--muted);
}

.tp-name {
  color: var(--color-text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-meta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
}

.tp-glyph {
  flex: none;
  width: var(--p-ic-md);
  height: var(--p-ic-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tp-done {
  color: var(--color-success);
  transform: scale(0.91);
}

.tp-cancelled {
  color: var(--color-text-muted);
}

.tp-fail {
  color: var(--color-danger);
}

.tp-time {
  flex: none;
  font-size: var(--text-base);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  text-autospace: normal;
}

.tp-model {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-base);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-stop {
  position: relative;
  flex: none;
  color: var(--color-danger);
}

.tp-stop:hover {
  color: var(--color-danger);
}

@media (hover: none) {
  .tp-stop {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
  }

  .tp-row.expandable > .tp-main {
    min-height: var(--touch-target-min);
  }
}

.tp-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--faint);
  font-size: var(--ui-font-size-sm);
  user-select: none;
}

@media (max-width: 640px) {
  .tp-main {
    flex-wrap: wrap;
    row-gap: var(--space-1);
  }

  .tp-name {
    font-size: var(--ui-font-size-sm);
  }
}
</style>
