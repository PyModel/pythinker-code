<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TurnFileChange } from '../../lib/turnFiles';
import Button from '../ui/Button.vue';
import PanelHeader from '../ui/PanelHeader.vue';
import DiffLines from './DiffLines.vue';

defineProps<{ changes: TurnFileChange[] }>();
const emit = defineEmits<{
  close: [];
  openFile: [target: { path: string }];
}>();
const { t } = useI18n();
</script>

<template>
  <div class="turn-diff-panel">
    <PanelHeader :title="t('conversation.turnFiles.diffTitle')" @close="emit('close')" />
    <div class="tdp-body">
      <section v-for="change in changes" :key="change.path" class="tdp-file">
        <div class="tdp-file-head">
          <span class="tdp-path">{{ change.path }}</span>
          <Button variant="ghost" size="sm" @click="emit('openFile', { path: change.path })">
            {{ t('conversation.turnFiles.openFile') }}
          </Button>
        </div>
        <div v-if="change.diff" class="tdp-diff"><DiffLines :lines="change.diff" /></div>
        <p v-else class="tdp-unavailable">{{ t('conversation.turnFiles.diffUnavailable') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.turn-diff-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--color-surface); }
.tdp-body { min-height: 0; overflow: auto; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
.tdp-file { min-width: 0; border: 1px solid var(--color-line); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface-raised); }
.tdp-file-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-line); }
.tdp-path { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--text-xs) var(--font-mono); color: var(--color-text); }
.tdp-diff { overflow: auto; background: var(--color-surface); }
.tdp-unavailable { margin: 0; padding: var(--space-4); color: var(--color-text-muted); font-size: var(--text-sm); }
</style>
