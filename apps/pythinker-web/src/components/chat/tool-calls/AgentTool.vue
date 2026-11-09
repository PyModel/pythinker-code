<!-- apps/pythinker-web/src/components/chat/tool-calls/AgentTool.vue -->
<!-- The single-subagent `Agent` tool, rendered as a normal tool card: the fixed
     args (description / prompt) and final result show here when expanded, while
     the subagent's LIVE progress streams in the right-side detail panel. The
     trailing "Open" button jumps to that panel. -->
<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel } from '../../../lib/toolMeta';
import Icon from '../../ui/Icon.vue';
import IconButton from '../../ui/IconButton.vue';
import Tooltip from '../../ui/Tooltip.vue';
import ToolRow from '../ToolRow.vue';

const { t } = useI18n();

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
  /** Open this subagent's live progress in the right-side detail panel. */
  openAgent: [toolCallId: string];
  /** Let this foreground subagent finish in the background. */
  detach: [toolCallId: string];
}>();

interface AgentInput {
  description?: string;
  subagentType?: string;
  prompt?: string;
  runInBackground?: boolean;
}

function parseAgentInput(arg: string): AgentInput {
  if (!arg) return {};
  try {
    const obj = JSON.parse(arg) as Record<string, unknown>;
    return {
      description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
      subagentType: typeof obj['subagent_type'] === 'string' ? obj['subagent_type'] : undefined,
      prompt: typeof obj['prompt'] === 'string' ? obj['prompt'] : undefined,
      runInBackground: obj['run_in_background'] === true,
    };
  } catch {
    return {};
  }
}

const input = computed(() => parseAgentInput(props.tool.arg));
const hasOutput = computed(() => !!props.tool.output && props.tool.output.length > 0);
const canExpand = computed(
  () => Boolean(input.value.prompt) || Boolean(input.value.subagentType) || hasOutput.value,
);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

const status = computed<'running' | 'ok' | 'error'>(() => props.tool.status as 'running' | 'ok' | 'error');
const statusLabel = computed(() => t(`tools.agent.status.${props.tool.status}`));
const label = computed(() => toolLabel(props.tool.name));
const glyph = computed(() => toolGlyph(props.tool.name));
const summary = computed(() => input.value.description || input.value.subagentType || '');
const runModeLabel = computed(() =>
  input.value.runInBackground ? t('tools.agent.background') : t('tools.agent.foreground'),
);
const resolveAgentModel = inject<
  (toolCallId: string) => { display?: string; effort?: string } | undefined
>('resolveAgentModel');
const runMetadata = computed(() => {
  const resolved = resolveAgentModel?.(props.tool.id);
  return [runModeLabel.value, resolved?.display, resolved?.effort]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
});

// Hide the "Open detail" button when no live/background subagent task matches
// this tool call (e.g. a completed foreground subagent after a page refresh) —
// otherwise the button emits into a panel that silently no-ops.
const resolveAgentTaskId = inject<(toolCallId: string) => string | undefined>('resolveAgentTaskId');
const canOpenAgent = computed(() => {
  if (!resolveAgentTaskId) return true;
  return resolveAgentTaskId(props.tool.id) !== undefined;
});

// Provided by the conversation pane. `undefined` (no REST task matched yet)
// means "show"; only an explicit false hides the button. A subagent that was
// already spawned in the background has nothing to detach.
const resolveDetachableTask = inject<((toolCallId: string) => boolean | undefined) | undefined>(
  'resolveDetachableTask',
  undefined,
);
const canDetach = computed(
  () =>
    input.value.runInBackground !== true &&
    props.tool.status === 'running' &&
    resolveDetachableTask !== undefined &&
    resolveDetachableTask(props.tool.id) !== false,
);

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
    :status-label="statusLabel"
    :icon="glyph"
    :name="label"
    :arg="!open ? summary : ''"
    :time="tool.timing"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #meta>
      <span class="chip">{{ runMetadata }}</span>
    </template>
    <template #trailing>
      <Tooltip v-if="canDetach" :text="t('tasks.toBackground')">
        <IconButton
          class="detach"
          :class="{ touch: mobile }"
          size="sm"
          :label="t('tasks.toBackground')"
          @click.stop="emit('detach', tool.id)"
        >
          <Icon name="pip" size="sm" />
        </IconButton>
      </Tooltip>
      <button v-if="canOpenAgent" type="button" class="at-open" @click.stop="emit('openAgent', tool.id)">
        {{ t('tasks.openDetail') }}
      </button>
    </template>
    <div v-if="input.subagentType" class="at-type">{{ input.subagentType }}</div>
    <div v-if="input.prompt" class="at-task">{{ input.prompt }}</div>
    <div v-if="hasOutput" class="bb-code">
      <div v-for="(line, i) in tool.output ?? []" :key="i">{{ line }}</div>
    </div>
  </ToolRow>
</template>

<style scoped>
/* "To background" — sits before the Open button; on touch layouts an invisible
   inset grows the hit area to 44px without changing the row's height. */
.detach {
  position: relative;
  flex: none;
  margin-right: var(--space-1);
}
.detach.touch::after {
  content: '';
  position: absolute;
  inset: -9px;
}
.at-open {
  flex: none;
  background: none;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xs);
  color: var(--color-text-muted);
  font: var(--text-xs) var(--font-ui);
  padding: 1px 7px;
  cursor: pointer;
}
.at-open:hover {
  color: var(--color-text);
  background: var(--color-surface-sunken);
}
.at-type {
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-muted);
  margin-bottom: 6px;
}
.at-task {
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.at-task + .bb-code {
  margin-top: 10px;
}
.bb-code {
  padding: 11px 13px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
}
</style>
