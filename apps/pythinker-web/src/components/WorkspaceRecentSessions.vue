<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Session } from '../types';

const props = defineProps<{ sessions: Session[] }>();
const emit = defineEmits<{ select: [id: string] }>();
const { t } = useI18n();
const expanded = ref(false);
const visibleSessions = computed(() => expanded.value ? props.sessions : props.sessions.slice(0, 8));
</script>

<template>
  <section v-if="sessions.length" class="recent">
    <h2>{{ t('sessions.recentSessions') }}</h2>
    <button
      v-for="session in visibleSessions"
      :key="session.id"
      type="button"
      class="recent-row"
      @click="emit('select', session.id)"
    >
      <span class="recent-title">{{ session.title }}</span>
      <span class="recent-time">{{ session.time }}</span>
    </button>
    <button
      v-if="!expanded && sessions.length > 8"
      type="button"
      class="recent-more"
      @click="expanded = true"
    >
      {{ t('sessions.viewMoreSessions') }}
    </button>
  </section>
</template>

<style scoped>
.recent {
  width: min(560px, 100%);
  margin-top: var(--space-6);
}
.recent h2 {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
}
.recent-row {
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.recent-row:hover { background: var(--color-hover); }
.recent-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-time {
  flex: none;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}
.recent-more {
  margin-top: var(--space-2);
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
</style>
