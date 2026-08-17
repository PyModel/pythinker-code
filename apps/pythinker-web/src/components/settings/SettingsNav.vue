<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { tabGroups, type SettingsTab } from '../../composables/useSettingsNav';

defineProps<{ activeTab: SettingsTab }>();

const emit = defineEmits<{
  select: [tab: SettingsTab];
}>();

const { t } = useI18n();
</script>

<template>
  <nav class="settings-tabs" role="tablist" :aria-label="t('settings.title')">
    <template v-for="group in tabGroups" :key="group.titleKey">
      <span class="tab-group">{{ t(group.titleKey) }}</span>
      <button
        v-for="tab in group.tabs"
        :id="`settings-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        class="tab"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`settings-panel-${tab.id}`"
        :class="{ on: activeTab === tab.id }"
        @click="emit('select', tab.id)"
      >
        {{ t(tab.labelKey) }}
      </button>
    </template>
  </nav>
</template>

<style scoped>
.settings-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  padding: 2px 8px 10px;
  overflow-y: auto;
}
.tab {
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-family: var(--sans);
  font-size: calc(var(--ui-font-size) - 0.5px);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.tab:hover { background: var(--soft); color: var(--ink); }
.tab.on { background: var(--soft); color: var(--blue2); font-weight: 600; }
.tab-group {
  padding: 12px 10px 4px;
  color: var(--faint);
  font-size: calc(var(--ui-font-size) - 3px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
