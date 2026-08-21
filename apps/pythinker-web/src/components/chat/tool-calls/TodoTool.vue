<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import { toolGlyph, toolLabel, toolSummary } from '../../../lib/toolMeta';
import Icon from '../../ui/Icon.vue';
import ToolRow from '../ToolRow.vue';
import ToolOutputBlock from './ToolOutputBlock.vue';

type TodoStatus = 'done' | 'in_progress' | 'pending';
interface TodoItem {
  title: string;
  status: TodoStatus;
}

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

function parseTodos(value: string): TodoItem[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const todos = (parsed as Record<string, unknown>).todos;
    if (!Array.isArray(todos)) return null;
    return todos.flatMap((todo): TodoItem[] => {
      if (!todo || typeof todo !== 'object' || Array.isArray(todo)) return [];
      const item = todo as Record<string, unknown>;
      const title = item.title ?? item.content ?? item.activeForm ?? item.text;
      if (typeof title !== 'string' || title.length === 0) return [];
      const status = item.status === 'done' || item.status === 'completed'
        ? 'done'
        : item.status === 'in_progress'
          ? 'in_progress'
          : 'pending';
      return [{ title, status }];
    });
  } catch {
    return null;
  }
}

const todos = computed(() => parseTodos(props.tool.arg));
const doneCount = computed(() => todos.value?.filter((item) => item.status === 'done').length ?? 0);
const totalCount = computed(() => todos.value?.length ?? 0);
const ratio = computed(() => (totalCount.value > 0 ? doneCount.value / totalCount.value : 0));
/** The current in-progress item title (reference header dim line). */
const summary = computed(() => {
  const current = todos.value?.find((item) => item.status === 'in_progress');
  return current?.title ?? toolSummary(props.tool.name, props.tool.arg);
});
const canExpand = computed(() => (todos.value?.length ?? 0) > 0 || (props.tool.output?.length ?? 0) > 0);
const open = ref(props.tool.defaultExpanded === true && canExpand.value);

function iconName(status: TodoStatus): 'check' | 'play' | 'minus' {
  if (status === 'done') return 'check';
  if (status === 'in_progress') return 'play';
  return 'minus';
}

function toggle(): void {
  if (canExpand.value) open.value = !open.value;
}

watch(
  () => [props.tool.defaultExpanded, props.tool.output?.length, props.tool.status, props.tool.arg] as const,
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
    :time="tool.timing"
    :open="open"
    :expandable="canExpand"
    :stacked="stackPosition !== 'single'"
    :stack-position="stackPosition"
    @toggle="toggle"
  >
    <template #trailing>
      <template v-if="todos">
        <span class="chip">{{ doneCount }} / {{ totalCount }}</span>
        <span class="todo-bar" aria-hidden="true">
          <span class="todo-fill" :style="{ width: `${ratio * 100}%` }" />
        </span>
      </template>
    </template>
    <div v-if="todos" class="todo-list">
      <div v-for="(item, index) in todos" :key="index" class="todo-row" :data-status="item.status">
        <span class="todo-status" role="img" :aria-label="item.status">
          <Icon :name="iconName(item.status)" size="sm" />
        </span>
        <span>{{ item.title }}</span>
      </div>
    </div>
    <ToolOutputBlock
      v-else
      :lines="tool.output"
      :empty-text="tool.status === 'running' ? t('tools.output.waiting') : t('tools.output.empty')"
    />
  </ToolRow>
</template>

<style scoped>
.todo-bar {
  display: inline-flex;
  width: 36px;
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--color-line);
  overflow: hidden;
  flex: none;
}
.todo-fill {
  background: var(--color-success);
  border-radius: var(--radius-full);
  transition: width var(--duration-slow) var(--ease-out);
}
.todo-list {
  display: grid;
  gap: var(--space-2);
}
.todo-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.todo-status {
  display: inline-flex;
  color: var(--color-text-muted);
}
.todo-row[data-status='done'] {
  color: var(--color-text-muted);
  text-decoration: line-through;
}
.todo-row[data-status='done'] .todo-status {
  color: var(--color-success);
}
.todo-row[data-status='in_progress'] .todo-status {
  color: var(--color-accent);
}
</style>
