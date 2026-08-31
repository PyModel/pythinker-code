<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PanelTab } from '../../composables/usePanelTabs';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Tooltip from '../ui/Tooltip.vue';

const props = defineProps<{
  tabs: PanelTab[];
  activeId: string | null;
  expanded?: boolean;
  mobile?: boolean;
  canOpenDiff?: boolean;
  canOpenSideChat?: boolean;
}>();

const emit = defineEmits<{
  activate: [id: string];
  close: [id: string];
  toggleExpanded: [];
  hide: [];
  openDiff: [];
  openSideChat: [];
}>();

const { t } = useI18n();
const tabsRef = ref<HTMLElement | null>(null);
const addButtonRef = ref<InstanceType<typeof IconButton> | null>(null);
const addMenuRef = ref<HTMLElement | null>(null);
const addOpen = ref(false);

watch(
  () => props.activeId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const element = Array.from(tabsRef.value?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [])
      .find((candidate) => candidate.dataset.tabId === id);
    element?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  },
);

function focusTab(index: number): void {
  const buttons = Array.from(tabsRef.value?.querySelectorAll<HTMLButtonElement>('.ptb-tab-main') ?? []);
  buttons[index]?.focus();
}

function onTabKeydown(event: KeyboardEvent, index: number): void {
  if (props.tabs.length === 0) return;
  let next: number | undefined;
  if (event.key === 'ArrowRight') next = (index + 1) % props.tabs.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + props.tabs.length) % props.tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = props.tabs.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  emit('activate', props.tabs[next]!.id);
  void nextTick(() => focusTab(next!));
}

function closeAddMenu(): void {
  addOpen.value = false;
  document.removeEventListener('pointerdown', onOutsidePointer, true);
}

function onOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node;
  if (addMenuRef.value?.contains(target) || addButtonRef.value?.el?.contains(target)) return;
  closeAddMenu();
}

function toggleAddMenu(): void {
  if (addOpen.value) {
    closeAddMenu();
    return;
  }
  addOpen.value = true;
  document.addEventListener('pointerdown', onOutsidePointer, true);
  void nextTick(() => addMenuRef.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
}

function openAddItem(kind: 'diff' | 'sideChat'): void {
  closeAddMenu();
  if (kind === 'diff') emit('openDiff');
  else emit('openSideChat');
}

onUnmounted(closeAddMenu);
</script>

<template>
  <header class="panel-tab-bar">
    <div ref="tabsRef" class="ptb-tabs" role="tablist">
      <div
        v-for="(tab, index) in tabs"
        :key="tab.id"
        class="ptb-tab"
        :class="{ on: tab.id === activeId }"
        :data-tab-id="tab.id"
      >
        <button
          type="button"
          class="ptb-tab-main"
          role="tab"
          :aria-selected="tab.id === activeId"
          :tabindex="tab.id === activeId ? 0 : -1"
          :title="tab.title"
          @click="emit('activate', tab.id)"
          @keydown="onTabKeydown($event, index)"
        >
          <Icon :name="tab.icon" size="sm" />
          <span class="ptb-t">{{ tab.title }}</span>
        </button>
        <Tooltip :text="t('panel.closeTab')">
          <button type="button" class="ptb-x" :aria-label="t('panel.closeTab')" @click.stop="emit('close', tab.id)">
            <Icon name="close" size="sm" />
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="ptb-tail">
      <IconButton
        ref="addButtonRef"
        size="sm"
        :label="t('panel.newTab')"
        aria-haspopup="menu"
        :aria-expanded="addOpen"
        @click="toggleAddMenu"
        @keydown.down.prevent="toggleAddMenu"
        @keydown.up.prevent="toggleAddMenu"
      ><Icon name="plus" size="sm" /></IconButton>
      <IconButton
        v-if="tabs.length > 0 && !mobile"
        size="sm"
        :label="expanded ? t('panel.collapse') : t('panel.expand')"
        @click="emit('toggleExpanded')"
      ><Icon :name="expanded ? 'collapse' : 'expand'" size="sm" /></IconButton>
      <IconButton class="ptb-hide" size="sm" :label="t('panel.hide')" @click="emit('hide')">
        <Icon :name="mobile ? 'close' : 'panel-collapse-right'" size="sm" />
      </IconButton>
      <div v-if="addOpen" ref="addMenuRef" class="panel-add-menu" role="menu" @keydown.esc.prevent="closeAddMenu(); addButtonRef?.el?.focus()">
        <button type="button" role="menuitem" :disabled="!canOpenSideChat" @click="openAddItem('sideChat')">
          <Icon name="message" size="sm" /><span>{{ t('sideChat.title') }}</span>
        </button>
        <button type="button" role="menuitem" :disabled="!canOpenDiff" @click="openAddItem('diff')">
          <Icon name="git-fork" size="sm" /><span>{{ t('panel.tabs.diff') }}</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.panel-tab-bar { position: relative; display: flex; align-items: center; min-width: 0; height: 44px; border-bottom: 1px solid var(--color-line); background: var(--color-bg); user-select: none; }
.ptb-tabs { display: flex; flex: 1; min-width: 0; height: 100%; overflow-x: auto; scrollbar-width: none; }
.ptb-tabs::-webkit-scrollbar { display: none; }
.ptb-tab { display: flex; align-items: center; flex: 0 1 180px; min-width: 82px; max-width: 220px; border-right: 1px solid var(--color-line); color: var(--color-text-muted); }
.ptb-tab.on { background: var(--color-surface-raised); color: var(--color-text); box-shadow: inset 0 -2px 0 var(--color-accent); }
.ptb-tab-main { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; height: 100%; padding: 0 var(--space-2) 0 var(--space-3); border: 0; background: transparent; color: inherit; font: var(--text-sm) var(--font-ui); cursor: pointer; }
.ptb-tab-main:focus-visible, .ptb-x:focus-visible { outline: none; box-shadow: inset var(--p-focus-ring); }
.ptb-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ptb-x { position: relative; display: grid; place-items: center; flex: none; width: 28px; height: 28px; margin-right: var(--space-1); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-faint); cursor: pointer; }
.ptb-x:hover { color: var(--color-text); background: var(--color-hover); }
.ptb-tail { position: relative; display: flex; align-items: center; gap: var(--space-1); flex: none; padding-inline: var(--space-2); }
.panel-add-menu { position: absolute; top: calc(100% + var(--space-1)); right: var(--space-2); z-index: var(--z-dropdown); display: flex; flex-direction: column; width: 190px; padding: var(--space-1); border: 1px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface-raised); box-shadow: var(--shadow-md); }
.panel-add-menu button { display: flex; align-items: center; gap: var(--space-2); min-height: 34px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text); font: var(--text-sm) var(--font-ui); cursor: pointer; }
.panel-add-menu button:hover:not(:disabled), .panel-add-menu button:focus-visible { background: var(--color-hover); outline: none; }
.panel-add-menu button:disabled { color: var(--color-text-faint); cursor: default; }
@media (pointer: coarse) { .ptb-tab-main::after, .ptb-x::after { content: ''; position: absolute; inset: calc((var(--touch-target-min) - 28px) / -2); } .ptb-tab-main, .ptb-x { position: relative; } }
</style>
