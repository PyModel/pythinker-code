<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TurnFileChange } from '../../lib/turnFiles';
import Button from '../ui/Button.vue';
import PanelHeader from '../ui/PanelHeader.vue';
import Tooltip from '../ui/Tooltip.vue';
import HighlightedCode from './HighlightedCode.vue';

const props = defineProps<{
  changes: TurnFileChange[];
  /** Session working directory; paths inside it are shown relative to it. */
  cwd?: string;
}>();

const emit = defineEmits<{
  close: [];
  openFile: [target: { path: string }];
}>();
const { t } = useI18n();

/**
 * Strip `cwd` from an absolute path so the shown path is relative to the
 * working directory. Paths outside the cwd (or when there is no cwd) stay
 * absolute; returns null in those cases. Windows drive / UNC paths compare
 * case-insensitively.
 */
function relatify(path: string, cwd: string | undefined): string | null {
  if (!cwd) return null;
  const norm = (value: string): string => value.replaceAll('\\', '/');
  const target = norm(path);
  let base = norm(cwd);
  if (base.length > 1) base = base.replace(/\/+$/, '');
  const winLike = /^[a-z]:\//i.test(base) || /^[a-z]:\//i.test(target) || base.startsWith('//') || target.startsWith('//');
  const baseCmp = winLike ? base.toLowerCase() : base;
  const targetCmp = winLike ? target.toLowerCase() : target;
  const prefix = baseCmp.endsWith('/') ? baseCmp : `${baseCmp}/`;
  if (targetCmp !== baseCmp && !targetCmp.startsWith(prefix)) return null;
  const rel = targetCmp === baseCmp ? '' : target.slice(prefix.length);
  return rel.split('/').includes('..') ? null : (rel || null);
}

function truncateLeft(path: string, maxLen = 48): string {
  if (!path || path.length <= maxLen) return path;
  return '…' + path.slice(path.length - maxLen + 1);
}

function shownPath(change: TurnFileChange): string {
  return relatify(change.path, props.cwd) ?? change.path;
}
</script>

<template>
  <div class="turn-diff-panel">
    <PanelHeader :title="t('conversation.turnFiles.diffTitle')" @close="emit('close')" />
    <div class="tdp-body">
      <section v-for="change in changes" :key="change.path" class="tdp-file">
        <div class="tdp-file-head">
          <Tooltip :text="change.path">
            <span class="tdp-path">{{ truncateLeft(shownPath(change)) }}</span>
          </Tooltip>
          <Button variant="ghost" size="sm" @click="emit('openFile', { path: change.path })">
            {{ t('conversation.turnFiles.openFile') }}
          </Button>
        </div>
        <div v-if="change.diff" class="tdp-diff">
          <HighlightedCode :lines="change.diff" :path="change.path" :framed="false" />
        </div>
        <div v-else class="tdp-unavailable">
          <p>{{ t('conversation.turnFiles.diffUnavailable') }}</p>
          <Button variant="ghost" size="sm" @click="emit('openFile', { path: change.path })">
            {{ t('conversation.turnFiles.openFile') }}
          </Button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.turn-diff-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--color-surface); }
.tdp-body { min-height: 0; overflow: auto; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-3); }
.tdp-file { min-width: 0; border: 1px solid var(--color-line); border-radius: var(--radius-md); overflow: hidden; background: var(--color-surface-raised); }
.tdp-file-head { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-line); }
.tdp-path { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--text-xs) var(--font-mono); color: var(--color-text-muted); }
.tdp-diff { overflow: auto; background: var(--color-surface); }
.tdp-unavailable { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3); padding: var(--space-6); color: var(--color-text-muted); font-size: var(--text-sm); text-align: center; }
.tdp-unavailable p { margin: 0; }
</style>