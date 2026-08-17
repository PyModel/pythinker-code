<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppConfig, AppHook } from '../../../api/types';
import ListingRow from '../ListingRow.vue';

const props = defineProps<{ config?: AppConfig | null }>();

const { t } = useI18n();

const hookGroups = computed(() => {
  const byEvent = new Map<string, AppHook[]>();
  for (const hook of props.config?.hooks ?? []) {
    const group = byEvent.get(hook.event) ?? [];
    group.push(hook);
    byEvent.set(hook.event, group);
  }
  return [...byEvent.entries()].map(([event, hooks]) => ({ event, hooks }));
});

const hookCount = computed(() => props.config?.hooks?.length ?? 0);
</script>

<template>
  <section id="settings-panel-hooks" class="panel" role="tabpanel" aria-labelledby="settings-tab-hooks">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.hooks.title') }}</h2>
      <p class="sec-note">{{ t('settings.hooks.note') }}</p>
      <p v-if="hookCount === 0" class="sec-empty">{{ t('settings.hooks.empty') }}</p>
      <template v-else>
        <p class="listing-count">{{ t('settings.hooks.count', { count: hookCount }) }}</p>
        <div v-for="group in hookGroups" :key="group.event" class="listing">
          <h4 class="listing-head">{{ group.event }}</h4>
          <ListingRow v-for="(hook, index) in group.hooks" :key="`${group.event}/${index}`" :name="hook.matcher ?? '*'" mono>
            <template #glyph>
              <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13 3L5 14h6l-2 7 8-11h-6l2-7z" stroke-linejoin="round" /></svg>
            </template>
            <span class="tag">{{ hook.type ?? 'command' }}</span>
            <span v-if="hook.async === true" class="tag">{{ t('settings.hooks.async') }}</span>
            <span v-if="hook.timeout !== undefined" class="listing-meta">{{ t('settings.hooks.timeout', { seconds: hook.timeout }) }}</span>
            <template #detail>
              <p class="listing-path mono">{{ hook.command ?? hook.url ?? '—' }}</p>
            </template>
          </ListingRow>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>
