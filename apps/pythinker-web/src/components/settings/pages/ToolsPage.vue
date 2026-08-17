<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppTool } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

const props = defineProps<{
  tools?: AppTool[];
  toolsLoading?: boolean;
  enabledTools?: string[];
  sessionId?: string;
}>();

const emit = defineEmits<{
  setTools: [names: string[]];
}>();

const { t } = useI18n();
const toolList = computed(() => props.tools ?? []);
const enabledToolNames = computed(() => props.enabledTools ?? toolList.value.map((tool) => tool.name));

function isToolEnabled(name: string): boolean {
  return enabledToolNames.value.includes(name);
}

function setToolEnabled(name: string, enabled: boolean): void {
  const next = new Set(enabledToolNames.value);
  if (enabled) next.add(name);
  else next.delete(name);
  emit('setTools', [...next]);
}

function enableAll(): void {
  emit('setTools', toolList.value.map((tool) => tool.name));
}
</script>

<template>
  <section id="settings-panel-tools" class="panel" role="tabpanel" aria-labelledby="settings-tab-tools">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.tools.title') }}</h2>
      <p class="sec-note">{{ t('settings.tools.note') }}</p>
      <p v-if="!props.sessionId" class="sec-empty">{{ t('settings.tools.noSession') }}</p>
      <p v-else-if="props.toolsLoading" class="sec-empty">{{ t('settings.tools.loading') }}</p>
      <p v-else-if="toolList.length === 0" class="sec-empty">{{ t('settings.tools.empty') }}</p>
      <template v-else>
        <div class="listing">
          <ListingRow v-for="tool in toolList" :key="tool.name" :name="tool.name" mono :off="!isToolEnabled(tool.name)">
            <template #glyph>
              <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 4h8M6 8h12v11H6zM9 12h6M9 15h4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </template>
            <template #actions>
              <button type="button" class="switch sm" role="switch" :class="{ on: isToolEnabled(tool.name) }" :aria-checked="isToolEnabled(tool.name)" :aria-label="t('settings.tools.toggleAria', { name: tool.name })" @click="setToolEnabled(tool.name, !isToolEnabled(tool.name))"><span class="knob" /></button>
            </template>
          </ListingRow>
        </div>
        <div class="actions">
          <button type="button" class="act" @click="enableAll">{{ t('settings.tools.enableAll') }}</button>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
