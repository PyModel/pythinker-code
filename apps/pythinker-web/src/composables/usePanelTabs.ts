import { computed, ref, watch, type Ref } from 'vue';
import type { IconName } from '../lib/icons';
import type { DetailTarget } from './useFilePreview';

export interface PanelTab {
  id: string;
  type: DetailTarget;
  title: string;
  icon: IconName;
  key: string;
  payload?: unknown;
}

export interface OpenPanelTab {
  type: DetailTarget;
  title: string;
  icon: IconName;
  key: string;
  payload?: unknown;
  always?: boolean;
}

interface PanelSnapshot {
  tabs: Omit<PanelTab, 'id'>[];
  activeIndex: number;
  visible: boolean;
}

const RESTORABLE_TYPES = new Set<DetailTarget>(['agent', 'compaction', 'btw']);

export function usePanelTabs(sessionKey: Ref<string>) {
  const tabs = ref<PanelTab[]>([]);
  const activeTabId = ref<string | null>(null);
  const visible = ref(false);
  const expanded = ref(false);
  const snapshots = new Map<string, PanelSnapshot>();
  let nextId = 0;

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
  );

  function openTab(input: OpenPanelTab): PanelTab {
    const existing = input.always
      ? undefined
      : tabs.value.find((tab) => tab.type === input.type && tab.key === input.key);
    if (existing) {
      existing.title = input.title;
      existing.payload = input.payload;
      activeTabId.value = existing.id;
      visible.value = true;
      return existing;
    }
    const tab: PanelTab = { ...input, id: `panel-tab-${++nextId}` };
    tabs.value = [...tabs.value, tab];
    activeTabId.value = tab.id;
    visible.value = true;
    return tab;
  }

  function activateTab(id: string): void {
    if (!tabs.value.some((tab) => tab.id === id)) return;
    activeTabId.value = id;
    visible.value = true;
  }

  function closeTab(id: string): PanelTab | null {
    const index = tabs.value.findIndex((tab) => tab.id === id);
    if (index < 0) return null;
    const [closed] = tabs.value.splice(index, 1);
    tabs.value = [...tabs.value];
    if (activeTabId.value === id) {
      const next = tabs.value[Math.min(index, tabs.value.length - 1)];
      activeTabId.value = next?.id ?? null;
    }
    if (tabs.value.length === 0) {
      visible.value = false;
      expanded.value = false;
    }
    return closed ?? null;
  }

  function hidePanel(): boolean {
    if (!visible.value) return false;
    visible.value = false;
    expanded.value = false;
    return true;
  }

  function togglePanel(): void {
    visible.value = !visible.value;
    if (!visible.value) expanded.value = false;
  }

  function toggleExpanded(): void {
    if (activeTab.value === null) return;
    expanded.value = !expanded.value;
    if (expanded.value) visible.value = true;
  }

  function saveSnapshot(key: string): void {
    const restorable = tabs.value.filter((tab) => RESTORABLE_TYPES.has(tab.type));
    const activeIndex = Math.max(0, restorable.findIndex((tab) => tab.id === activeTabId.value));
    if (restorable.length === 0) {
      snapshots.delete(key);
      return;
    }
    snapshots.set(key, {
      tabs: restorable.map(({ id: _id, ...tab }) => ({ ...tab })),
      activeIndex,
      visible: visible.value,
    });
  }

  function restoreSnapshot(key: string): void {
    const snapshot = snapshots.get(key);
    tabs.value = snapshot?.tabs.map((tab) => ({ ...tab, id: `panel-tab-${++nextId}` })) ?? [];
    activeTabId.value = tabs.value[snapshot?.activeIndex ?? 0]?.id ?? null;
    visible.value = snapshot?.visible === true && tabs.value.length > 0;
    expanded.value = false;
  }

  watch(sessionKey, (next, previous) => {
    saveSnapshot(previous);
    restoreSnapshot(next);
  });

  return {
    tabs,
    activeTabId,
    activeTab,
    visible,
    expanded,
    openTab,
    activateTab,
    closeTab,
    hidePanel,
    togglePanel,
    toggleExpanded,
  };
}
