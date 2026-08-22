<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentPhase, TaskItem } from '../types';

const props = defineProps<{ tasks: TaskItem[] }>();

const emit = defineEmits<{
  open: [taskId: string];
  cancel: [taskId: string];
}>();

type WorkflowFilter = 'recent' | 'running' | 'done' | 'all';

const { t } = useI18n();
const filter = shallowRef<WorkflowFilter>('recent');
const filters: WorkflowFilter[] = ['recent', 'running', 'done', 'all'];

const runningCount = computed(() => props.tasks.filter((task) => task.state === 'run').length);
const visibleTasks = computed(() => {
  if (filter.value === 'running') return props.tasks.filter((task) => task.state === 'run');
  if (filter.value === 'done') return props.tasks.filter((task) => task.state !== 'run');
  return props.tasks;
});

function filterLabel(value: WorkflowFilter): string {
  return t(`tasks.workflow${value[0]!.toUpperCase()}${value.slice(1)}`);
}

function taskPhase(task: TaskItem): AgentPhase {
  if (task.phase) return task.phase;
  if (task.state === 'done') return 'completed';
  if (task.state === 'fail') return 'failed';
  return 'working';
}

function phaseLabel(task: TaskItem): string {
  return t(`tasks.workflowPhase${taskPhase(task)[0]!.toUpperCase()}${taskPhase(task).slice(1)}`);
}

function latestActivity(task: TaskItem): string {
  return task.output?.findLast((line) => line.trim().length > 0)?.trim() ?? task.meta ?? t('tasks.workflowWaiting');
}

function taskNumber(task: TaskItem, index: number): string {
  return String(task.dynamicWorkflowIndex ?? index + 1).padStart(2, '0');
}
</script>

<template>
  <section class="dw-panel" :aria-label="t('tasks.dockSubagent')">
    <header class="dw-panel-head">
      <div class="dw-panel-heading">
        <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="5" r="2.25" />
          <circle cx="5" cy="18" r="2.25" />
          <circle cx="19" cy="18" r="2.25" />
          <path d="M12 7.25v4.25M5 15.75v-2.5h14v2.5" />
        </svg>
        <h2 class="dw-panel-title">{{ t('tasks.dockSubagent') }}</h2>
        <span class="dw-panel-count">{{ runningCount }} {{ t('tasks.running') }}</span>
      </div>
      <nav class="dw-filters" :aria-label="t('tasks.workflowFilterLabel')">
        <button
          v-for="value in filters"
          :key="value"
          type="button"
          class="dw-filter"
          :class="{ on: filter === value }"
          :data-filter="value"
          :aria-pressed="filter === value"
          @click="filter = value"
        >
          {{ filterLabel(value) }}
        </button>
      </nav>
    </header>

    <div class="dw-panel-body">
      <div v-if="visibleTasks.length > 0" class="dw-grid">
        <article v-for="(task, index) in visibleTasks" :key="task.id" class="dw-card">
          <button
            type="button"
            class="dw-card-open"
            :aria-label="t('tasks.workflowOpenWorker', { name: task.name })"
            @click="emit('open', task.id)"
          >
            <span class="dw-card-top">
              <span class="dw-card-number">{{ taskNumber(task, index) }}</span>
              <span class="dw-card-name">{{ task.name }}</span>
            </span>
            <span class="dw-card-activity">{{ latestActivity(task) }}</span>
            <span v-if="task.subagentType" class="dw-card-type">
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4.5" width="10" height="8" rx="2" />
                <path d="M8 2v2.5M5.5 8h.01M10.5 8h.01M6 10.5h4" />
              </svg>
              {{ task.subagentType }}
            </span>
            <span class="dw-card-status">
              <span class="dw-card-state">
                <span class="dw-state-dot" :class="`phase-${taskPhase(task)}`" aria-hidden="true" />
                {{ phaseLabel(task) }}
              </span>
              <span class="dw-card-time">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M8 4.5V8l2 1.5" />
                </svg>
                {{ task.timing }}
              </span>
            </span>
          </button>
          <button
            v-if="task.state === 'run'"
            type="button"
            class="dw-card-cancel"
            :title="t('tasks.stop')"
            :aria-label="`${t('tasks.stop')} ${task.name}`"
            @click="emit('cancel', task.id)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </article>
      </div>
      <div v-else class="dw-empty">{{ t('tasks.emptySubagent') }}</div>
    </div>
  </section>
</template>

<style scoped>
.dw-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background: var(--bg);
  color: var(--ink);
}

.dw-panel-head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 12px;
}

.dw-panel-heading,
.dw-filters,
.dw-card-top,
.dw-card-type,
.dw-card-status,
.dw-card-state,
.dw-card-time {
  display: flex;
  align-items: center;
}

.dw-panel-heading {
  min-width: 0;
  gap: 9px;
}

.dw-panel-heading > svg {
  flex: none;
}

.dw-panel-title {
  margin: 0;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
}

.dw-panel-count {
  white-space: nowrap;
  font-size: 14px;
  color: var(--muted);
}

.dw-filters {
  flex: none;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 11px;
}

.dw-filter {
  min-height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.dw-filter:hover {
  color: var(--ink);
  background: var(--hover);
}

.dw-filter.on {
  color: var(--ink);
  background: var(--panel2);
}

.dw-filter:focus-visible,
.dw-card-open:focus-visible,
.dw-card-cancel:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

.dw-panel-body {
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
}

.dw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.dw-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--panel2);
}

.dw-card:hover {
  background: color-mix(in srgb, var(--ink) 7%, var(--panel2));
}

.dw-card-open {
  display: flex;
  width: 100%;
  min-height: 142px;
  flex-direction: column;
  gap: 9px;
  padding: 13px;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.dw-card-top {
  width: 100%;
  min-width: 0;
  gap: 9px;
  padding-right: 20px;
}

.dw-card-number {
  flex: none;
  color: var(--muted);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.dw-card-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 550;
}

.dw-card-activity {
  display: -webkit-box;
  min-height: 38px;
  overflow: hidden;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.dw-card-type {
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}

.dw-card-type > svg {
  flex: none;
}

.dw-card-status {
  width: 100%;
  gap: 8px;
  margin-top: auto;
  color: var(--muted);
  font-size: 12px;
}

.dw-card-state,
.dw-card-time {
  min-width: 0;
  gap: 5px;
}

.dw-card-time {
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dw-state-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--muted);
}

.dw-state-dot.phase-working {
  background: var(--blue);
}

.dw-state-dot.phase-completed {
  background: var(--ok);
}

.dw-state-dot.phase-failed {
  background: var(--err);
}

.dw-state-dot.phase-suspended {
  background: var(--warn);
}

.dw-card-cancel {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--muted);
  background: transparent;
  opacity: 0;
  cursor: pointer;
}

.dw-card:hover .dw-card-cancel,
.dw-card-cancel:focus-visible {
  opacity: 1;
}

.dw-card-cancel:hover {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 12%, transparent);
}

.dw-empty {
  display: grid;
  min-height: 150px;
  place-items: center;
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 620px) {
  .dw-panel-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .dw-filters {
    width: 100%;
  }

  .dw-filter {
    flex: 1;
    padding-inline: 5px;
  }

  .dw-grid {
    grid-template-columns: 1fr;
  }
}

@media (hover: none) {
  .dw-card-cancel {
    opacity: 1;
  }
}
</style>
