<!-- apps/pythinker-web/src/components/chat/tool-calls/WaitForTool.vue -->
<!-- WaitFor card: a wait on a background task. The collapsed row carries a
     status summary (waiting / finished / timed out), the trailing chip shows
     the waited duration, and the expanded body renders a `.wf-glance` summary
     of the finished task plus any tasks that finished during the wait or are
     still running — with the raw output below. A timeout is not an error (the
     tool says so itself), so it renders in the warning tone. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel } from '../../../lib/toolMeta';
import ToolRow from '../ToolRow.vue';
import ToolOutputBlock from './ToolOutputBlock.vue';
import { parseWaitForOutput, type WaitForView } from './waitForToolParse';

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

const STATUS_KEYS: Record<string, string> = {
  completed: 'tools.waitfor.status.completed',
  failed: 'tools.waitfor.status.failed',
  timed_out: 'tools.waitfor.status.timed_out',
  killed: 'tools.waitfor.status.killed',
  lost: 'tools.waitfor.status.lost',
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseArg(arg: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(arg);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const status = computed<'running' | 'ok' | 'error'>(() => props.tool.status as 'running' | 'ok' | 'error');
const label = computed(() => toolLabel(props.tool.name));
const glyph = computed(() => toolGlyph(props.tool.name));

const arg = computed(() => parseArg(props.tool.arg));
const taskId = computed(() => str(arg.value?.task_id) ?? str(arg.value?.taskId));

const result = computed<WaitForView | undefined>(() =>
  props.tool.status === 'error' ? undefined : parseWaitForOutput(props.tool.output),
);

/** Finished-task status label: 'completed' / 'failed' / 'timed out' / … */
const finishedLabel = computed(() => {
  const raw = result.value?.finishedStatus;
  if (!raw) return '';
  const key = STATUS_KEYS[raw];
  return key ? t(key) : raw;
});

type Variant = 'success' | 'danger' | 'warning' | 'neutral';
const statusVariant = computed<Variant>(() => {
  switch (result.value?.finishedStatus) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'lost':
      return 'danger';
    case 'timed_out':
    case 'killed':
      return 'warning';
    default:
      return 'neutral';
  }
});

/** First non-empty output line — the raw fallback for error / unparsed output. */
const firstOutputLine = computed(() => props.tool.output?.find((line) => line.trim().length > 0) ?? '');

/** Collapsed-row summary line next to the tool name. */
const summaryLine = computed(() => {
  if (props.tool.status === 'running') {
    return taskId.value
      ? t('tools.waitfor.waitingTask', { id: taskId.value })
      : t('tools.waitfor.waitingAny');
  }
  if (props.tool.status === 'error') return firstOutputLine.value;
  const view = result.value;
  if (!view) return taskId.value ?? firstOutputLine.value;
  switch (view.status) {
    case 'completed':
      return view.finishedDescription ?? view.taskId ?? '';
    case 'timed_out':
      return view.runningCount > 0
        ? t('tools.waitfor.stillRunning', { count: view.runningCount })
        : t('tools.waitfor.timedOut');
    case 'no_tasks':
      return t('tools.waitfor.noTasks');
  }
});

/** Compact waited-duration chip, e.g. `5s` / `1m30s` / `1h5m` (mirrors the
    reference formatter; no chip when nothing was waited). */
function formatWaited(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = t('status.timeUnitHour');
  const m = t('status.timeUnitMinute');
  const s = t('status.timeUnitSecond');
  if (total < 60) return total === 0 ? '' : `${total}${s}`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest === 0 ? `${minutes}${m}` : `${minutes}${m}${rest}${s}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}${h}` : `${hours}${h}${rest}${m}`;
}

const waitedText = computed(() => {
  const view = result.value;
  if (!view || view.status === 'no_tasks') return '';
  return formatWaited(view.waitedMs);
});
const timeText = computed(() => waitedText.value || props.tool.timing || '');

/** Expanded-body `.wf-glance`: main line + subordinate lines. */
interface Glance {
  main: string;
  subs: string[];
}

function runningSamplesLine(view: WaitForView): string | null {
  if (view.runningSamples.length === 0) return null;
  const samples = [...view.runningSamples];
  const remaining = view.runningCount - view.runningSamples.length;
  if (remaining > 0) samples.push(t('tools.waitfor.moreRunning', { count: remaining }));
  return samples.join(', ');
}

const glance = computed<Glance | null>(() => {
  const view = result.value;
  if (!view) return null;
  if (view.status === 'completed') {
    const main = [view.taskId, finishedLabel.value].filter(Boolean).join(' · ');
    const parts: string[] = [];
    if (view.finishedDescription) parts.push(view.finishedDescription);
    const extras: string[] = [];
    if (view.extraCount > 0) extras.push(t('tools.waitfor.moreFinished', { count: view.extraCount }));
    if (view.runningCount > 0) extras.push(t('tools.waitfor.stillRunning', { count: view.runningCount }));
    if (extras.length > 0) parts.push(extras.join(' · '));
    const sample = runningSamplesLine(view);
    if (sample !== null) parts.push(sample);
    return { main, subs: parts };
  }
  if (view.status === 'timed_out') {
    if (view.runningCount === 0 && view.extraCount === 0) return null;
    const extras: string[] = [];
    if (view.runningCount > 0 && view.extraCount > 0) {
      extras.push(t('tools.waitfor.moreFinished', { count: view.extraCount }));
    }
    const sample = runningSamplesLine(view);
    if (sample !== null) extras.push(sample);
    return {
      main:
        view.runningCount > 0
          ? t('tools.waitfor.stillRunning', { count: view.runningCount })
          : t('tools.waitfor.moreFinished', { count: view.extraCount }),
      subs: extras,
    };
  }
  return null;
});

const hasOutput = computed(() => !!props.tool.output && props.tool.output.length > 0);
const canExpand = computed(() => glance.value !== null || hasOutput.value);
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
    :status="status"
    :icon="glyph"
    :name="label"
    :arg="!open ? summaryLine : ''"
    :time="timeText"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #trailing>
      <span
        v-if="result?.status === 'timed_out'"
        class="chip wf-status warning"
      >{{ t('tools.waitfor.timedOut') }}</span>
      <span
        v-else-if="result?.status === 'completed' && finishedLabel"
        class="chip wf-status"
        :class="statusVariant"
      >{{ finishedLabel }}</span>
    </template>
    <div v-if="glance" class="wf-glance">
      <div class="wf-main">{{ glance.main }}</div>
      <div v-for="sub in glance.subs" :key="sub" class="wf-sub">{{ sub }}</div>
    </div>
    <ToolOutputBlock
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.wf-glance {
  margin-bottom: var(--space-1);
}
.wf-main {
  color: var(--color-text);
  font-size: var(--text-sm);
  line-height: var(--leading-prose);
  white-space: pre-wrap;
  word-break: break-word;
}
.wf-sub {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-prose);
  white-space: pre-wrap;
  word-break: break-word;
}
.wf-status.success {
  color: var(--color-success);
}
.wf-status.danger {
  color: var(--color-danger);
}
.wf-status.warning {
  color: var(--color-warning);
}
</style>