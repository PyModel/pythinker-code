<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ActivationBadges,
  ApprovalBlock,
  ConversationStatus,
  FilePreviewRequest,
  PermissionMode,
  QueuedPromptView,
  SessionPlanEntry,
  TaskItem,
  TodoView,
  UIQuestion,
} from '../../types';
import type { AppGoal, AppModel, AppSkill, QuestionResponse, ThinkingLevel } from '../../api/types';
import type { FileItem } from './MentionMenu.vue';
import type { PromptAttachment } from '../../composables/usePythinkerWebClient';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import ApprovalCard from './ApprovalCard.vue';
import Composer from './Composer.vue';
import GoalPanel from './GoalPanel.vue';
import PlanPanel from './PlanPanel.vue';
import QuestionCard from './QuestionCard.vue';
import StatusGlyph from './StatusGlyph.vue';
import SubagentGrid from './SubagentGrid.vue';
import TasksPane from './TasksPane.vue';
import TodoCard from './TodoCard.vue';
import FilterControl from '../ui/FilterControl.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import WorkPanelHead from '../ui/WorkPanelHead.vue';
import WorkPill from '../ui/WorkPill.vue';

type DockPanel = 'bash' | 'subagent' | 'todos' | 'goal' | 'plan';
type TaskFilter = 'active' | 'running' | 'done' | 'all';

const props = defineProps<{
  sessionId?: string;
  running?: boolean;
  working?: boolean;
  starting?: boolean;
  queued?: QueuedPromptView[];
  searchFiles?: (q: string) => Promise<FileItem[]>;
  uploadImage?: (
    file: Blob,
    name?: string,
  ) => Promise<{ fileId: string; name: string; mediaType: string } | null>;
  status: ConversationStatus;
  thinking?: ThinkingLevel;
  planMode?: boolean;
  planArmed?: boolean;
  goalMode?: boolean;
  dynamicWorkflowMode?: boolean;
  activationBadges?: ActivationBadges;
  models?: AppModel[];
  starredIds?: string[];
  skills?: AppSkill[];
  goal?: AppGoal | null;
  sessionPlans?: Record<string, SessionPlanEntry>;
  dockPanel: DockPanel | null;
  overlayOpen?: boolean;
  bashTasks: TaskItem[];
  subagentTasks: TaskItem[];
  bashRunning: number;
  subagentRunning: number;
  todoDoneCount: number;
  hasDockWork: boolean;
  todos?: TodoView[];
  pendingQuestion?: UIQuestion;
  questionBusyKind?: 'answer' | 'dismiss';
  pendingApproval?: { approvalId: string; block: ApprovalBlock; agentName?: string };
  approvalBusy?: boolean;
  mobile?: boolean;
  openFile?: (target: FilePreviewRequest) => void;
}>();

const emit = defineEmits<{
  submit: [payload: { text: string; attachments: PromptAttachment[] }];
  steer: [payload: { text: string; attachments: PromptAttachment[] }];
  command: [cmd: string];
  interrupt: [];
  setPermission: [mode: PermissionMode];
  setThinking: [level: ThinkingLevel];
  togglePlan: [];
  toggleWorkflow: [];
  toggleGoal: [];
  openBtw: [];
  createGoal: [objective: string];
  controlGoal: [action: 'pause' | 'resume' | 'cancel'];
  focusGoal: [];
  compact: [];
  pickModel: [];
  selectModel: [modelId: string];
  answer: [questionId: string, response: QuestionResponse];
  dismiss: [questionId: string];
  approval: [
    approvalId: string,
    response: {
      decision: 'approved' | 'rejected' | 'cancelled';
      scope?: 'session';
      feedback?: string;
      selectedLabel?: string;
    },
  ];
  cancelTask: [taskId: string];
  'toggle-dock-panel': [panel: DockPanel];
  'close-dock-panel': [];
  openAgent: [taskId: string];
}>();

