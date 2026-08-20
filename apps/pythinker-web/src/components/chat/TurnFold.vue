<script setup lang="ts">
import { shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolMedia } from '../../types';
import type { AssistantRenderBlock } from '../chatTurnRendering';
import { formatDuration, renderBlockKey } from '../chatTurnRendering';
import Icon from '../ui/Icon.vue';
import Markdown from './Markdown.vue';
import ThinkingBlock from './ThinkingBlock.vue';
import ToolCall from './ToolCall.vue';
import ToolGroup from './ToolGroup.vue';

const { items, streaming, durationMs, toolDiffPanel = false } = defineProps<{
  items: AssistantRenderBlock[];
  streaming: boolean;
  durationMs?: number;
  toolDiffPanel?: boolean;
}>();

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
  openAgent: [toolCallId: string];
  openThinking: [blockIndex: number];
}>();

const { t } = useI18n();
const open = shallowRef(false);
</script>

<template>
  <div v-if="items.length > 0" class="turn-fold" :class="{ open: open || streaming, streaming }">
    <button
      v-if="!streaming"
      type="button"
      class="tf-head"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Icon class="tf-car" name="chevron-right" size="sm" />
      <span class="tf-sum">
        {{ durationMs === undefined ? t('conversation.fold.workedUnknown') : t('conversation.fold.worked', { duration: formatDuration(durationMs) }) }}
      </span>
    </button>
    <div class="tf-body" :class="{ open: open || streaming }">
      <div class="tf-body-inner">
        <template v-for="(block, index) in items" :key="renderBlockKey(block, index)">
          <ThinkingBlock
            v-if="block.kind === 'thinking'"
            :text="block.thinking"
            mobile
            :streaming="streaming"
            @open="emit('openThinking', block.sourceIndex)"
          />
          <div v-else-if="block.kind === 'text' && block.text" class="msg">
            <Markdown
              :text="block.text"
              :streaming="streaming"
              :open-file="(target) => emit('openFile', target)"
            />
          </div>
          <ToolGroup
            v-else-if="block.kind === 'tool-stack'"
            :tools="block.tools"
            mobile
            :tool-diff-panel="toolDiffPanel"
            @open-media="emit('openMedia', $event)"
            @open-file="emit('openFile', $event)"
            @open-tool-diff="emit('openToolDiff', $event)"
            @open-agent="emit('openAgent', $event)"
          />
          <ToolCall
            v-else-if="block.kind === 'tool'"
            :tool="block.tool"
            mobile
            :tool-diff-panel="toolDiffPanel"
            @open-media="emit('openMedia', $event)"
            @open-file="emit('openFile', $event)"
            @open-tool-diff="emit('openToolDiff', $event)"
            @open-agent="emit('openAgent', $event)"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turn-fold { display: flex; flex-direction: column; }
.tf-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2) 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-faint);
  font: var(--text-sm)/1 var(--font-ui);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-base) var(--ease-out);
}
.tf-head:hover { color: var(--color-text); }
.tf-head:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-accent-soft); }
.tf-sum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-car { flex: none; transition: transform var(--duration-base) var(--ease-out); }
.turn-fold.open .tf-car { transform: rotate(90deg); }
.tf-body {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  transition: grid-template-rows var(--duration-base) var(--ease-out);
}
.tf-body.open { grid-template-rows: minmax(0, 1fr); }
.tf-body-inner { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.tf-body-inner > .msg,
.tf-body-inner > :deep(.think),
.tf-body-inner > :deep(.tool-group),
.tf-body-inner > :deep(.agent-card),
.tf-body-inner > :deep(.agent-group),
.tf-body-inner > :deep(.box),
.tf-body-inner > :deep(.dynamic-workflow-card),
.tf-body-inner > :deep(.media-tool) { margin-top: var(--chat-block-gap); }
.tf-body-inner .msg { font-size: var(--ui-font-size); line-height: 1.6; color: var(--color-text); font-weight: var(--weight-medium); }
.tf-body-inner .msg :deep(p) { margin: 0; }
.tf-body-inner .msg :deep(p + p) { margin-top: var(--space-2); }
</style>
