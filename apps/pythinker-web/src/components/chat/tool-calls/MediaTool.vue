<!-- apps/pythinker-web/src/components/chat/tool-calls/MediaTool.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCall, ToolMedia } from '../../../types';
import Icon from '../../ui/Icon.vue';
import Tooltip from '../../ui/Tooltip.vue';

const props = withDefaults(defineProps<{ tool: ToolCall; mobile?: boolean }>(), { mobile: false });
const emit = defineEmits<{ openMedia: [media: ToolMedia] }>();

const media = computed(() => (props.tool.status === 'ok' ? props.tool.media : undefined));

function basename(path: string): string {
  return path.split(/[\\/]+/).pop() || path;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const mediaTitle = computed(() => {
  const m = media.value;
  if (!m) return '';
  const parts = [m.path ? basename(m.path) : props.tool.name];
  if (m.mimeType) parts.push(m.mimeType);
  if (m.bytes !== undefined) parts.push(formatBytes(m.bytes));
  if (m.dimensions) parts.push(m.dimensions);
  return parts.join(' · ');
});

function openMediaPreview(): void {
  const m = media.value;
  if (m?.kind === 'image' || m?.kind === 'video') emit('openMedia', m);
}
</script>

<template>
  <div v-if="media" class="media-tool" :class="{ mob: mobile }">
    <Tooltip :text="media.path || mediaTitle">
      <div class="media-title">{{ mediaTitle }}</div>
    </Tooltip>
    <Tooltip v-if="media.kind === 'image'" :text="media.path || mediaTitle">
      <button
        type="button"
        class="media-image-button"
        @click="openMediaPreview"
      >
        <img
          class="media-image"
          :src="media.url"
          :alt="media.path ? basename(media.path) : mediaTitle"
          loading="lazy"
        />
      </button>
    </Tooltip>
    <Tooltip v-if="media.kind === 'video'" :text="media.path || mediaTitle">
      <button
        type="button"
        class="media-image-button media-video-button"
        :aria-label="media.path ? basename(media.path) : mediaTitle"
        @click="openMediaPreview"
      >
        <span class="media-video-tile" aria-hidden="true" />
        <span class="media-play-badge" aria-hidden="true">
          <Icon name="play" size="sm" />
        </span>
      </button>
    </Tooltip>
    <audio v-else class="media-audio" :src="media.url" controls />
  </div>
</template>

<style scoped>
.media-tool {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  max-width: 320px;
}
.media-title {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.media-image-button {
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-md);
  overflow: hidden;
}
.media-video-button {
  position: relative;
  display: block;
}
.media-video-tile {
  display: block;
  width: 320px;
  max-width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--color-well);
}
.media-play-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
  border: 0.5px solid var(--color-line);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.media-image {
  display: block;
  max-width: 100%;
  border-radius: var(--radius-md);
  background: var(--media-alpha-canvas);
}
.media-audio {
  max-width: 100%;
  border-radius: var(--radius-md);
}
</style>
