<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Session } from '../types';
import Icon from './ui/Icon.vue';
import Tooltip from './ui/Tooltip.vue';

const { sessions } = defineProps<{ sessions: Session[] }>();
const emit = defineEmits<{
  select: [id: string];
  openSessionAdmin: [];
}>();
const { t } = useI18n();
</script>

<template>
  <section v-if="sessions.length" class="recent">
    <h2 class="recent-caption">{{ t('sessions.recentSessions') }}</h2>
    <button
      v-for="session in sessions"
      :key="session.id"
      type="button"
      class="recent-row"
      @click="emit('select', session.id)"
    >
      <span class="recent-ico" :class="session.archived ? 'recent-ico--done' : 'recent-ico--open'">
        <Icon :name="session.archived ? 'circle-check' : 'circle-dashed'" size="sm" />
      </span>
      <span class="recent-title">{{ session.title }}</span>
      <span class="recent-time">{{ session.time }}</span>
    </button>
    <div class="recent-foot">
      <Tooltip :text="t('conversation.sessionAdminTooltip')">
        <button type="button" class="recent-more" @click="emit('openSessionAdmin')">
          {{ t('conversation.viewMoreSessions') }}
          <Icon name="chevron-down" size="sm" />
        </button>
      </Tooltip>
    </div>
  </section>
</template>

<style scoped>
.recent {
  flex: none;
  display: flex;
  flex-direction: column;
  margin: var(--space-4) var(--dock-inline-right, 16px) 0 var(--dock-inline-left, 16px);
}
.recent-caption {
  margin: 0;
  padding: 0 var(--space-2) var(--space-1);
  color: var(--color-text-faint);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-section-label);
  text-transform: uppercase;
  user-select: none;
}
.recent-row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
}
.recent-row:hover { background: var(--color-hover); }
.recent-row:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.recent-ico { display: inline-flex; flex: none; }
.recent-ico--open { color: var(--color-success); }
.recent-ico--done { color: var(--color-done); }
.recent-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: var(--ui-font-size-sm);
  font-weight: var(--weight-caption);
  line-height: var(--leading-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-time {
  flex: none;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.recent-foot {
  display: flex;
  justify-content: center;
  margin-top: var(--space-2);
}
.recent-more {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.recent-more:hover { background: var(--color-hover); color: var(--color-text); }
.recent-more:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.recent-more svg { color: var(--color-text-faint); }
</style>
