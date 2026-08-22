<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TurnFileChange } from '../../lib/turnFiles';
import Button from '../ui/Button.vue';
import Card from '../ui/Card.vue';
import Icon from '../ui/Icon.vue';
import { fileTypeIconSvg } from '../../lib/icons';

const { changes, cwd, interactive = true } = defineProps<{
  changes: TurnFileChange[];
  cwd?: string;
  interactive?: boolean;
}>();
const emit = defineEmits<{
  openDiff: [change: TurnFileChange];
  openFile: [target: { path: string }];
}>();
const { t } = useI18n();
const expanded = shallowRef(false);
const shownChanges = computed(() => (expanded.value ? changes : changes.slice(0, 3)));
const hiddenCount = computed(() => Math.max(0, changes.length - 3));
const totalAdded = computed(() => changes.reduce((sum, change) => sum + change.added, 0));
const totalRemoved = computed(() => changes.reduce((sum, change) => sum + change.removed, 0));
const statsComplete = computed(() => changes.every((change) => !change.statsIncomplete));
const statsTotal = computed(() => totalAdded.value + totalRemoved.value);
const addGrow = computed(() => statsTotal.value === 0 ? 1 : totalAdded.value);
const removeGrow = computed(() => statsTotal.value === 0 ? 1 : totalRemoved.value);

function displayPath(path: string): string {
  if (!cwd) return path;
  const root = cwd.replaceAll('\\', '/').replace(/\/$/, '');
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : path;
}

function pathParts(path: string): { dir: string; base: string } {
  const normalized = displayPath(path).replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  return index < 0
    ? { dir: '', base: normalized }
    : { dir: normalized.slice(0, index + 1), base: normalized.slice(index + 1) };
}

function open(change: TurnFileChange): void {
  if (!interactive) return;
  if (change.hasWrite) emit('openFile', { path: change.path });
  else emit('openDiff', change);
}
</script>

<template>
  <Card class="turn-files">
    <template #head>
      <span class="tf-ic"><Icon name="pencil" size="sm" /></span>
      <span class="tf-title">
        {{ t(changes.length === 1 ? 'conversation.turnFiles.titleOne' : 'conversation.turnFiles.titleOther', { number: changes.length }) }}
      </span>
      <span v-if="statsComplete && statsTotal > 0" class="tf-stats">
        <span v-if="totalAdded > 0" class="tf-add">+{{ totalAdded }}</span>
        <span v-if="totalRemoved > 0" class="tf-del">−{{ totalRemoved }}</span>
        <span class="diffbar" aria-hidden="true">
          <span class="seg-add" :style="{ flexGrow: addGrow }" />
          <span class="seg-del" :style="{ flexGrow: removeGrow }" />
        </span>
      </span>
    </template>
    <ul class="tf-list">
      <li v-for="change in shownChanges" :key="change.path" class="tf-row">
        <component
          :is="interactive ? 'button' : 'span'"
          :type="interactive ? 'button' : undefined"
          class="tf-file"
          @click="open(change)"
        >
          <span class="tf-ficon" aria-hidden="true" v-html="fileTypeIconSvg(change.path)" />
          <span class="tf-dir">{{ pathParts(change.path).dir }}</span>
          <span class="tf-base">{{ pathParts(change.path).base }}</span>
        </component>
        <span
          v-if="!change.statsIncomplete && (change.added > 0 || change.removed > 0)"
          class="tf-stats"
        >
          <span v-if="change.added > 0" class="tf-add">+{{ change.added }}</span>
          <span v-if="change.removed > 0" class="tf-del">−{{ change.removed }}</span>
        </span>
      </li>
    </ul>
    <template v-if="hiddenCount > 0" #foot>
      <Button class="tf-more" variant="ghost" size="sm" @click="expanded = !expanded">
        <Icon class="tf-more-car" :class="{ open: expanded }" name="chevron-down" size="sm" />
        {{ expanded ? t('conversation.turnFiles.showLess') : t(hiddenCount === 1 ? 'conversation.turnFiles.moreOne' : 'conversation.turnFiles.more', { number: hiddenCount }) }}
      </Button>
    </template>
  </Card>
</template>

<style scoped>
.turn-files { margin-top: var(--chat-block-gap); }
.turn-files :deep(.ui-card__head) { font-family: var(--font-ui); font-weight: var(--weight-regular); padding: var(--space-2) var(--space-3); }
.turn-files :deep(.ui-card__body) { padding: var(--space-1) var(--space-3); }
.turn-files :deep(.ui-card__foot) { padding: 0; justify-content: stretch; }
.tf-ic { display: inline-flex; align-items: center; color: var(--color-text-faint); flex: none; }
.tf-title { font-size: var(--text-sm); color: var(--color-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-stats { margin-left: auto; display: inline-flex; align-items: center; gap: var(--space-1); flex: none; }
.tf-add, .tf-del { font: var(--text-xs) var(--font-mono); flex: none; }
.tf-add { color: var(--color-success); }
.tf-del { color: var(--color-danger); }
.tf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.tf-row { display: flex; align-items: center; gap: var(--space-1); min-width: 0; padding: var(--space-1) 0; font-size: var(--text-sm); line-height: var(--leading-tight); }
.tf-file { display: flex; align-items: baseline; border: none; border-radius: var(--radius-xs); background: transparent; padding: 0; font: inherit; color: var(--color-text); flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-align: left; cursor: pointer; }
.tf-file:hover { text-decoration: underline; text-decoration-color: var(--color-text-faint); text-underline-offset: 3px; }
.tf-ficon { display: inline-flex; align-items: center; flex: none; line-height: 0; margin-right: 2px; }
.tf-ficon :deep(svg) { display: block; }
.tf-file:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
/* Non-interactive (static) files list: rows render as spans — no pointer. */
span.tf-file { cursor: default; }
span.tf-file:hover { text-decoration: none; }
.tf-dir { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-faint); }
.tf-base { flex: none; font-weight: var(--weight-medium); color: var(--color-text); }
.tf-more { width: 100%; justify-content: flex-start; border-radius: 0; }
.turn-files .tf-more:not(:disabled):active { transform: none; }
.tf-more-car { color: var(--color-text-faint); transition: transform var(--duration-base) var(--ease-out); }
.tf-more-car.open { transform: rotate(180deg); }
.diffbar { display: inline-flex; width: 36px; height: 3px; border-radius: var(--radius-full); overflow: hidden; flex: none; }
.seg-add { background: var(--color-success); }
.seg-del { background: var(--color-danger); }
</style>
