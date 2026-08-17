<!-- apps/pythinker-web/src/components/SettingsDialog.vue -->
<!-- The app's dedicated Settings page (modal). Consolidates what used to be
     scattered in the sidebar account popover: appearance, language, account,
     connection, plus notifications and the troubleshooting-log export. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialogFocus } from '../composables/useDialogFocus';
import { serverEndpointLabel } from '../api/config';
import { downloadTraceLog, isTraceEnabled } from '../debug/trace';
import type { ColorScheme, Theme } from '../composables/usePythinkerWebClient';
import type {
  AppConfig,
  AppConfigProvider,
  AppConnector,
  AppHook,
  AppModel,
  AppSession,
  AppSkill,
} from '../api/types';
import { formatTokens } from '../lib/formatTokens';

const { t } = useI18n();

const props = defineProps<{
  theme: Theme;
  colorScheme: ColorScheme;
  uiFontSize: number;
  authReady: boolean;
  accountModel?: string | null;
  /** Browser-notification-on-completion preference. */
  notify: boolean;
  /** OS permission state ('default' | 'granted' | 'denied') for the hint. */
  notifyPermission?: string;
  /** Beta conversation TOC (proportional, viewport, hover tooltip). */
  betaToc?: boolean;
  /** Global daemon config from GET /api/v1/config. Secrets are redacted server-side. */
  config?: AppConfig | null;
  /** Models from the daemon catalog, used to label default-model choices. */
  models?: AppModel[];
  /** True while POST /api/v1/config is saving. */
  configSaving?: boolean;
  /** Skills available to the active session, for the Skills page. */
  skills?: AppSkill[];
  /** Configured MCP servers, for the Connectors page. */
  connectors?: AppConnector[];
  /** True while GET /api/v1/mcp/servers is in flight. */
  connectorsLoading?: boolean;
  /** Every session the client has loaded, for the usage totals. */
  sessions?: AppSession[];
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
  loadConnectors: [];
  restartConnector: [connectorId: string];
  close: [];
}>();

type SettingsTab =
  | 'general'
  | 'agent'
  | 'skills'
  | 'connectors'
  | 'hooks'
  | 'usage'
  | 'advanced'
  | 'experimental';

const activeTab = ref<SettingsTab>('general');

/** Nav groups, mirroring how the pages divide up: basics, what the agent can
    reach, then the read-only data pages. */
