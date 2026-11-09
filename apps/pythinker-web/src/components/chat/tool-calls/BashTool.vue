<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel, toolSummary } from '../../../lib/toolMeta';
import Icon from '../../ui/Icon.vue';
import IconButton from '../../ui/IconButton.vue';
import Tooltip from '../../ui/Tooltip.vue';
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

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
  /** Let this running command finish in the background. */
  detach: [toolCallId: string];
}>();

const { t } = useI18n();
const summary = computed(() => toolSummary(props.tool.name, props.tool.arg, true));
const hasOutput = computed(() => (props.tool.output?.length ?? 0) > 0);
const canExpand = computed(
  () => hasOutput.value || props.tool.status === 'running' || summary.value.length > 0,
);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

// Provided by the conversation pane. `undefined` (no REST task matched yet)
// means "show"; only an explicit false hides the button.
const resolveDetachableTask = inject<((toolCallId: string) => boolean | undefined) | undefined>(
  'resolveDetachableTask',
  undefined,
);
const canDetach = computed(
  () =>
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
    :status="tool.status"
    :icon="toolGlyph(tool.name)"
    :name="toolLabel(tool.name)"
    :arg="!open ? summary : ''"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #trailing>
      <Tooltip v-if="canDetach" :text="t('tasks.toBackground')">
        <IconButton
          class="tl-detach"
          :class="{ touch: mobile }"
          size="sm"
          :label="t('tasks.toBackground')"
          @click.stop="emit('detach', tool.id)"
        >
          <Icon name="pip" size="sm" />
        </IconButton>
      </Tooltip>
      <span v-if="tool.timing" class="chip">{{ tool.timing }}</span>
    </template>
    <div class="bash-command">{{ summary }}</div>
    <ToolOutputBlock
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
/* "To background" — the shared IconButton in the row's trailing slot; on touch
   layouts the hit area grows through an invisible inset, so the collapsed row
   keeps its height (same approach as AgentTool). */
.tl-detach {
  position: relative;
  flex: none;
}
.tl-detach.touch::after {
  content: '';
  position: absolute;
  inset: -9px;
}
.bash-command {
  padding: var(--space-3);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text);
  white-space: pre-wrap;
}
</style>
