<!-- ChatDock.vue -->
<!-- Bottom dock that belongs to the chat tab: goal strip, running-task chips, -->
<!-- pending question/approval cards, and the composer. Only rendered inside a -->
<!-- chat-pane group so it never leaks into files/tasks/preview/btw panes. -->
<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivationBadges, ApprovalBlock, ConversationStatus, PermissionMode, QueuedPromptView, TaskItem, TodoView, UIQuestion } from '../types';
import type { AppGoal, AppModel, AppSkill, QuestionResponse, ThinkingLevel } from '../api/types';
import type { FileItem } from './MentionMenu.vue';
import Composer from './Composer.vue';
import GoalStrip from './GoalStrip.vue';
import QuestionCard from './QuestionCard.vue';
import ApprovalCard from './ApprovalCard.vue';
import TasksPane from './TasksPane.vue';
import TodoCard from './TodoCard.vue';
import QueuePane from './QueuePane.vue';

const props = defineProps<{
  sessionId?: string;
  running?: boolean;
  queued?: QueuedPromptView[];
  searchFiles?: (q: string) => Promise<FileItem[]>;
  uploadImage?: (file: Blob, name?: string) => Promise<{ fileId: string; name: string; mediaType: string } | null>;
  status: ConversationStatus;
  thinking?: ThinkingLevel;
  planMode?: boolean;
  dynamicWorkflowMode?: boolean;
  goalMode?: boolean;
  activationBadges?: ActivationBadges;
  models?: AppModel[];
  starredIds?: string[];
  skills?: AppSkill[];
  goal?: AppGoal | null;
  goalExpandSignal?: number;
  dockPanel: 'bash' | 'subagent' | 'todos' | 'queue' | null;
  bashTasks: TaskItem[];
  subagentTasks: TaskItem[];
  bashRunning: number;
  subagentRunning: number;
  todoDoneCount: number;
  hasDockWork: boolean;
  todos?: TodoView[];
  pendingQuestion?: UIQuestion;
  pendingApproval?: { approvalId: string; block: ApprovalBlock; agentName?: string };
  mobile?: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: { text: string; attachments: { fileId: string; kind: 'image' | 'video' }[] }];
  steer: [payload: { text: string; attachments: { fileId: string; kind: 'image' | 'video' }[] }];
  command: [cmd: string];
  interrupt: [];
  unqueue: [index: number];
  editQueued: [index: number];
  setPermission: [mode: PermissionMode];
  setThinking: [level: ThinkingLevel];
  togglePlan: [];
  toggleDynamicWorkflow: [];
  toggleGoal: [];
  openBtw: [];
  createGoal: [objective: string];
  controlGoal: [action: 'pause' | 'resume' | 'cancel'];
  focusGoal: [];
  focusDynamicWorkflow: [];
  compact: [];
  pickModel: [];
  selectModel: [modelId: string];
  answer: [questionId: string, response: QuestionResponse];
  dismiss: [questionId: string];
  approval: [approvalId: string, response: { decision: 'approved' | 'rejected' | 'cancelled'; scope?: 'session'; feedback?: string }];
  cancelTask: [taskId: string];
  'toggle-dock-panel': [panel: 'bash' | 'subagent' | 'todos' | 'queue'];
  'close-dock-panel': [];
}>();

const { t } = useI18n();
const composerRef = ref<{ loadForEdit: (value: string) => void } | null>(null);
const workPanelRef = ref<HTMLElement | null>(null);
const workbarRef = ref<HTMLElement | null>(null);

function loadForEdit(value: string): void {
  composerRef.value?.loadForEdit(value);
}

function handleEditQueued(index: number): void {
  const text = props.queued?.[index]?.text ?? '';
  if (text) loadForEdit(text);
  emit('editQueued', index);
}

function onDocumentMouseDown(event: MouseEvent): void {
  if (!props.dockPanel) return;
  const target = event.target as Node | null;
  if (!target) return;
  if (workPanelRef.value?.contains(target)) return;
  if (workbarRef.value?.contains(target)) return;
  emit('close-dock-panel');
}

watch(
  () => props.dockPanel,
  (panel) => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    if (panel) document.addEventListener('mousedown', onDocumentMouseDown, true);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
  }
});

defineExpose({ loadForEdit });
</script>