const tabGroups: { titleKey: string; tabs: { id: SettingsTab; labelKey: string }[] }[] = [
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
      { id: 'skills', labelKey: 'settings.tabs.skills' },
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

const daemonEndpoint = serverEndpointLabel();
const permissionModes = ['manual', 'yolo', 'auto'] as const;
const desktopBridge = typeof window !== 'undefined' ? window.pythinkerDesktop : undefined;
const desktopAutoUpdate = ref(true);
const desktopUpdateState = ref<DesktopUpdateState | undefined>();
let removeDesktopUpdateListener: (() => void) | undefined;

const desktopStatusText = computed(() => {
  const state = desktopUpdateState.value;
  if (state === undefined) return '';
  if (state.status === 'disabled') return t('settings.desktop.disabled');
  if (state.status === 'idle') return state.message ? t('settings.desktop.upToDate') : '';
  if (state.status === 'checking') return t('settings.desktop.checking');
  if (state.status === 'available' || state.status === 'downloading') {
    return state.version
      ? t('settings.desktop.downloading', { version: state.version })
      : t('settings.desktop.downloadingUnknown');
  }
  if (state.status === 'downloaded') return t('settings.desktop.updateReady');
  return state.message
    ? t('settings.desktop.error', { message: state.message })
    : t('settings.desktop.errorGeneric');
});

const desktopCheckDisabled = computed(() => {
  const status = desktopUpdateState.value?.status;
  return status === 'checking' || status === 'downloading';
});

function setDesktopUpdateState(state: DesktopUpdateState): void {
  desktopUpdateState.value = state;
  desktopAutoUpdate.value = state.autoUpdate;
}

function setDesktopUpdateError(error: unknown): void {
  desktopUpdateState.value = {
    status: 'error',
    autoUpdate: desktopAutoUpdate.value,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function setDesktopAutoUpdate(enabled: boolean): Promise<void> {
  if (desktopBridge === undefined) return;
  desktopAutoUpdate.value = enabled;
  try {
    const state = await desktopBridge.setAutoUpdate(enabled);
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

async function checkDesktopForUpdates(): Promise<void> {
  if (desktopBridge === undefined) return;
  try {
    const state = await desktopBridge.checkForUpdates();
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

async function restartDesktopToUpdate(): Promise<void> {
  if (desktopBridge === undefined) return;
  try {
    const state = await desktopBridge.quitAndInstall();
    if (state !== undefined) setDesktopUpdateState(state);
  } catch (error) {
    setDesktopUpdateError(error);
  }
}

// Modal focus: move focus into the dialog on open, restore it to the opener on
// close (Escape-to-close is handled below).
const dialogRef = ref<HTMLElement | null>(null);
useDialogFocus(dialogRef);

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  if (desktopBridge === undefined) return;
  removeDesktopUpdateListener = desktopBridge.onUpdateState(setDesktopUpdateState);
  void desktopBridge.getUpdateState().then(setDesktopUpdateState).catch(setDesktopUpdateError);
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  removeDesktopUpdateListener?.();
  removeDesktopUpdateListener = undefined;
});

function exportLog(): void {
  downloadTraceLog();
}

type ModelOption = { id: string; label: string; provider: string };

const modelOptions = computed<ModelOption[]>(() => {
  const byId = new Map<string, ModelOption>();
  for (const model of props.models ?? []) {
    byId.set(model.id, {
      id: model.id,
      label: model.displayName ?? model.model ?? model.id,
      provider: model.provider,
    });
  }
  for (const [id, raw] of Object.entries(props.config?.models ?? {})) {
    if (byId.has(id)) continue;
    const provider = extractConfigModelProvider(raw);
    byId.set(id, {
      id,
      label: formatConfigModelLabel(id, raw, provider),
      provider: provider ?? id,
    });
  }
  return Array.from(byId.values());
});

const modelGroups = computed<Array<{ provider: string; options: ModelOption[] }>>(() => {
  const map = new Map<string, ModelOption[]>();
  for (const option of modelOptions.value) {
    const list = map.get(option.provider) ?? [];
    list.push(option);
    map.set(option.provider, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }
  return Array.from(map.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([provider, options]) => ({ provider, options }));
});

const providerEntries = computed<Array<{ id: string; provider: AppConfigProvider }>>(() =>
  Object.entries(props.config?.providers ?? {})
    .map(([id, provider]) => ({ id, provider }))
    .sort((a, b) => a.id.localeCompare(b.id)),
);

const defaultPermissionMode = computed(() => {
  const mode = props.config?.defaultPermissionMode;
  return mode === 'auto' || mode === 'yolo' || mode === 'manual' ? mode : 'manual';
});

function extractConfigModelProvider(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const provider = typeof source['provider'] === 'string' ? source['provider'] : undefined;
  return provider;
}

function formatConfigModelLabel(id: string, raw: unknown, provider?: string): string {
  if (!raw || typeof raw !== 'object') return id;
  const source = raw as Record<string, unknown>;
  const model = typeof source['model'] === 'string' ? source['model'] : undefined;
  const resolvedProvider = provider ?? extractConfigModelProvider(raw);
  if (model && resolvedProvider) return `${id} (${resolvedProvider}/${model})`;
  if (model) return `${id} (${model})`;
  return id;
}

function configBool(value: boolean | undefined): boolean {
  return value === true;
}

function setDefaultModel(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!value || value === props.config?.defaultModel) return;
  emit('updateConfig', { defaultModel: value });
}

function setDefaultPermissionMode(mode: 'manual' | 'auto' | 'yolo'): void {
  if (mode === defaultPermissionMode.value) return;
  emit('updateConfig', { defaultPermissionMode: mode });
}

function toggleConfigBoolean(key: 'defaultThinking' | 'defaultPlanMode' | 'mergeAllAvailableSkills' | 'telemetry'): void {
  const current = props.config?.[key];
  emit('updateConfig', { [key]: !configBool(current) } as Partial<AppConfig>);
}

const skillQuery = ref('');

/** Skills grouped by source, each group's skills sorted by name. */
const skillGroups = computed(() => {
  const query = skillQuery.value.trim().toLowerCase();
  const matching = (props.skills ?? []).filter(
    (skill) =>
      query === '' ||
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query),
  );
  const bySource = new Map<string, AppSkill[]>();
  for (const skill of matching) {
    const group = bySource.get(skill.source) ?? [];
    group.push(skill);
    bySource.set(skill.source, group);
  }
  return [...bySource.entries()]
    .map(([source, skills]) => ({
      source,
      skills: skills.toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
    .toSorted((a, b) => a.source.localeCompare(b.source));
});

const disabledSkills = computed(() => new Set(props.config?.disabledSkills ?? []));

/** Hooks grouped by the event they fire on, in the order the config lists them. */
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

const skillCount = computed(() => skillGroups.value.reduce((sum, g) => sum + g.skills.length, 0));

/** Totals over every session the client has loaded. */
const usageStats = computed(() => {
  const sessions = props.sessions ?? [];
  let tokens = 0;
  let turns = 0;
  let cost = 0;
  for (const session of sessions) {
    tokens += session.usage.inputTokens + session.usage.outputTokens;
    turns += session.usage.turnCount;
    cost += session.usage.totalCostUsd;
  }
  return {
    tokens: formatTokens(tokens),
    sessions: String(sessions.length),
    turns: String(turns),
    cost: `$${cost.toFixed(2)}`,
  };
});

/** Share of total tokens per model, largest first. */
const usageByModel = computed(() => {
  const byModel = new Map<string, number>();
  let total = 0;
  for (const session of props.sessions ?? []) {
    const used = session.usage.inputTokens + session.usage.outputTokens;
    if (used === 0 || session.model === '') continue;
    byModel.set(session.model, (byModel.get(session.model) ?? 0) + used);
    total += used;
  }
  if (total === 0) return [];
  return [...byModel.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .map(([model, used]) => ({ model, share: `${Math.round((used / total) * 100)}%` }));
});

function isSkillEnabled(name: string): boolean {
  return !disabledSkills.value.has(name);
}

/** Disabling a skill stores its name; the daemon then never registers it. */
function toggleSkill(name: string): void {
  const next = new Set(disabledSkills.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  emit('updateConfig', { disabledSkills: [...next].sort() });
}

function setTab(tab: SettingsTab): void {
  // The connector list is only fetched when its page is first opened.
  if (tab === 'connectors' && (props.connectors?.length ?? 0) === 0) emit('loadConnectors');
  activeTab.value = tab;
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div ref="dialogRef" class="dialog" role="dialog" aria-modal="true" tabindex="-1" :aria-label="t('settings.title')">
      <div class="dh">
        <span class="dtitle">{{ t('settings.title') }}</span>
        <button class="close-btn" :title="t('newSession.close')" @click="emit('close')">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/>
          </svg>
        </button>
      </div>

      <div class="settings-layout">
        <nav class="settings-tabs" role="tablist" :aria-label="t('settings.title')">
          <template v-for="group in tabGroups" :key="group.titleKey">
            <span class="tab-group">{{ t(group.titleKey) }}</span>
            <button
              v-for="tab in group.tabs"
              :key="tab.id"
              type="button"
              class="tab"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :aria-controls="`settings-panel-${tab.id}`"
              :id="`settings-tab-${tab.id}`"
              :class="{ on: activeTab === tab.id }"
              @click="setTab(tab.id)"
            >
              {{ t(tab.labelKey) }}
            </button>
          </template>
        </nav>

        <div class="body">
          <!-- General: Appearance + Notifications + Account -->
          <section
            v-show="activeTab === 'general'"
            :id="`settings-panel-general`"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
          >
            <section class="sec">
              <h3 class="sec-title">{{ t('settings.appearance') }}</h3>
              <div class="row">
                <span class="rlabel">{{ t('theme.label') }}</span>
                <div class="seg" role="group" :aria-label="t('theme.label')">
                  <button type="button" class="opt" :class="{ on: theme === 'modern' }" :aria-pressed="theme === 'modern'" @click="emit('setTheme', 'modern')">{{ t('theme.modern') }}</button>
                  <button type="button" class="opt" :class="{ on: theme === 'pythinker' }" :aria-pressed="theme === 'pythinker'" @click="emit('setTheme', 'pythinker')">{{ t('theme.pythinker') }}</button>
                </div>
              </div>
              <div class="row">
                <span class="rlabel">{{ t('theme.colorSchemeLabel') }}</span>
                <div class="seg" role="group" :aria-label="t('theme.colorSchemeLabel')">
                  <button type="button" class="opt" :class="{ on: colorScheme === 'light' }" :aria-pressed="colorScheme === 'light'" @click="emit('setColorScheme', 'light')">{{ t('theme.light') }}</button>
                  <button type="button" class="opt" :class="{ on: colorScheme === 'dark' }" :aria-pressed="colorScheme === 'dark'" @click="emit('setColorScheme', 'dark')">{{ t('theme.dark') }}</button>
                  <button type="button" class="opt" :class="{ on: colorScheme === 'system' }" :aria-pressed="colorScheme === 'system'" @click="emit('setColorScheme', 'system')">{{ t('theme.system') }}</button>
                </div>
              </div>
              <div class="row">
                <span class="rlabel">{{ t('settings.uiFontSize') }}</span>
                <label class="num-field">
                  <input
                    class="num-input"
                    type="number"
                    min="12"
                    max="20"
                    step="1"
                    :value="uiFontSize"
                    :aria-label="t('settings.uiFontSize')"
                    @input="emit('setUiFontSize', Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="num-unit">px</span>
                </label>
              </div>
            </section>

            <section class="sec">
              <h3 class="sec-title">{{ t('settings.notifications') }}</h3>
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.notifyOnComplete') }}
                  <span v-if="notifyPermission === 'denied'" class="hint">{{ t('settings.notifyDenied') }}</span>
                </span>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  :class="{ on: notify }"
                  :aria-checked="notify"
                  :disabled="notifyPermission === 'denied'"
                  @click="emit('setNotify', !notify)"
                >
                  <span class="knob" />
                </button>
              </div>
            </section>

            <section v-if="desktopBridge !== undefined" class="sec">
              <h3 class="sec-title">{{ t('settings.desktop.title') }}</h3>
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.desktop.automaticUpdates') }}
                  <span class="hint">{{ t('settings.desktop.automaticUpdatesHint') }}</span>
                </span>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  :class="{ on: desktopAutoUpdate }"
                  :aria-checked="desktopAutoUpdate"
                  @click="void setDesktopAutoUpdate(!desktopAutoUpdate)"
                >
                  <span class="knob" />
                </button>
              </div>
              <div v-if="desktopStatusText" class="row">
                <span class="rlabel">{{ t('settings.desktop.status') }}</span>
                <span class="rvalue">{{ desktopStatusText }}</span>
              </div>
              <div class="actions">
                <button
                  type="button"
                  class="act"
                  :disabled="desktopCheckDisabled"
                  @click="void checkDesktopForUpdates()"
                >
                  {{ t('settings.desktop.checkForUpdates') }}
                </button>
                <button
                  v-if="desktopUpdateState?.status === 'downloaded'"
                  type="button"
                  class="act"
                  @click="void restartDesktopToUpdate()"
                >
                  {{ t('settings.desktop.restartToUpdate') }}
                </button>
              </div>
            </section>

            <section class="sec">
              <h3 class="sec-title">{{ t('settings.account') }}</h3>
              <div class="row">
                <span class="rlabel">{{ authReady ? t('sidebar.signedIn') : t('sidebar.notSignedIn') }}</span>
                <span v-if="authReady && accountModel" class="rvalue" :title="accountModel">{{ accountModel }}</span>
              </div>
              <div class="actions">
                <button type="button" class="act" @click="emit('openOnboarding'); emit('close')">{{ t('onboarding.reopen') }}</button>
                <button type="button" class="act signin" @click="emit('login')">{{ t('providers.title') }}</button>
              </div>
            </section>
          </section>

          <!-- Agent defaults -->
          <section
            v-show="activeTab === 'agent'"
            :id="`settings-panel-agent`"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-agent"
          >
            <section class="sec">
              <div class="sec-head">
                <h3 class="sec-title">{{ t('settings.agentDefaults') }}</h3>
                <span v-if="configSaving" class="saving">{{ t('settings.saving') }}</span>
              </div>

              <template v-if="config">
                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.defaultModel') }}
                    <span class="hint">{{ t('settings.defaultModelHint') }}</span>
                  </span>
                  <select
                    v-if="modelGroups.length > 0"
                    class="select-field"
                    :value="config.defaultModel ?? ''"
                    :disabled="configSaving"
                    :aria-label="t('settings.defaultModel')"
                    @change="setDefaultModel"
                  >
                    <option v-if="!config.defaultModel" value="" disabled>{{ t('settings.noDefaultModel') }}</option>
                    <optgroup v-for="group in modelGroups" :key="group.provider" :label="group.provider">
                      <option v-for="model in group.options" :key="model.id" :value="model.id">
                        {{ model.label }}
                      </option>
                    </optgroup>
                  </select>
                  <span v-else class="rvalue mono">{{ config.defaultModel ?? t('settings.noDefaultModel') }}</span>
                </div>

                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.defaultPermission') }}
                    <span class="hint">{{ t('settings.defaultPermissionHint') }}</span>
                  </span>
                  <div class="seg" role="group" :aria-label="t('settings.defaultPermission')">
                    <button
                      v-for="mode in permissionModes"
                      :key="mode"
                      type="button"
                      class="opt"
                      :class="{ on: defaultPermissionMode === mode }"
                      :aria-pressed="defaultPermissionMode === mode"
                      :disabled="configSaving"
                      @click="setDefaultPermissionMode(mode)"
                    >
                      {{ t(`settings.permission.${mode}`) }}
                    </button>
                  </div>
                </div>

                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.defaultThinking') }}
                    <span class="hint">{{ t('settings.defaultThinkingHint') }}</span>
                  </span>
                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    :class="{ on: configBool(config.defaultThinking) }"
                    :aria-checked="configBool(config.defaultThinking)"
                    :disabled="configSaving"
                    @click="toggleConfigBoolean('defaultThinking')"
                  >
                    <span class="knob" />
                  </button>
                </div>

                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.defaultPlanMode') }}
                    <span class="hint">{{ t('settings.defaultPlanModeHint') }}</span>
                  </span>
                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    :class="{ on: configBool(config.defaultPlanMode) }"
                    :aria-checked="configBool(config.defaultPlanMode)"
                    :disabled="configSaving"
                    @click="toggleConfigBoolean('defaultPlanMode')"
                  >
                    <span class="knob" />
                  </button>
                </div>

                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.mergeSkills') }}
                    <span class="hint">{{ t('settings.mergeSkillsHint') }}</span>
                  </span>
                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    :class="{ on: configBool(config.mergeAllAvailableSkills) }"
                    :aria-checked="configBool(config.mergeAllAvailableSkills)"
                    :disabled="configSaving"
                    @click="toggleConfigBoolean('mergeAllAvailableSkills')"
                  >
                    <span class="knob" />
                  </button>
                </div>

                <div v-if="config.telemetry !== undefined" class="row">
                  <span class="rlabel">{{ t('settings.telemetry') }}</span>
                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    :class="{ on: configBool(config.telemetry) }"
                    :aria-checked="configBool(config.telemetry)"
                    :disabled="configSaving"
                    @click="toggleConfigBoolean('telemetry')"
                  >
                    <span class="knob" />
                  </button>
                </div>

                <div v-if="providerEntries.length > 0" class="provider-list">
                  <div v-for="{ id, provider } in providerEntries" :key="id" class="provider-row">
                    <div class="provider-main">
                      <span class="provider-id">{{ id }}</span>
                      <span class="provider-type">{{ provider.type }}</span>
                    </div>
                    <div class="provider-meta">
                      <span :class="['provider-badge', provider.hasApiKey ? 'ok' : 'warn']">
                        {{ provider.hasApiKey ? t('settings.credentialReady') : t('settings.credentialMissing') }}
                      </span>
                      <span v-if="provider.defaultModel" class="provider-model">{{ provider.defaultModel }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <div v-else class="empty-config">
                {{ t('settings.configUnavailable') }}
              </div>
            </section>
          </section>

          <!-- Skills -->
          <section
            v-show="activeTab === 'skills'"
            id="settings-panel-skills"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-skills"
          >
            <section class="sec">
              <h2 class="page-title">{{ t('settings.skills.title') }}</h2>
              <p class="sec-note">{{ t('settings.skills.note') }}</p>
              <input
                v-model="skillQuery"
                type="search"
                class="page-search"
                :placeholder="t('settings.skills.search')"
                :aria-label="t('settings.skills.search')"
              >
              <p class="listing-count">{{ t('settings.skills.count', { count: skillCount }) }}</p>
              <p v-if="skillGroups.length === 0" class="sec-empty">{{ t('settings.skills.empty') }}</p>
              <div v-for="group in skillGroups" :key="group.source" class="listing">
                <h4 class="listing-head">{{ group.source }}</h4>
                <div
                  v-for="skill in group.skills"
                  :key="`${group.source}/${skill.name}`"
                  class="listing-row"
                  :class="{ off: !isSkillEnabled(skill.name) }"
                >
                  <div class="listing-main">
                    <span class="listing-name mono">{{ skill.name }}</span>
                    <span v-if="skill.disableModelInvocation" class="tag">{{ t('settings.skills.slashOnly') }}</span>
                    <span class="listing-desc">{{ skill.description }}</span>
                    <button
                      type="button"
                      class="switch sm"
                      role="switch"
                      :class="{ on: isSkillEnabled(skill.name) }"
                      :aria-checked="isSkillEnabled(skill.name)"
                      :aria-label="t('settings.skills.toggleAria', { name: skill.name })"
                      @click="toggleSkill(skill.name)"
                    >
                      <span class="knob" />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </section>

          <!-- Connectors -->
          <section
            v-show="activeTab === 'connectors'"
            id="settings-panel-connectors"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-connectors"
          >
            <section class="sec">
              <h2 class="page-title">{{ t('settings.connectors.title') }}</h2>
              <p class="sec-note">{{ t('settings.connectors.note') }}</p>
              <p v-if="connectorsLoading" class="sec-empty">{{ t('settings.connectors.loading') }}</p>
              <p v-else-if="(connectors?.length ?? 0) === 0" class="sec-empty">{{ t('settings.connectors.empty') }}</p>
              <div v-else class="listing">
                <div v-for="connector in connectors" :key="connector.id" class="listing-row">
                  <div class="listing-main">
                    <span class="dot" :class="`s-${connector.status}`" aria-hidden="true" />
                    <span class="listing-name">{{ connector.name }}</span>
                    <span class="tag">{{ connector.transport }}</span>
                    <span class="listing-meta">{{ t('settings.connectors.tools', { count: connector.toolCount }) }}</span>
                    <button type="button" class="act" @click="emit('restartConnector', connector.id)">
                      {{ t('settings.connectors.restart') }}
                    </button>
                  </div>
                  <p class="listing-desc">{{ t(`settings.connectors.status.${connector.status}`) }}</p>
                  <p v-if="connector.lastError" class="listing-error">{{ connector.lastError }}</p>
                </div>
              </div>
            </section>
          </section>

          <!-- Hooks -->
          <section
            v-show="activeTab === 'hooks'"
            id="settings-panel-hooks"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-hooks"
          >
            <section class="sec">
              <h2 class="page-title">{{ t('settings.hooks.title') }}</h2>
              <p class="sec-note">{{ t('settings.hooks.note') }}</p>
              <p v-if="hookCount === 0" class="sec-empty">{{ t('settings.hooks.empty') }}</p>
              <template v-else>
                <p class="listing-count">{{ t('settings.hooks.count', { count: hookCount }) }}</p>
                <div v-for="group in hookGroups" :key="group.event" class="listing">
                  <h4 class="listing-head">{{ group.event }}</h4>
                  <div
                    v-for="(hook, index) in group.hooks"
                    :key="`${group.event}/${index}`"
                    class="listing-row"
                  >
                    <div class="listing-main">
                      <span class="listing-name mono">{{ hook.matcher ?? '*' }}</span>
                      <span class="tag">{{ hook.type ?? 'command' }}</span>
                      <span v-if="hook.async === true" class="tag">{{ t('settings.hooks.async') }}</span>
                      <span v-if="hook.timeout !== undefined" class="listing-meta">{{ t('settings.hooks.timeout', { seconds: hook.timeout }) }}</span>
                    </div>
                    <p class="listing-path mono">{{ hook.command ?? hook.url ?? '—' }}</p>
                  </div>
                </div>
              </template>
            </section>
          </section>

          <!-- Usage stats -->
          <section
            v-show="activeTab === 'usage'"
            id="settings-panel-usage"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-usage"
          >
            <section class="sec">
              <h2 class="page-title">{{ t('settings.usage.title') }}</h2>
              <p class="sec-note">{{ t('settings.usage.note') }}</p>
              <div class="stat-grid">
                <div class="stat-card">
                  <span class="stat-label">{{ t('settings.usage.tokens') }}</span>
                  <span class="stat-value">{{ usageStats.tokens }}</span>
                </div>
                <div class="stat-card">
                  <span class="stat-label">{{ t('settings.usage.sessions') }}</span>
                  <span class="stat-value">{{ usageStats.sessions }}</span>
                </div>
                <div class="stat-card">
                  <span class="stat-label">{{ t('settings.usage.turns') }}</span>
                  <span class="stat-value">{{ usageStats.turns }}</span>
                </div>
                <div class="stat-card">
                  <span class="stat-label">{{ t('settings.usage.cost') }}</span>
                  <span class="stat-value">{{ usageStats.cost }}</span>
                </div>
              </div>
              <h4 class="listing-head">{{ t('settings.usage.byModel') }}</h4>
              <p v-if="usageByModel.length === 0" class="sec-empty">{{ t('settings.usage.empty') }}</p>
              <div v-else class="listing">
                <div v-for="entry in usageByModel" :key="entry.model" class="listing-row">
                  <div class="listing-main">
                    <span class="listing-name">{{ entry.model }}</span>
                    <span class="listing-meta">{{ entry.share }}</span>
                  </div>
                  <div class="usage-bar"><span :style="{ width: entry.share }" /></div>
                </div>
              </div>
            </section>
          </section>

          <!-- Advanced -->
          <section
            v-show="activeTab === 'advanced'"
            :id="`settings-panel-advanced`"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-advanced"
          >
            <section class="sec">
              <h3 class="sec-title">{{ t('settings.advanced') }}</h3>
              <div class="row">
                <span class="rlabel">{{ t('sidebar.daemon') }}</span>
                <span class="rvalue mono">{{ daemonEndpoint }}</span>
              </div>
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.exportLog') }}
                  <span v-if="!isTraceEnabled()" class="hint">{{ t('settings.logHint') }}</span>
                </span>
                <button type="button" class="act" @click="exportLog">{{ t('settings.exportLogBtn') }}</button>
              </div>
            </section>
          </section>

          <!-- Experimental -->
          <section
            v-show="activeTab === 'experimental'"
            :id="`settings-panel-experimental`"
            class="panel"
            role="tabpanel"
            aria-labelledby="settings-tab-experimental"
          >
            <section class="sec">
              <h3 class="sec-title">{{ t('settings.beta') }}</h3>
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.betaToc') }}
                  <span class="hint">{{ t('settings.betaTocHint') }}</span>
                </span>
                <button
                  type="button"
                  class="switch"
                  role="switch"
                  :class="{ on: betaToc }"
                  :aria-checked="betaToc"
                  @click="emit('setBetaToc', !betaToc)"
                >
                  <span class="knob" />
                </button>
              </div>
            </section>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: rgba(20, 23, 28, 0.42);
  padding: 12px;
}
/* Settings is a full-window surface, not a small modal: the pages carry long
   lists (skills, connectors, plugins) that a 720px box could not show. */
.dialog {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.dh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.dtitle { font-family: var(--sans); font-size: var(--ui-font-size-lg); font-weight: 600; color: var(--ink); }
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.close-btn:hover { background: var(--soft); color: var(--ink); }

.settings-layout {
  display: flex;
  flex-direction: row;
  min-height: 0;
  flex: 1;
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 140px;
  padding: 10px 8px;
  border-right: 1px solid var(--line);
  background: var(--panel);
  gap: 2px;
  overflow-y: auto;
}
.tab {
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-family: var(--sans);
  font-size: calc(var(--ui-font-size) - 0.5px);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.tab:hover { background: var(--soft); color: var(--ink); }
.tab.on { background: var(--soft); color: var(--blue2); font-weight: 600; }

.body { overflow-y: auto; padding: 6px 16px 16px; flex: 1; }
.panel { display: block; }
.sec { padding: 12px 0; border-bottom: 1px solid var(--line); }
.sec:last-child { border-bottom: none; }
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.sec-title {
  margin: 0 0 10px;
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 3px);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.sec-head .sec-title { margin-bottom: 0; }
.saving {
  flex: none;
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  color: var(--muted);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 34px;
  padding: 3px 0;
}
.rlabel { font-family: var(--sans); font-size: calc(var(--ui-font-size) - 0.5px); color: var(--ink); display: flex; flex-direction: column; gap: 2px; }
.rvalue { font-family: var(--sans); font-size: calc(var(--ui-font-size) - 1.5px); color: var(--muted); max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rvalue.mono { font-family: var(--mono); font-size: var(--ui-font-size-xs); }
.hint { font-size: calc(var(--ui-font-size) - 3px); color: var(--faint); font-family: var(--sans); }

.num-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 0 8px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}
.num-input {
  width: 48px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--ui-font-size-sm);
  text-align: right;
}
.num-unit {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
}

.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.opt {
  border: none;
  background: var(--bg);
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  padding: 5px 12px;
  cursor: pointer;
  border-left: 1px solid var(--line);
}
.opt:first-child { border-left: none; }
.opt:hover { color: var(--ink); }
.opt.on { background: var(--soft); color: var(--blue2); font-weight: 600; }
.opt:disabled { opacity: 0.55; cursor: not-allowed; }

.select-field {
  min-width: 220px;
  max-width: min(320px, 50vw);
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: calc(var(--ui-font-size) - 1.5px);
  padding: 0 8px;
}
.select-field:disabled { opacity: 0.6; cursor: not-allowed; }

.empty-config {
  font-family: var(--sans);
  font-size: calc(var(--ui-font-size) - 1px);
  color: var(--muted);
  padding: 4px 0;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}
.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel2);
}
.provider-main,
.provider-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.provider-main { flex: 1; }
.provider-meta { flex: none; max-width: 45%; }
.provider-id,
.provider-model {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.provider-id {
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  color: var(--ink);
}
.provider-type {
  flex: none;
  font-family: var(--mono);
  font-size: max(10px, calc(var(--ui-font-size) - 4px));
  color: var(--muted);
}
.provider-model {
  font-family: var(--mono);
  font-size: max(10px, calc(var(--ui-font-size) - 4px));
  color: var(--muted);
}
.provider-badge {
  flex: none;
  border-radius: 999px;
  padding: 2px 7px;
  font-family: var(--mono);
  font-size: max(10px, calc(var(--ui-font-size) - 4px));
}
.provider-badge.ok {
  background: color-mix(in srgb, var(--ok) 12%, var(--bg));
  color: var(--ok);
}
.provider-badge.warn {
  background: color-mix(in srgb, var(--warn) 12%, var(--bg));
  color: var(--warn);
}

.toggle-row { cursor: pointer; }
.switch {
  flex: none;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel2);
  position: relative;
  cursor: pointer;
  transition: background 0.16s;
  padding: 0;
}
.switch.on { background: var(--blue); border-color: var(--blue); }
.switch:disabled { opacity: 0.5; cursor: not-allowed; }
.knob {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.16s;
}
.switch.on .knob { transform: translateX(18px); }

.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
/* Compact switch for the per-skill rows. */
.switch.sm { width: 30px; height: 17px; }
.switch.sm .knob { width: 13px; height: 13px; }
.switch.sm.on .knob { transform: translateX(13px); }

/* The settings pages: a large page title, an optional search, then card rows. */
.page-title {
  margin: 0 0 6px;
  font-size: calc(var(--ui-font-size) + 10px);
  font-weight: 700;
  color: var(--ink);
}
.page-search {
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 12px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: var(--ui-font-size);
}
.listing-count {
  margin: 0 0 8px;
  font-size: calc(var(--ui-font-size) - 2px);
  color: var(--faint);
}

/* Usage stats: a card per headline number, then a share bar per model. */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin-bottom: 6px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
.stat-label {
  font-size: calc(var(--ui-font-size) - 2px);
  color: var(--muted);
}
.stat-value {
  font-size: calc(var(--ui-font-size) + 8px);
  font-weight: 700;
  color: var(--ink);
}
.usage-bar {
  margin-top: 6px;
  height: 4px;
  border-radius: 999px;
  background: var(--line2);
  overflow: hidden;
}
.usage-bar span {
  display: block;
  height: 100%;
  background: var(--blue);
}

/* Nav group heading above each block of tabs. */
.tab-group {
  padding: 12px 10px 4px;
  font-size: calc(var(--ui-font-size) - 3px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--faint);
}

/* Skills and connectors pages: one card row per entry. */
.sec-note {
  margin: -4px 0 12px;
  font-size: calc(var(--ui-font-size) - 2px);
  color: var(--muted);
}
.sec-empty {
  margin: 0;
  font-size: calc(var(--ui-font-size) - 1px);
  color: var(--faint);
}
.listing {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.listing-head {
  margin: 14px 0 6px;
  font-size: calc(var(--ui-font-size) - 2px);
  font-weight: 600;
  color: var(--muted);
}
.listing-row {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
}
/* A disabled skill stays readable but clearly recedes. */
.listing-row.off .listing-name,
.listing-row.off .listing-desc {
  color: var(--faint);
}
.listing-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.listing-name {
  font-weight: 600;
  color: var(--ink);
}
.listing-meta {
  margin-left: auto;
  font-size: calc(var(--ui-font-size) - 2px);
  color: var(--muted);
}
.listing-desc,
.listing-path,
.listing-error {
  margin: 3px 0 0;
  font-size: calc(var(--ui-font-size) - 2px);
  color: var(--muted);
}
/* On the skills page the description shares the row with the name, so it
   truncates instead of wrapping — the switch must stay on the same line. */
.listing-main .listing-desc {
  margin: 0 0 0 auto;
  padding-left: 10px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listing-path {
  color: var(--faint);
  word-break: break-all;
}
.listing-error {
  color: var(--err);
}
.tag {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--line);
  font-size: calc(var(--ui-font-size) - 3px);
  color: var(--muted);
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--faint);
}
.dot.s-connected { background: var(--ok); }
.dot.s-connecting { background: var(--warn); }
.dot.s-error { background: var(--err); }

.act {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: calc(var(--ui-font-size) - 1.5px);
  padding: 6px 12px;
  cursor: pointer;
}
.act:hover { background: var(--soft); border-color: var(--bd); }
.act.signin { background: var(--blue); color: var(--bg); border-color: var(--blue); }
.act.signin:hover { background: var(--blue2); }
.act.danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 30%, var(--line)); }
.act.danger:hover { background: color-mix(in srgb, var(--err) 8%, var(--bg)); }

@media (max-width: 640px) {
  .backdrop {
    padding:
      max(12px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      max(12px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
  }
  .dialog {
    height: 100%;
  }
  .settings-layout { flex-direction: column; }
  .settings-tabs {
    flex-direction: row;
    width: auto;
    border-right: none;
    border-bottom: 1px solid var(--line);
    padding: 8px 12px;
    gap: 6px;
    overflow-x: auto;
  }
  .tab { white-space: nowrap; }
  .row {
    align-items: flex-start;
    flex-direction: column;
  }
  .select-field {
    width: 100%;
    max-width: none;
  }
  .provider-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .provider-meta {
    max-width: 100%;
    flex-wrap: wrap;
  }
}
</style>
