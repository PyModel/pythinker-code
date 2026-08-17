<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AppConnector } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

defineProps<{
  connectors?: AppConnector[];
  connectorsLoading?: boolean;
}>();

const emit = defineEmits<{
  restartConnector: [connectorId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <section id="settings-panel-connectors" class="panel" role="tabpanel" aria-labelledby="settings-tab-connectors">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.connectors.title') }}</h2>
      <p class="sec-note">{{ t('settings.connectors.note') }}</p>
      <p v-if="connectorsLoading" class="sec-empty">{{ t('settings.connectors.loading') }}</p>
      <p v-else-if="(connectors?.length ?? 0) === 0" class="sec-empty">{{ t('settings.connectors.empty') }}</p>
      <div v-else class="listing">
        <ListingRow v-for="connector in connectors" :key="connector.id" :name="connector.name">
          <template #glyph>
            <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" stroke-linecap="round" /></svg>
          </template>
          <span class="tag">{{ connector.transport }}</span>
          <span class="listing-desc">{{ t(`settings.connectors.status.${connector.status}`) }}</span>
          <span class="listing-meta">{{ t('settings.connectors.tools', { count: connector.toolCount }) }}</span>
          <template #actions>
            <span class="dot" :class="`s-${connector.status}`" aria-hidden="true" />
            <button type="button" class="icon-btn" :title="t('settings.connectors.restart')" :aria-label="t('settings.connectors.restart')" @click="emit('restartConnector', connector.id)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          </template>
          <template v-if="connector.lastError" #detail>
            <p class="listing-error">{{ connector.lastError }}</p>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
