<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Session } from '../types';
import SessionRow from './SessionRow.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';

const props = defineProps<{
  sessions: Session[];
  activeId: string;
  collapsed: boolean;
  pendingBySession: Record<string, { approvals: number; questions: number }>;
  unreadBySession: Record<string, boolean>;
}>();

const emit = defineEmits<{
  select: [id: string];
  rename: [id: string, title: string];
  generateTitle: [id: string, onTitle: (title: string | null) => void];
  archive: [id: string];
  fork: [id: string];
  export: [id: string];
  pin: [id: string];
  setEmoji: [id: string, emoji: string | null];
  reorder: [ids: string[]];
  toggleCollapsed: [];
}>();

const { t } = useI18n();
const draggingId = ref<string | null>(null);

function dragStart(id: string, event: DragEvent): void {
  draggingId.value = id;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', id);
}

function drop(targetId: string, event: DragEvent): void {
  event.preventDefault();
  const sourceId = draggingId.value ?? event.dataTransfer?.getData('text/plain');
  draggingId.value = null;
  if (!sourceId || sourceId === targetId) return;
  const ids = props.sessions.map((session) => session.id);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  ids.splice(sourceIndex, 1);
  ids.splice(targetIndex, 0, sourceId);
  emit('reorder', ids);
}
</script>

<template>
  <section v-if="sessions.length" class="pinned">
    <header class="pinned-header">
      <span>{{ t('sidebar.pinned') }}</span>
      <IconButton
        size="sm"
        :label="collapsed ? t('sidebar.expandPinned') : t('sidebar.collapsePinned')"
        @click.stop="emit('toggleCollapsed')"
      >
        <Icon :name="collapsed ? 'chevron-right' : 'chevron-down'" />
      </IconButton>
    </header>
    <div v-if="!collapsed">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="pin-row"
        :class="{ dragging: draggingId === session.id }"
        draggable="true"
        @dragstart="dragStart(session.id, $event)"
        @dragend="draggingId = null"
        @dragover.prevent
        @drop="drop(session.id, $event)"
      >
        <SessionRow
          :session="session"
          :active="session.id === activeId"
          :pinned="true"
          :approval-count="pendingBySession[session.id]?.approvals ?? 0"
          :question-count="pendingBySession[session.id]?.questions ?? 0"
          :unread="unreadBySession[session.id] ?? false"
          @select="emit('select', $event)"
          @rename="(id, title) => emit('rename', id, title)"
          @generate-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
          @archive="emit('archive', $event)"
          @fork="emit('fork', $event)"
          @export="emit('export', $event)"
          @pin="emit('pin', $event)"
          @set-emoji="(id, emoji) => emit('setEmoji', id, emoji)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.pinned {
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-line);
}
.pinned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) var(--sb-inset);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}
.pin-row.dragging { opacity: 0.45; }
</style>