<template>
  <div class="chat-dock" :class="[mobile ? 'align-mobile' : 'align-center']" @click.stop>
    <!-- Task chips and their panel float over the conversation, so opening one
         never changes the composer's position. -->
    <div v-if="dockPanel || hasDockWork" class="dock-float">
    <Transition name="dock-panel">
      <div
        ref="workPanelRef"
        v-if="dockPanel"
        class="dock-work-panel"
        @click.stop
      >
        <div class="dock-work-head">
          <span
            v-if="dockPanel === 'bash'"
            class="dock-work-tab static"
          >
            {{ t('tasks.dockBash') }} · {{ bashRunning }} {{ t('tasks.running') }}
          </span>
          <span
            v-else-if="dockPanel === 'subagent'"
            class="dock-work-tab static"
          >
            {{ t('tasks.dockSubagent') }} · {{ subagentRunning }} {{ t('tasks.running') }}
          </span>
          <span
            v-else-if="dockPanel === 'todos'"
            class="dock-work-tab static"
          >
            {{ t('tasks.dockTodos') }} · {{ todoDoneCount }}/{{ todos?.length ?? 0 }}
          </span>
          <span
            v-else-if="dockPanel === 'queue'"
            class="dock-work-tab static"
          >
            {{ t('tasks.dockQueue') }} · {{ queued?.length ?? 0 }}
          </span>
          <button
            v-if="dockPanel === 'queue' && running"
            type="button"
            class="dock-queue-steer"
            :title="t('composer.steerTitle')"
            @click="emit('steer', { text: '', attachments: [] })"
          >{{ t('composer.steerNow') }}</button>
        </div>
        <div class="dock-work-body">
          <TasksPane
            v-if="dockPanel === 'bash'"
            :tasks="bashTasks"
            @cancel="emit('cancelTask', $event)"
          />
          <TasksPane
            v-else-if="dockPanel === 'subagent'"
            :tasks="subagentTasks"
            @cancel="emit('cancelTask', $event)"
          />
          <TodoCard
            v-else-if="dockPanel === 'todos'"
            :todos="todos ?? []"
            inline
          />
          <QueuePane
            v-else
            :queued="queued ?? []"
            :running="running"
            inline
            @steer="emit('steer', { text: '', attachments: [] })"
            @unqueue="emit('unqueue', $event)"
            @edit-queued="handleEditQueued"
          />
        </div>
      </div>
    </Transition>

    <div v-if="hasDockWork" ref="workbarRef" class="dock-workbar">
      <button
        v-if="bashTasks.length > 0"
        type="button"
        class="dock-work-chip"
        :class="{ on: dockPanel === 'bash' }"
        :aria-pressed="dockPanel === 'bash'"
        @click="emit('toggle-dock-panel', 'bash')"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
        <span>{{ t('tasks.dockBash') }}</span>
        <span class="dw-count">(<b>{{ bashTasks.length }}</b>)</span>
      </button>
      <button
        v-if="subagentTasks.length > 0"
        type="button"
        class="dock-work-chip"
        :class="{ on: dockPanel === 'subagent' }"
        :aria-pressed="dockPanel === 'subagent'"
        @click="emit('toggle-dock-panel', 'subagent')"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />
        </svg>
        <span>{{ t('tasks.dockSubagent') }}</span>
        <span class="dw-count">(<b>{{ subagentTasks.length }}</b>)</span>
      </button>
      <button
        v-if="(todos?.length ?? 0) > 0"
        type="button"
        class="dock-work-chip"
        :class="{ on: dockPanel === 'todos' }"
        :aria-pressed="dockPanel === 'todos'"
        @click="emit('toggle-dock-panel', 'todos')"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M3 4.5l1.5 1.5L7 3.5" />
          <path d="M8.5 5h4" />
          <path d="M3 11l1.5 1.5L7 10" />
          <path d="M8.5 11.5h4" />
        </svg>
        <span>{{ t('tasks.dockTodos') }}</span>
        <span class="dw-count">(<b>{{ todoDoneCount }}/{{ todos?.length ?? 0 }}</b>)</span>
      </button>
      <button
        v-if="(queued?.length ?? 0) > 0"
        type="button"
        class="dock-work-chip"
        :class="{ on: dockPanel === 'queue' }"
        :aria-pressed="dockPanel === 'queue'"
        @click="emit('toggle-dock-panel', 'queue')"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M2 4l6 4 6-4" />
          <rect x="2" y="4" width="12" height="8" rx="1.5" />
        </svg>
        <span>{{ t('tasks.dockQueue') }}</span>
        <span class="dw-count">(<b>{{ queued?.length ?? 0 }}</b>)</span>
      </button>
    </div>
    </div>

    <GoalStrip
      v-if="goal"
      :goal="goal"
      :force-expanded="goalExpandSignal"
      @control-goal="emit('controlGoal', $event)"
    />

    <QuestionCard
      v-if="pendingQuestion"
      :key="pendingQuestion.questionId"
      :question="pendingQuestion"
      @answer="(qid, resp) => emit('answer', qid, resp)"
      @dismiss="emit('dismiss', $event)"
    />
    <ApprovalCard
      v-else-if="pendingApproval"
      :key="pendingApproval.approvalId"
      class="dock-approval"
      :block="pendingApproval.block"
      :agent-name="pendingApproval.agentName"
      @decide="emit('approval', pendingApproval!.approvalId, $event)"
    />
    <Composer
      v-else
      ref="composerRef"
      :session-id="sessionId"
      :running="running"
      :queued="queued"
      :search-files="searchFiles"
      :upload-image="uploadImage"
      :status="status"
      :thinking="thinking"
      :plan-mode="planMode"
      :dynamic-workflow-mode="dynamicWorkflowMode"
      :goal-mode="goalMode"
      :activation-badges="activationBadges"
      :models="models"
      :starred-ids="starredIds"
      :skills="skills"
      @submit="emit('submit', $event)"
      @steer="emit('steer', $event)"
      @command="emit('command', $event)"
      @interrupt="emit('interrupt')"
      @set-permission="emit('setPermission', $event)"
      @set-thinking="emit('setThinking', $event)"
      @toggle-plan="emit('togglePlan')"
      @toggle-dynamic-workflow="emit('toggleDynamicWorkflow')"
      @toggle-goal="emit('toggleGoal')"
      @open-btw="emit('openBtw')"
      @create-goal="emit('createGoal', $event)"
      @control-goal="emit('controlGoal', $event)"
      @focus-goal="emit('focusGoal')"
      @focus-dynamic-workflow="emit('focusDynamicWorkflow')"
      @compact="emit('compact')"
      @pick-model="emit('pickModel')"
      @select-model="emit('selectModel', $event)"
    />
  </div>
