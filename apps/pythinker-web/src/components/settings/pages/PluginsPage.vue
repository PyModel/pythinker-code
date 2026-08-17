<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AppPlugin } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

defineProps<{ plugins?: AppPlugin[] }>();

const emit = defineEmits<{
  setPluginEnabled: [payload: { pluginId: string; enabled: boolean }];
}>();

const { t } = useI18n();
</script>

<template>
  <section id="settings-panel-plugins" class="panel" role="tabpanel" aria-labelledby="settings-tab-plugins">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.plugins.title') }}</h2>
      <p class="sec-note">{{ t('settings.plugins.note') }}</p>
      <p v-if="(plugins?.length ?? 0) === 0" class="sec-empty">{{ t('settings.plugins.empty') }}</p>
      <div v-else class="listing">
        <ListingRow v-for="plugin in plugins" :key="plugin.id" :name="plugin.displayName" :off="!plugin.enabled">
          <template #glyph>
            <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-3H4a2 2 0 1 1 0-4h1V6a1 1 0 0 1 1-1h4V4z" stroke-linejoin="round" /></svg>
          </template>
          <span v-if="plugin.version" class="tag">{{ plugin.version }}</span>
          <span class="tag">{{ plugin.source }}</span>
          <span class="listing-meta">{{ t('settings.plugins.counts', { skills: plugin.skillCount, servers: plugin.mcpServerCount }) }}</span>
          <template #actions>
            <button type="button" class="switch sm" role="switch" :class="{ on: plugin.enabled }" :aria-checked="plugin.enabled" :aria-label="t('settings.plugins.toggleAria', { name: plugin.displayName })" @click="emit('setPluginEnabled', { pluginId: plugin.id, enabled: !plugin.enabled })"><span class="knob" /></button>
          </template>
          <template v-if="plugin.hasErrors" #detail>
            <p class="listing-error">{{ t('settings.plugins.hasErrors') }}</p>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