const { t } = useI18n();
const { confirm, current: confirmDialog } = useConfirmDialog();
const composerRef = ref<InstanceType<typeof Composer> | null>(null);
const dockRef = ref<HTMLElement | null>(null);
const workPanelRef = ref<HTMLElement | null>(null);
const workBodyRef = ref<HTMLElement | null>(null);
const narrow = ref(false);
const bodyScrolled = ref(false);
const panelOrigin = ref('50% 100%');
const bashFilter = ref<TaskFilter>('active');
const subagentFilter = ref<TaskFilter>('active');
const latestPlan = computed(() => Object.values(props.sessionPlans ?? {}).at(-1));
const composerPopupOpen = computed(() => composerRef.value?.anyPopupOpen ?? false);
const filterOptions = computed(() => [
  { value: 'active', label: t('tasks.filterRecent'), icon: 'clock' },
  { value: 'running', label: t('tasks.filterRunning'), icon: 'play' },
  { value: 'done', label: t('tasks.filterDone'), icon: 'circle-check' },
  { value: 'all', label: t('tasks.filterAll'), icon: 'list' },
]);
const allTodosDone = computed(
  () => (props.todos?.length ?? 0) > 0 && props.todoDoneCount === (props.todos?.length ?? 0),
);
const goalStatusText = computed(() =>
  props.goal
    ? t(`status.goalStatus${props.goal.status[0]!.toUpperCase()}${props.goal.status.slice(1)}`)
    : '',
);
const goalDuration = computed(() => {
  const seconds = Math.max(0, Math.round((props.goal?.wallClockMs ?? 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours}${t('status.timeUnitHour')} ${minutes}${t('status.timeUnitMinute')}`;
  if (minutes) {
    return `${minutes}${t('status.timeUnitMinute')} ${seconds % 60}${t('status.timeUnitSecond')}`;
  }
  return `${seconds}${t('status.timeUnitSecond')}`;
});
const bashTitle = computed(() =>
  props.bashTasks.some((task) => task.kind === 'tool') ? t('tasks.dockTasks') : t('tasks.dockBash'),
);

function filtered(tasks: TaskItem[], filter: TaskFilter): TaskItem[] {
  if (filter === 'all') return tasks;
  if (filter === 'running') return tasks.filter((task) => task.state === 'run');
  if (filter === 'done') return tasks.filter((task) => task.state !== 'run');
  const running = tasks.filter((task) => task.state === 'run');
  const recent = tasks
    .filter((task) => task.state !== 'run')
    .toSorted(
      (a, b) =>
        Date.parse(b.completedAt ?? b.createdAt ?? '') - Date.parse(a.completedAt ?? a.createdAt ?? ''),
    )
    .slice(0, 5);
  return [...running, ...recent];
}

const filteredBash = computed(() => filtered(props.bashTasks, bashFilter.value));
const filteredSub = computed(() => filtered(props.subagentTasks, subagentFilter.value));

function togglePanel(panel: DockPanel, event: MouseEvent): void {
  const element = event.currentTarget as HTMLElement | null;
  const dock = dockRef.value;
  if (element && dock) {
    const elementRect = element.getBoundingClientRect();
    const dockRect = dock.getBoundingClientRect();
    panelOrigin.value = `${elementRect.left + elementRect.width / 2 - dockRect.left}px 100%`;
  }
  emit('toggle-dock-panel', panel);
}

function onScroll(): void {
  bodyScrolled.value = (workBodyRef.value?.scrollTop ?? 0) > 0;
}

function onMouseDown(event: MouseEvent): void {
  if (!props.dockPanel) return;
  const target = event.target as Element | null;
  if (!target || workPanelRef.value?.contains(target) || target.closest('.ui-pill')) return;
  emit('close-dock-panel');
}

function onKeyDown(event: KeyboardEvent): void {
  if (!props.dockPanel) return;
  if (
    event.key !== 'Escape' ||
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    composerPopupOpen.value ||
    confirmDialog.value ||
    props.overlayOpen
  ) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  emit('close-dock-panel');
}

async function cancelGoal(): Promise<void> {
  if (
    await confirm({
      title: t('status.goalCancel'),
      message: t('status.goalCancelConfirm'),
      confirmLabel: t('status.goalCancelConfirmYes'),
      cancelLabel: t('status.goalCancelConfirmNo'),
      variant: 'danger',
    })
  ) {
    emit('controlGoal', 'cancel');
  }
}

function publishDock(): void {
  const dock = dockRef.value;
  if (!dock) return;
  document.documentElement.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
  const breakpoint = Number.parseFloat(getComputedStyle(dock).getPropertyValue('--p-bp-sm')) || 640;
  narrow.value = dock.offsetWidth < breakpoint;
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  if (typeof ResizeObserver === 'function' && dockRef.value) {
    observer = new ResizeObserver(() => {
      publishDock();
      onScroll();
    });
    observer.observe(dockRef.value);
    publishDock();
  }
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  observer?.disconnect();
});

watch(
  () => props.dockPanel,
  () => {
    bodyScrolled.value = false;
    void nextTick(onScroll);
  },
);

function loadForEdit(value: string): boolean {
  return composerRef.value?.loadForEdit(value) ?? false;
}

function loadAttachmentsForEdit(
  attachments: { fileId?: string; kind: 'image' | 'video' | 'file'; url: string; name?: string }[],
): void {
  composerRef.value?.loadAttachmentsForEdit(attachments);
}

function focus(): void {
  composerRef.value?.focus();
}

defineExpose({
  loadForEdit,
  loadAttachmentsForEdit,
  focus,
  anyPopupOpen: composerPopupOpen,
  isEmpty: computed(() => composerRef.value?.isEmpty ?? true),
});
</script>

<template>
  <div
    ref="dockRef"
    class="chat-dock"
    :class="[
      mobile ? 'align-mobile' : 'align-center',
      {
        'has-popup': composerPopupOpen || dockPanel,
        'has-approval': !!pendingApproval && !pendingQuestion,
        'pills-compact': narrow,
      },
    ]"
    @click.stop
  >
    <Transition name="dock-panel">
      <div
        v-if="dockPanel"
        :key="dockPanel"
        ref="workPanelRef"
        class="dock-work-panel"
        :class="[`panel-${dockPanel}`, { 'body-scrolled-up': bodyScrolled }]"
        :style="{ transformOrigin: panelOrigin }"
      >
        <div class="dock-work-head">
          <WorkPanelHead
            v-if="dockPanel === 'bash'"
            icon="terminal"
            :title="bashTitle"
            :meta="`${bashRunning} ${t('tasks.running')}`"
          >
            <template #actions>
              <FilterControl v-model="bashFilter" :options="filterOptions" />
            </template>
          </WorkPanelHead>
          <WorkPanelHead
            v-else-if="dockPanel === 'subagent'"
            icon="sparkles"
            :title="t('tasks.dockSubagent')"
            :meta="`${subagentRunning} ${t('tasks.running')}`"
          >
            <template #actions>
              <FilterControl v-model="subagentFilter" :options="filterOptions" />
            </template>
          </WorkPanelHead>
          <WorkPanelHead
            v-else-if="dockPanel === 'todos'"
            :icon="allTodosDone ? 'check-list' : 'list'"
            :title="t('tasks.todoProgressTitle')"
            :meta="`${todoDoneCount}/${todos?.length ?? 0}`"
          />
          <WorkPanelHead
            v-else-if="dockPanel === 'goal'"
            icon="target"
            :title="t('status.goalLabel')"
            :meta="goalDuration"
          >
            <template #actions>
              <IconButton
                v-if="goal?.status === 'active'"
                size="sm"
                :label="t('status.goalPause')"
                @click="emit('controlGoal', 'pause')"
              >
                <Icon name="pause" size="sm" />
              </IconButton>
              <IconButton
                v-if="goal?.status === 'paused' || goal?.status === 'blocked'"
                size="sm"
                :label="t('status.goalResume')"
                @click="emit('controlGoal', 'resume')"
              >
                <Icon name="play" size="sm" />
              </IconButton>
              <IconButton size="sm" :label="t('status.goalCancel')" @click="cancelGoal">
                <Icon name="power" size="sm" />
              </IconButton>
              <IconButton size="sm" :label="t('tasks.closePanel')" @click="emit('close-dock-panel')">
                <Icon name="close" size="sm" />
              </IconButton>
            </template>
          </WorkPanelHead>
          <WorkPanelHead
            v-else
            icon="file-edit"
            :title="t('status.planLabel')"
            :meta="latestPlan?.reviewState ? t(`tools.plan.review.${latestPlan.reviewState}`) : ''"
          >
            <template #actions>
              <IconButton
                v-if="latestPlan?.path"
                size="sm"
                :label="t('tasks.openPanel')"
                @click="openFile?.({ path: latestPlan.path!, content: latestPlan.plan })"
              >
                <Icon name="external-link" size="sm" />
              </IconButton>
              <IconButton
                v-if="planArmed || planMode"
                size="sm"
                :label="t('status.workModeDismiss')"
                @click="emit('togglePlan')"
              >
                <Icon name="power" size="sm" />
              </IconButton>
              <IconButton size="sm" :label="t('tasks.closePanel')" @click="emit('close-dock-panel')">
                <Icon name="close" size="sm" />
              </IconButton>
            </template>
          </WorkPanelHead>
        </div>
        <div ref="workBodyRef" class="dock-work-body" @scroll="onScroll">
          <TasksPane
            v-if="dockPanel === 'bash'"
            :tasks="filteredBash"
            :filter="bashFilter"
            @cancel="emit('cancelTask', $event)"
            @open="emit('openAgent', $event)"
          />
          <SubagentGrid
            v-else-if="dockPanel === 'subagent'"
            :tasks="filteredSub"
            :filter="subagentFilter"
            @cancel="emit('cancelTask', $event)"
            @open="emit('openAgent', $event)"
          />
          <TodoCard v-else-if="dockPanel === 'todos'" :todos="todos ?? []" />
          <GoalPanel
            v-else-if="dockPanel === 'goal' && goal"
            :goal="goal"
            :open-file="openFile"
          />
          <PlanPanel v-else :plan="latestPlan" :plan-mode-on="planMode" :open-file="openFile" />
        </div>
      </div>
    </Transition>

    <div v-if="hasDockWork || planMode || latestPlan" class="dock-workbar">
      <WorkPill
        v-if="goal"
        icon="target"
        :active="dockPanel === 'goal'"
        :label="`${t('status.goalLabel')} ${goalStatusText}`"
        @click="togglePanel('goal', $event)"
      >
        {{ t('status.goalLabel') }}
        <template #meta>
          <span :class="['dw-goal-status', `dw-goal-status--${goal.status}`]">{{ goalStatusText }}</span>
        </template>
      </WorkPill>
      <WorkPill
        v-if="planMode || latestPlan"
        icon="file-edit"
        :active="dockPanel === 'plan'"
        :label="t('status.planLabel')"
        @click="togglePanel('plan', $event)"
      >
        {{ t('status.planLabel') }}
      </WorkPill>
      <WorkPill
        v-if="bashTasks.length"
        icon="terminal"
        :active="dockPanel === 'bash'"
        :label="bashTitle"
        @click="togglePanel('bash', $event)"
      >
        {{ bashTitle }}
        <template v-if="bashRunning" #meta>
          <span class="dw-running"><StatusGlyph status="run" />{{ bashRunning }}</span>
        </template>
      </WorkPill>
      <WorkPill
        v-if="subagentTasks.length"
        icon="sparkles"
        :active="dockPanel === 'subagent'"
        :label="t('tasks.dockSubagent')"
        @click="togglePanel('subagent', $event)"
      >
        {{ t('tasks.dockSubagent') }}
        <template v-if="subagentRunning" #meta>
          <span class="dw-running"><StatusGlyph status="run" />{{ subagentRunning }}</span>
        </template>
      </WorkPill>
      <WorkPill
        v-if="todos?.length"
        :icon="allTodosDone ? 'check-list' : 'list'"
        :active="dockPanel === 'todos'"
        :label="t('tasks.todoProgressTitle')"
        @click="togglePanel('todos', $event)"
      >
        {{ t('tasks.todoProgressTitle') }}
        <template #meta>
          <span class="dw-count">{{ todoDoneCount }}/{{ todos?.length }}</span>
        </template>
      </WorkPill>
    </div>

    <QuestionCard
      v-if="pendingQuestion"
      :key="pendingQuestion.questionId"
      :question="pendingQuestion"
      :busy-kind="questionBusyKind"
      @answer="(id, response) => emit('answer', id, response)"
      @dismiss="emit('dismiss', $event)"
    />
    <ApprovalCard
      v-else-if="pendingApproval"
      :key="pendingApproval.approvalId"
      class="dock-approval"
      :block="pendingApproval.block"
      :agent-name="pendingApproval.agentName"
      :busy="approvalBusy"
      @decide="emit('approval', pendingApproval!.approvalId, $event)"
    />
    <Composer
      v-else
      ref="composerRef"
      :session-id="sessionId"
      :running="running"
      :working="working"
      :starting="starting"
      :queued="queued"
      :search-files="searchFiles"
      :upload-image="uploadImage"
      :status="status"
      :thinking="thinking"
      :plan-mode="planMode"
      :plan-armed="planArmed"
      :goal-mode="goalMode"
      :workflow-active="dynamicWorkflowMode"
      :goal="goal"
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
      @toggle-workflow="emit('toggleWorkflow')"
      @toggle-goal="emit('toggleGoal')"
      @open-btw="emit('openBtw')"
      @create-goal="emit('createGoal', $event)"
      @control-goal="emit('controlGoal', $event)"
      @focus-goal="emit('focusGoal')"
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
  position: absolute;
  inset: auto 0 0;
  background: transparent;
  z-index: var(--z-sticky);
}

.chat-dock.has-popup {
  z-index: var(--z-dropdown);
}

.chat-dock.align-center {
  margin-left: auto;
  margin-right: auto;
}

.chat-dock.align-mobile {
  max-width: none;
}

.chat-dock:before {
  --fade: 48px;
  --veil: 72px;
  content: "";
  position: absolute;
  top: calc(-1 * var(--fade));
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--color-bg) 0%, transparent),
    color-mix(in srgb, var(--color-bg) 30%, transparent) 21px,
    color-mix(in srgb, var(--color-bg) 70%, transparent) 45px,
    var(--color-bg) var(--veil)
  );
}

.chat-dock > * {
  position: relative;
  z-index: 1;
}

.dock-work-panel {
  position: absolute;
  left: 16px;
  right: calc(16px + var(--panes-scrollbar-width, 0px));
  bottom: 100%;
  background: var(--color-menu-bg-frost);
  -webkit-backdrop-filter: var(--p-menu-backdrop);
  backdrop-filter: var(--p-menu-backdrop);
  border: .5px solid var(--color-line);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-menu);
  margin-bottom: var(--space-2);
  max-height: min(360px, 50vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

.dock-work-panel.panel-todos .dock-work-head,
.dock-work-panel.panel-goal .dock-work-head,
.dock-work-panel.panel-subagent .dock-work-head,
.dock-work-panel.panel-bash .dock-work-head {
  padding: var(--space-4) var(--space-4) 0;
  border-bottom: none;
}

.dock-work-panel.panel-todos .dock-work-body,
.dock-work-panel.panel-goal .dock-work-body,
.dock-work-panel.panel-subagent .dock-work-body,
.dock-work-panel.panel-bash .dock-work-body {
  margin-top: var(--space-3);
  padding: 0 var(--space-4) var(--space-4);
}

.dock-work-panel.panel-todos .dock-work-head,
.dock-work-panel.panel-goal .dock-work-head,
.dock-work-panel.panel-plan .dock-work-head,
.dock-work-panel.panel-subagent .dock-work-head,
.dock-work-panel.panel-bash .dock-work-head {
  padding: var(--space-4) var(--space-4) 0;
  border-bottom: none;
}

.dock-work-panel.panel-todos .dock-work-body,
.dock-work-panel.panel-goal .dock-work-body,
.dock-work-panel.panel-plan .dock-work-body,
.dock-work-panel.panel-subagent .dock-work-body,
.dock-work-panel.panel-bash .dock-work-body {
  margin-top: var(--space-3);
  padding: 0 var(--space-4) var(--space-4);
}

.dock-work-panel.panel-subagent,
.dock-work-panel.panel-bash {
  height: min(var(--p-dock-panel-h), 50vh);
}

.dock-work-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: .5px solid var(--color-line);
  position: relative;
  z-index: 1;
}

.dock-work-body {
  padding: var(--space-2) var(--space-3);
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

@media (max-width: 480px) {
  .dock-work-head {
    flex-wrap: wrap;
  }
}

.dock-work-panel.body-scrolled-up .dock-work-body {
  mask-image: linear-gradient(to bottom, transparent, black var(--menu-scroll-fade));
}

.dock-work-body .taskspane {
  border: none;
  background: transparent;
  padding: 0;
}

.dock-workbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-1-5);
  padding:
    var(--space-1)
    calc(var(--dock-inline-right) + var(--space-4) + var(--p-hairline))
    var(--space-05)
    calc(var(--dock-inline-left) + var(--space-4) + var(--p-hairline));
}

.dock-workbar .ui-pill {
  position: relative;
  gap: var(--space-1-5);
  height: auto;
  padding: var(--space-2) calc(var(--space-3) + var(--space-05)) var(--space-2) var(--space-3);
  border: none;
  border-radius: var(--radius-lg);
  background: var(--color-selected);
  -webkit-backdrop-filter: var(--p-menu-backdrop);
  backdrop-filter: var(--p-menu-backdrop);
  color: var(--color-text);
  font-size: var(--text-base);
  line-height: var(--leading-normal);
}

.dock-workbar .ui-pill svg {
  width: 1.5em;
  height: 1.5em;
  color: inherit;
}

.dock-workbar .ui-pill:after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: var(--radius-lg);
  background: var(--color-hover);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
  pointer-events: none;
}

.dock-workbar .ui-pill:hover:not(:disabled):after,
.dock-workbar .ui-pill.is-active:after {
  opacity: 1;
}

.chat-dock.pills-compact .dock-workbar .ui-pill {
  padding: var(--space-2);
}

.chat-dock.pills-compact .dock-workbar .ui-pill > span {
  display: none;
}

.dock-workbar .dw-count {
  color: var(--color-text-muted);
}

.dock-workbar .dw-running {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
}

.dock-workbar .dw-goal-status {
  font-weight: var(--weight-medium);
}

.dock-workbar .dw-goal-status--active {
  color: var(--color-success);
}

.dock-workbar .dw-goal-status--paused {
  color: var(--color-warning);
}

.dock-workbar .dw-goal-status--blocked {
  color: var(--color-danger);
}

.dock-approval {
  margin-top: 8px;
}

.chat-dock.has-approval {
  display: flex;
  flex-direction: column;
  max-height: calc(var(--app-height, 100dvh) - 72px);
}

.chat-dock.has-approval > .dock-workbar {
  flex: none;
}

.chat-dock.has-approval > .dock-approval {
  min-height: 0;
}

@media (max-width: 640px) {
  .chat-dock {
    --dock-inline-left: max(12px, var(--safe-left));
    --dock-inline-right: max(12px, var(--safe-right));
  }

  .dock-work-panel {
    left: 10px;
    right: calc(10px + var(--panes-scrollbar-width, 0px));
  }
}

.chat-dock:not(.align-mobile) .composer {
  padding-bottom: 14px;
}

.dock-panel-enter-active {
  transition:
    opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.dock-panel-leave-active {
  transition:
    opacity var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.dock-panel-enter-from,
.dock-panel-leave-to {
  opacity: 0;
  transform: translateY(var(--motion-panel-shift)) scale(var(--motion-panel-scale));
}
</style>