</template>

<style scoped>
.chat-dock {
  --dock-inline-left: 16px;
  --dock-inline-right: 16px;
  box-sizing: border-box;
  width: 100%;
  max-width: calc(var(--read-max) + var(--panes-scrollbar-width, 0px));
  padding-right: var(--panes-scrollbar-width, 0px);
  flex: none;
  position: relative;
  background: transparent;
  z-index: 10;
}

/* Use a different surface so the card radius reads against the page, especially in dark mode; --sh only exists on the modern and pythinker themes, hence the fallback. */
.chat-dock :deep(.composer-card) {
  background: color-mix(in srgb, var(--panel) 78%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--sh, 0 6px 18px color-mix(in srgb, var(--ink) 28%, transparent));
}

.chat-dock.align-center { margin-left: auto; margin-right: auto; }
.chat-dock.align-left { margin-left: 0; margin-right: auto; }
.chat-dock.align-mobile { max-width: none; }

/* The chips and their panel sit outside the flow, stacked upwards from the top
   edge of the composer. Nothing here changes the dock's height, so opening a
   panel never moves the composer. */
.dock-float {
  position: absolute;
  left: var(--dock-inline-left);
  right: calc(var(--dock-inline-right) + var(--panes-scrollbar-width, 0px));
  bottom: 100%;
  z-index: 11;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-bottom: 6px;
  /* Only the chips and the panel take clicks; the gap between them does not. */
  pointer-events: none;
}
.dock-float > * {
  pointer-events: auto;
}

.dock-work-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  max-height: min(360px, 50vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dock-work-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}
.dock-work-tab {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--line);
}
.dock-work-tab.static {
  background: transparent;
  border-color: transparent;
  padding-left: 2px;
}
.dock-queue-steer {
  margin-left: auto;
  background: none;
  border: 1px solid var(--blueln);
  border-radius: 3px;
  padding: 2px 8px;
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 3px);
  color: var(--blue2);
  cursor: pointer;
  white-space: nowrap;
}
.dock-queue-steer:hover {
  background: var(--bluebg);
}
.dock-work-body {
  padding: 8px 10px;
  overflow-y: auto;
  min-height: 0;
}
.dock-work-body :deep(.taskspane) {
  border: none;
  background: transparent;
  padding: 0;
}
.dock-work-body :deep(.taskspane .tp-head) {
  display: none;
}
.dock-work-body :deep(.todo-card.tab-mode) {
  border: none;
  background: transparent;
  padding: 0;
}
.dock-work-body :deep(.todo-card.tab-mode .tc-list) {
  max-height: none;
}
.dock-work-body :deep(.queue-pane) {
  padding: 0;
}
.dock-work-body :deep(.queue-pane.tab-mode .queue-list) {
  max-height: none;
}

.dock-workbar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dock-work-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  cursor: pointer;
}
/* Opaque on purpose: the chip floats over the conversation, so a translucent
   wash would let the text behind it show through. */
.dock-work-chip:hover,
.dock-work-chip.on {
  background: color-mix(in srgb, var(--ink) 6%, var(--panel));
  color: var(--ink);
}
.dock-work-chip svg {
  flex: none;
}
.dock-work-chip b {
  font-weight: 600;
  color: var(--ink);
}
.dock-work-chip .dw-count {
  margin-left: 1px;
}

.dock-approval {
  margin-top: 8px;
}

@media (max-width: 640px) {
  .chat-dock {
    --dock-inline-left: max(12px, env(safe-area-inset-left));
    --dock-inline-right: max(12px, env(safe-area-inset-right));
  }
  .chat-dock.align-mobile {
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }
  .dock-float {
    left: 10px;
    right: calc(10px + var(--panes-scrollbar-width, 0px));
  }
}

.chat-dock:not(.align-mobile) :deep(.composer) {
  padding-bottom: 14px;
}

.dock-panel-enter-active,
.dock-panel-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.dock-panel-enter-from,
.dock-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
