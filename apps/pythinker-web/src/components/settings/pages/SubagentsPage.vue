<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AppSubagent } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

defineProps<{ subagents?: AppSubagent[] }>();

const { t } = useI18n();
</script>

<template>
  <section id="settings-panel-subagents" class="panel" role="tabpanel" aria-labelledby="settings-tab-subagents">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.subagents.title') }}</h2>
      <p class="sec-note">{{ t('settings.subagents.note') }}</p>
      <p v-if="(subagents?.length ?? 0) === 0" class="sec-empty">{{ t('settings.subagents.empty') }}</p>
      <div v-else class="listing">
        <ListingRow v-for="agent in subagents" :key="agent.name" :name="agent.name" mono>
          <template #glyph>
            <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01" stroke-linecap="round" /></svg>
          </template>
          <span class="tag">{{ agent.source }}</span>
          <span class="tag">{{ t('settings.subagents.tools', { count: agent.tools.length }) }}</span>
          <span v-if="agent.effort" class="tag">{{ agent.effort }}</span>
          <span v-if="agent.model" class="listing-meta">{{ agent.model }}</span>
          <template v-if="agent.description" #detail>
            <p class="listing-desc listing-indent">{{ agent.description }}</p>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
