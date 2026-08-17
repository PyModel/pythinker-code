import { shallowRef, toValue, type MaybeRefOrGetter } from 'vue';

export type SettingsTab =
  | 'general'
  | 'agent'
  | 'skills'
  | 'connectors'
  | 'plugins'
  | 'subagents'
  | 'hooks'
  | 'usage'
  | 'advanced'
  | 'experimental';

export const tabGroups: Array<{
  titleKey: string;
  tabs: Array<{ id: SettingsTab; labelKey: string }>;
}> = [
  {
    titleKey: 'settings.groups.basics',
    tabs: [
      { id: 'general', labelKey: 'settings.tabs.general' },
      { id: 'agent', labelKey: 'settings.tabs.agent' },
    ],
  },
  {
    titleKey: 'settings.groups.capabilities',
    tabs: [
      { id: 'plugins', labelKey: 'settings.tabs.plugins' },
      { id: 'skills', labelKey: 'settings.tabs.skills' },
      { id: 'subagents', labelKey: 'settings.tabs.subagents' },
      { id: 'connectors', labelKey: 'settings.tabs.connectors' },
      { id: 'hooks', labelKey: 'settings.tabs.hooks' },
    ],
  },
  {
    titleKey: 'settings.groups.data',
    tabs: [
      { id: 'usage', labelKey: 'settings.tabs.usage' },
      { id: 'advanced', labelKey: 'settings.tabs.advanced' },
      { id: 'experimental', labelKey: 'settings.tabs.experimental' },
    ],
  },
];

type UseSettingsNavOptions = {
  counts: {
    connectors: MaybeRefOrGetter<number>;
    plugins: MaybeRefOrGetter<number>;
    subagents: MaybeRefOrGetter<number>;
  };
  onLoadConnectors: () => void;
  onLoadPlugins: () => void;
  onLoadSubagents: () => void;
};

export function useSettingsNav(options: UseSettingsNavOptions) {
  const activeTab = shallowRef<SettingsTab>('general');

  function setTab(tab: SettingsTab): void {
    if (tab === 'connectors' && toValue(options.counts.connectors) === 0) options.onLoadConnectors();
    if (tab === 'plugins' && toValue(options.counts.plugins) === 0) options.onLoadPlugins();
    if (tab === 'subagents' && toValue(options.counts.subagents) === 0) options.onLoadSubagents();
    activeTab.value = tab;
  }

  return { activeTab, setTab };
}
