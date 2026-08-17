<script setup lang="ts">
import type {
  AppConfig,
  AppConnector,
  AppModel,
  AppPlugin,
  AppSession,
  AppSkill,
  AppSubagent,
} from '../../api/types';
import type { ColorScheme, Theme } from '../../composables/usePythinkerWebClient';
import type { SettingsTab } from '../../composables/useSettingsNav';
import AdvancedPage from './pages/AdvancedPage.vue';
import AgentPage from './pages/AgentPage.vue';
import ConnectorsPage from './pages/ConnectorsPage.vue';
import ExperimentalPage from './pages/ExperimentalPage.vue';
import GeneralPage from './pages/GeneralPage.vue';
import HooksPage from './pages/HooksPage.vue';
import PluginsPage from './pages/PluginsPage.vue';
import SkillsPage from './pages/SkillsPage.vue';
import SubagentsPage from './pages/SubagentsPage.vue';
import UsagePage from './pages/UsagePage.vue';

defineProps<{
  activeTab: SettingsTab;
  theme: Theme;
  colorScheme: ColorScheme;
  uiFontSize: number;
  authReady: boolean;
  accountModel?: string | null;
  notify: boolean;
  notifyPermission?: string;
  betaToc?: boolean;
  config?: AppConfig | null;
  models?: AppModel[];
  configSaving?: boolean;
  skills?: AppSkill[];
  connectors?: AppConnector[];
  connectorsLoading?: boolean;
  sessions?: AppSession[];
  plugins?: AppPlugin[];
  subagents?: AppSubagent[];
}>();

const emit = defineEmits<{
  setTheme: [theme: Theme];
  setColorScheme: [colorScheme: ColorScheme];
  setUiFontSize: [size: number];
  setNotify: [on: boolean];
  setBetaToc: [on: boolean];
  login: [];
  openOnboarding: [];
  updateConfig: [patch: Partial<AppConfig>];
  restartConnector: [connectorId: string];
  setPluginEnabled: [payload: { pluginId: string; enabled: boolean }];
}>();
</script>

<template>
  <main class="settings-pane con">
    <GeneralPage
      v-show="activeTab === 'general'"
      :theme="theme"
      :color-scheme="colorScheme"
      :ui-font-size="uiFontSize"
      :auth-ready="authReady"
      :account-model="accountModel"
      :notify="notify"
      :notify-permission="notifyPermission"
      @set-theme="emit('setTheme', $event)"
      @set-color-scheme="emit('setColorScheme', $event)"
      @set-ui-font-size="emit('setUiFontSize', $event)"
      @set-notify="emit('setNotify', $event)"
      @login="emit('login')"
      @open-onboarding="emit('openOnboarding')"
    />
    <AgentPage
      v-show="activeTab === 'agent'"
      :config="config"
      :models="models"
      :config-saving="configSaving"
      @update-config="emit('updateConfig', $event)"
    />
    <PluginsPage
      v-show="activeTab === 'plugins'"
      :plugins="plugins"
      @set-plugin-enabled="emit('setPluginEnabled', $event)"
    />
    <SkillsPage
      v-show="activeTab === 'skills'"
      :config="config"
      :skills="skills"
      @update-config="emit('updateConfig', $event)"
    />
    <SubagentsPage v-show="activeTab === 'subagents'" :subagents="subagents" />
    <ConnectorsPage
      v-show="activeTab === 'connectors'"
      :connectors="connectors"
      :connectors-loading="connectorsLoading"
      @restart-connector="emit('restartConnector', $event)"
    />
    <HooksPage v-show="activeTab === 'hooks'" :config="config" />
    <UsagePage v-show="activeTab === 'usage'" :sessions="sessions" />
    <AdvancedPage v-show="activeTab === 'advanced'" />
    <ExperimentalPage v-show="activeTab === 'experimental'" :beta-toc="betaToc" @set-beta-toc="emit('setBetaToc', $event)" />
  </main>
</template>

<style scoped>
.settings-pane {
  grid-column: 3;
  min-width: 0;
  min-height: 0;
  padding: 6px 16px 16px;
  overflow-y: auto;
  background: var(--bg);
  color: var(--ink);
}
</style>
