<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppSession } from '../../../api/types';
import { formatTokens } from '../../../lib/formatTokens';
import ListingRow from '../ListingRow.vue';

const props = defineProps<{ sessions?: AppSession[] }>();

const { t } = useI18n();

const usageStats = computed(() => {
  const sessions = props.sessions ?? [];
  let tokens = 0;
  let turns = 0;
  let cost = 0;
  for (const session of sessions) {
    tokens += session.usage.inputTokens + session.usage.outputTokens;
    turns += session.usage.turnCount;
    cost += session.usage.totalCostUsd;
  }
  return {
    tokens: formatTokens(tokens),
    sessions: String(sessions.length),
    turns: String(turns),
    cost: `$${cost.toFixed(2)}`,
  };
});

const usageByModel = computed(() => {
  const byModel = new Map<string, number>();
  let total = 0;
  for (const session of props.sessions ?? []) {
    const used = session.usage.inputTokens + session.usage.outputTokens;
    if (used === 0 || session.model === '') continue;
    byModel.set(session.model, (byModel.get(session.model) ?? 0) + used);
    total += used;
  }
  if (total === 0) return [];
  return [...byModel.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([model, used]) => ({ model, share: `${Math.round((used / total) * 100)}%` }));
});
</script>

<template>
  <section id="settings-panel-usage" class="panel" role="tabpanel" aria-labelledby="settings-tab-usage">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.usage.title') }}</h2>
      <p class="sec-note">{{ t('settings.usage.note') }}</p>
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-label">{{ t('settings.usage.tokens') }}</span><span class="stat-value">{{ usageStats.tokens }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('settings.usage.sessions') }}</span><span class="stat-value">{{ usageStats.sessions }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('settings.usage.turns') }}</span><span class="stat-value">{{ usageStats.turns }}</span></div>
        <div class="stat-card"><span class="stat-label">{{ t('settings.usage.cost') }}</span><span class="stat-value">{{ usageStats.cost }}</span></div>
      </div>
      <h4 class="listing-head">{{ t('settings.usage.byModel') }}</h4>
      <p v-if="usageByModel.length === 0" class="sec-empty">{{ t('settings.usage.empty') }}</p>
      <div v-else class="listing">
        <ListingRow v-for="entry in usageByModel" :key="entry.model" :name="entry.model">
          <span class="listing-meta">{{ entry.share }}</span>
          <template #detail>
            <div class="usage-bar"><span :style="{ width: entry.share }" /></div>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
