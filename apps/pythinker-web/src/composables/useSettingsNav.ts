import { shallowRef, toValue, type MaybeRefOrGetter } from 'vue';

export type SettingsTab =
  | 'general'
  | 'agent'
  | 'tools'
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
      { id: 'tools', labelKey: 'settings.tabs.tools' },
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
  onLoadTools: () => void;
  onLoadSubagents: () => void;
};

export function useSettingsNav(options: UseSettingsNavOptions) {
  const activeTab = shallowRef<SettingsTab>('general');

  function loadFor(tab: SettingsTab): void {
    if (tab === 'tools') options.onLoadTools();
    if (tab === 'connectors' && toValue(options.counts.connectors) === 0) options.onLoadConnectors();
    if (tab === 'plugins' && toValue(options.counts.plugins) === 0) options.onLoadPlugins();
    // Connectors and plugins are daemon-wide, so one load holds. Tools and
    // subagents are session-scoped, so always refetch them for the active
    // session.
    if (tab === 'subagents') options.onLoadSubagents();
  }

  function setTab(tab: SettingsTab): void {
    loadFor(tab);
    activeTab.value = tab;
  }

  /** Call when the settings route opens; the active tab persists across visits. */
  function refreshActiveTab(): void {
    loadFor(activeTab.value);
  }

  return { activeTab, setTab, refreshActiveTab };
}
