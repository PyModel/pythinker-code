<!-- apps/pythinker-web/src/components/settings/SettingsDialog.vue -->
<!-- The app's dedicated Settings page (modal). Consolidates what used to be
     scattered in the sidebar account popover: appearance, account,
     connection, plus notifications and the troubleshooting-log export. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import { getPythinkerWebApi } from '../../api';
import type { AppConfig, AppModel, AppSession } from '../../api/types';
import { useDialogFocus } from '../../composables/useDialogFocus';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import {
  uiFontScaleForSize,
  uiFontScaleOptions,
  uiFontSizeForScale,
} from '../../composables/client/useAppearance';
import { readPythinkerApiConfig } from '../../api/config';
import { downloadTraceLog, isTraceEnabled } from '../../debug/trace';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { Accent, ColorScheme } from '../../composables/usePythinkerWebClient';
import Dialog from '../ui/Dialog.vue';
import Switch from '../ui/Switch.vue';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Select from '../ui/Select.vue';
import Tooltip from '../ui/Tooltip.vue';
import type { IconName } from '../../lib/icons';
import ProvidersPanel from './ProvidersPanel.vue';
import SecondaryModelPicker from './SecondaryModelPicker.vue';

const { t } = useI18n();

const props = defineProps<{
  colorScheme: ColorScheme;
  accent: Accent;
  uiFontSize: number;
  authReady: boolean;
  accountModel?: string | null;
  /** Browser-notification-on-completion preference. */
  notify: boolean;
  /** Browser-notification-on-question (needs answer) preference. */
  notifyQuestion: boolean;
  /** Browser-notification-on-approval preference. */
  notifyApproval: boolean;
  /** OS permission state ('default' | 'granted' | 'denied') for the hint. */
  notifyPermission?: string;
  /** Play-a-sound-on-completion preference. */
  sound: boolean;
  /** Conversation outline (proportional bubbles, viewport indicator, hover tooltip). */
  conversationToc?: boolean;
  /** Global daemon config from GET /api/v1/config. Secrets are redacted server-side. */
  config?: AppConfig | null;
  /** Models from the daemon catalog, used to label default-model choices. */
  models?: AppModel[];
  /** True while POST /api/v1/config is saving. */
  configSaving?: boolean;
  /** Server version reported by GET /api/v1/meta. */
  serverVersion?: string;
  /** Backend engine generation from GET /api/v1/meta ('v1' legacy, 'v2' agent-gateway). */
  backend?: 'v1' | 'v2';
  initialTab?: 'general' | 'providers';
}>();

const emit = defineEmits<{
  setColorScheme: [colorScheme: ColorScheme];
  setAccent: [accent: Accent];
  setUiFontSize: [size: number];
  setNotify: [on: boolean];
  setNotifyQuestion: [on: boolean];
  setNotifyApproval: [on: boolean];
  setSound: [on: boolean];
  setConversationToc: [on: boolean];
  logout: [];
  openOnboarding: [];
  updateConfig: [patch: Partial<AppConfig>];
  close: [];
}>();

type SettingsTab = 'general' | 'agent' | 'account' | 'providers' | 'advanced' | 'lab' | 'archived';

const activeTab = ref<SettingsTab>(props.initialTab ?? 'general');
const fontScale = computed(() => uiFontScaleForSize(props.uiFontSize));

const tabs: { id: SettingsTab; labelKey: string; icon: IconName }[] = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: 'sliders' },
  { id: 'agent', labelKey: 'settings.tabs.agent', icon: 'robot' },
  { id: 'account', labelKey: 'settings.tabs.account', icon: 'user' },
  { id: 'providers', labelKey: 'settings.tabs.providers', icon: 'bolt' },
  { id: 'advanced', labelKey: 'settings.tabs.advanced', icon: 'microscope' },
  { id: 'lab', labelKey: 'settings.tabs.lab', icon: 'flask' },
  { id: 'archived', labelKey: 'settings.tabs.archived', icon: 'archive' },
];

const serverAddress = readPythinkerApiConfig().serverHttpUrl;
const appVersion =
  typeof __PYTHINKER_WEB_VERSION__ === 'string' && __PYTHINKER_WEB_VERSION__.trim()
    ? __PYTHINKER_WEB_VERSION__
    : '0.0.0-dev';
const serverMeta = ref<{ serverVersion: string; serverId: string; backend: 'v1' | 'v2' } | null>(null);
const resolvedServerVersion = computed(() => serverMeta.value?.serverVersion || props.serverVersion || '-');
const resolvedBackend = computed(() => serverMeta.value?.backend ?? props.backend ?? 'v1');
const backendLabel = computed(() =>
  resolvedBackend.value === 'v2' ? 'agent-gateway' : 'server',
);
const diagnosticsCopied = ref(false);
const providerDirty = ref(false);
const providerDiscardToken = ref(0);
const { confirm, current: currentConfirm } = useConfirmDialog();
const permissionModes = ['manual', 'yolo', 'auto'] as const;
// Reuse the Composer's permission labels (status.permission*) so the
// default-permission names stay in sync with the toolbar.
const permissionLabelKey: Record<(typeof permissionModes)[number], string> = {
  manual: 'status.permissionManual',
  auto: 'status.permissionAuto',
  yolo: 'status.permissionYolo',
};

// Modal focus: move focus into the dialog on open, restore it to the opener on
// close (Escape-to-close is handled below).
const dialogRef = ref<HTMLElement | null>(null);
useDialogFocus(dialogRef);

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && currentConfirm.value === null) void requestClose();
}
onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  void loadServerMeta();
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
});

async function loadServerMeta(): Promise<void> {
  try {
    serverMeta.value = await getPythinkerWebApi().getMeta();
  } catch {
    serverMeta.value = null;
  }
}

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
  for (const [provider, list] of map) {
    map.set(provider, list.toSorted((a, b) => a.label.localeCompare(b.label)));
  }
  return Array.from(map.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([provider, options]) => ({ provider, options }));
});

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

function setDefaultModel(value: string): void {
  if (!value || value === props.config?.defaultModel) return;
  emit('updateConfig', { defaultModel: value });
}

function setDefaultPermissionMode(mode: 'manual' | 'auto' | 'yolo'): void {
  if (mode === defaultPermissionMode.value) return;
  emit('updateConfig', { defaultPermissionMode: mode });
}

function toggleConfigBoolean(key: 'defaultPlanMode' | 'mergeAllAvailableSkills'): void {
  const current = props.config?.[key];
  emit('updateConfig', { [key]: !configBool(current) } as Partial<AppConfig>);
}

// "Default thinking" lives at config.thinking.enabled on the daemon — the legacy
// top-level defaultThinking field was removed. Read/write it there so the toggle
// actually persists (the old field was silently stripped by the server).
//
// Mirror the core resolver: thinking is on unless explicitly disabled
// (enabled === false). An absent thinking section — or one with an effort but no
// enabled field — falls through to the model/default effort (on for
// thinking-capable models), so the toggle reflects that as on.
function thinkingEnabled(): boolean {
  const thinking = props.config?.thinking;
  if (!thinking || typeof thinking !== 'object') return true;
  return (thinking as { enabled?: boolean }).enabled !== false;
}

function toggleDefaultThinking(): void {
  emit('updateConfig', { thinking: { enabled: !thinkingEnabled() } } as Partial<AppConfig>);
}

// Telemetry is opt-out: undefined and `true` both mean enabled, only explicit
// `false` disables it. Toggle based on that effective state so an unset value
// (displayed as on) flips to `false` instead of writing a redundant `true`.
function toggleTelemetry(): void {
  const enabled = props.config?.telemetry !== false;
  emit('updateConfig', { telemetry: !enabled } as Partial<AppConfig>);
}

async function setTab(tab: SettingsTab): Promise<void> {
  if (tab === activeTab.value) return;
  if (!(await confirmDiscardProviderChanges())) return;
  activeTab.value = tab;
}

async function confirmDiscardProviderChanges(): Promise<boolean> {
  if (!providerDirty.value) return true;
  const discard = await confirm({
    title: t('providers.unsavedTitle'),
    message: t('providers.unsavedBody'),
    confirmLabel: t('providers.unsavedDiscard'),
    cancelLabel: t('providers.unsavedStay'),
    variant: 'danger',
  });
  if (discard) {
    providerDirty.value = false;
    providerDiscardToken.value += 1;
  }
  return discard;
}

async function requestClose(): Promise<void> {
  if (await confirmDiscardProviderChanges()) emit('close');
}

function diagnosticsText(): string {
  return [
    `App version: ${appVersion}`,
    `Server version: ${resolvedServerVersion.value}`,
    `Backend: ${resolvedBackend.value}`,
    `Server address: ${serverAddress}`,
    `Server ID: ${serverMeta.value?.serverId || '-'}`,
    `User agent: ${typeof navigator === 'undefined' ? '-' : navigator.userAgent}`,
  ].join('\n');
}

async function copyDiagnostics(): Promise<void> {
  diagnosticsCopied.value = await copyTextToClipboard(diagnosticsText());
}

// Per-value copy buttons in the advanced tab: flash the check state for 1.5s
// after a successful copy (reference `copyServerVersion`/`copyServerAddress`).
const serverVersionCopied = ref(false);
const serverAddressCopied = ref(false);
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCopyFlashReset(): void {
  if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
  copyFlashTimer = setTimeout(() => {
    serverVersionCopied.value = false;
    serverAddressCopied.value = false;
    copyFlashTimer = null;
  }, 1500);
}

async function copyServerVersion(): Promise<void> {
  if (!(await copyTextToClipboard(resolvedServerVersion.value))) return;
  serverVersionCopied.value = true;
  scheduleCopyFlashReset();
}

async function copyServerAddress(): Promise<void> {
  if (!(await copyTextToClipboard(serverAddress))) return;
  serverAddressCopied.value = true;
  scheduleCopyFlashReset();
}

// Secondary (subagent) model — the Agent tab section mirrors the reference:
// it renders only while the daemon's `secondary-model` experimental flag is
// on, and writes `config.secondaryModel` ({ model, defaultEffort }) through
// the regular config update path (wire key `secondary_model`).
const secondaryModelFlagEnabled = computed(() => experimentalFlag('secondary-model'));
const secondaryModel = computed(() => props.config?.secondaryModel?.model ?? '');
const secondaryModelEffort = computed(() => props.config?.secondaryModel?.defaultEffort ?? '');
const modelInfoById = computed<Record<string, AppModel>>(() =>
  Object.fromEntries((props.models ?? []).map((model) => [model.id, model])),
);

function experimentalFlag(flag: string): boolean {
  return props.config?.experimental?.[flag] === true;
}

function toggleExperimental(flag: string, value: boolean): void {
  const next = { ...props.config?.experimental, [flag]: value };
  emit('updateConfig', { experimental: next } as Partial<AppConfig>);
}

function setSecondaryModel(selection: { model: string; effort?: string }): void {
  const next = selection.effort
    ? { model: selection.model, defaultEffort: selection.effort }
    : { model: selection.model };
  if (next.model === secondaryModel.value && (selection.effort ?? '') === secondaryModelEffort.value) {
    return;
  }
  emit('updateConfig', { secondaryModel: next } as Partial<AppConfig>);
}

function setFontScale(scale: string): void {
  const size = uiFontSizeForScale(scale);
  if (size !== undefined) emit('setUiFontSize', size);
}

// ---------------------------------------------------------------------------
// Archived-sessions tab — its own list state (server-side `archived_only`
// filter), kept separate from the per-workspace active list. Search, workspace
// filter and sort all run client-side over the loaded pages. Restore goes
// through the composable so the sidebar list updates automatically.
// ---------------------------------------------------------------------------
const client = usePythinkerWebClient();

const archivedItems = ref<AppSession[]>([]);
const archivedLoading = ref(false);
const archivedLoaded = ref(false);
const archiveQuery = ref('');
const archiveWsFilter = ref<string>('all'); // 'all' | cwd
const archiveSort = ref<'archived-desc' | 'created-desc' | 'name-asc'>('archived-desc');

// Load every archived session once when the tab opens (no frontend pagination).
// Search, sort and the workspace filter then run client-side over the full set,
// so results are always global and there is no empty-page / cursor bookkeeping
// to get wrong. The user waits a moment on first open in exchange for simplicity.
const ARCHIVED_PAGE_SIZE = 100;

async function loadAllArchived(): Promise<void> {
  if (archivedLoading.value || archivedLoaded.value) return;
  archivedLoading.value = true;
  try {
    const all: AppSession[] = [];
    let beforeId: string | undefined;
    for (;;) {
      const page = await client.loadArchivedSessions({ beforeId, pageSize: ARCHIVED_PAGE_SIZE });
      all.push(...page.items);
      if (!page.hasMore || page.items.length === 0) break;
      const next = page.items.at(-1)?.id;
      if (next === undefined) break;
      beforeId = next;
    }
    archivedItems.value = all;
    archivedLoaded.value = true;
  } catch (err) {
    console.warn('loadAllArchived failed', err);
  } finally {
    archivedLoading.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab === 'archived' && !archivedLoaded.value) {
    void loadAllArchived();
  }
});

const archiveWorkspaces = computed<string[]>(() => {
  const set = new Set<string>();
  for (const s of archivedItems.value) set.add(s.cwd);
  return Array.from(set).toSorted((a, b) => a.localeCompare(b));
});

const filteredArchived = computed<AppSession[]>(() => {
  const q = archiveQuery.value.trim().toLowerCase();
  // Defensive invariant: this panel must only ever render archived sessions,
  // even if an older server ignores `archived_only` and falls back to the
  // default (unarchived) list. Filter again on the client.
  let rows = archivedItems.value.filter((s) => s.archived === true);
  if (archiveWsFilter.value !== 'all') {
    rows = rows.filter((s) => s.cwd === archiveWsFilter.value);
  }
  if (q) rows = rows.filter((s) => s.title.toLowerCase().includes(q));
  if (archiveSort.value === 'archived-desc') {
    return rows.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  if (archiveSort.value === 'created-desc') {
    return rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return rows.toSorted((a, b) => a.title.localeCompare(b.title, 'en'));
});

const groupedArchived = computed<{ cwd: string; items: AppSession[] }[]>(() => {
  const map = new Map<string, AppSession[]>();
  for (const s of filteredArchived.value) {
    const list = map.get(s.cwd) ?? [];
    list.push(s);
    map.set(s.cwd, list);
  }
  return Array.from(map.entries()).map(([cwd, items]) => ({ cwd, items }));
});

async function onRestore(id: string): Promise<void> {
  const ok = await client.restoreSession(id);
  if (ok) {
    archivedItems.value = archivedItems.value.filter((s) => s.id !== id);
  }
}

function archiveTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<template>
  <Dialog :open="true" :close-on-esc="false" :title="t('settings.title')" size="xl" height="fixed" :padded="false" @close="requestClose">
    <div ref="dialogRef" class="sd">
      <nav class="settings-tabs" role="tablist" :aria-label="t('settings.title')">
        <button
          v-for="tb in tabs"
          :key="tb.id"
          type="button"
          class="tab"
          role="tab"
          :aria-selected="activeTab === tb.id"
          :class="{ on: activeTab === tb.id }"
          @click="setTab(tb.id)"
        >
          <Icon :name="tb.icon" size="sm" />
          {{ t(tb.labelKey) }}
        </button>
      </nav>

      <div class="body">
        <!-- General: Appearance + Notifications -->
        <section v-show="activeTab === 'general'" class="panel">
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.appearance') }}</h3>
            <div class="row">
              <span class="rlabel">{{ t('theme.colorSchemeLabel') }}</span>
              <SegmentedControl
                :model-value="colorScheme"
                :options="[
                  { value: 'light', label: t('theme.light') },
                  { value: 'dark', label: t('theme.dark') },
                  { value: 'system', label: t('theme.system') },
                ]"
                @update:model-value="emit('setColorScheme', $event as ColorScheme)"
              />
            </div>
            <div class="row">
              <span class="rlabel">{{ t('theme.accentLabel') }}</span>
              <SegmentedControl
                :model-value="accent"
                :options="[
                  { value: 'blue', label: t('theme.accentBlue') },
                  { value: 'mono', label: t('theme.accentBlack') },
                ]"
                @update:model-value="emit('setAccent', $event as Accent)"
              />
            </div>
            <div class="row">
              <span class="rlabel">{{ t('settings.uiFontSize') }}</span>
              <SegmentedControl
                :model-value="fontScale"
                :options="uiFontScaleOptions"
                :aria-label="t('settings.uiFontSize')"
                @update:model-value="setFontScale"
              />
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.conversationToc') }}
                <span class="hint">{{ t('settings.conversationTocHint') }}</span>
              </span>
              <Switch
                :model-value="conversationToc ?? true"
                :label="t('settings.conversationToc')"
                @update:model-value="emit('setConversationToc', $event)"
              />
            </div>
          </section>

          <section class="sec">
            <h3 class="sec-title">{{ t('settings.notifications') }}</h3>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.notifyOnComplete') }}
                <span v-if="notifyPermission === 'denied'" class="hint">{{ t('settings.notifyDenied') }}</span>
              </span>
              <Switch
                :model-value="notify"
                :disabled="notifyPermission === 'denied'"
                :label="t('settings.notifyOnComplete')"
                @update:model-value="emit('setNotify', $event)"
              />
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.notifyOnQuestion') }}
                <span v-if="notifyPermission === 'denied'" class="hint">{{ t('settings.notifyDenied') }}</span>
              </span>
              <Switch
                :model-value="notifyQuestion"
                :disabled="notifyPermission === 'denied'"
                :label="t('settings.notifyOnQuestion')"
                @update:model-value="emit('setNotifyQuestion', $event)"
              />
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.notifyOnApproval') }}
                <span v-if="notifyPermission === 'denied'" class="hint">{{ t('settings.notifyDenied') }}</span>
              </span>
              <Switch
                :model-value="notifyApproval"
                :disabled="notifyPermission === 'denied'"
                :label="t('settings.notifyOnApproval')"
                @update:model-value="emit('setNotifyApproval', $event)"
              />
            </div>
            <div class="row">
              <span class="rlabel">{{ t('settings.soundOnComplete') }}</span>
              <Switch
                :model-value="sound"
                :label="t('settings.soundOnComplete')"
                @update:model-value="emit('setSound', $event)"
              />
            </div>
          </section>
        </section>

        <!-- Account -->
        <section v-show="activeTab === 'account'" class="panel">
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.account') }}</h3>
            <!-- No managed account in this distribution: the account tab shows
                 provider readiness and routes to the provider manager. -->
            <div class="row">
              <span class="rlabel">{{ authReady ? t('settings.providers') : t('sidebar.notSignedIn') }}</span>
              <Tooltip :text="accountModel">
                <span v-if="authReady && accountModel" class="rvalue">{{ accountModel }}</span>
              </Tooltip>
            </div>
            <div class="actions">
              <Button variant="secondary" size="sm" @click="emit('openOnboarding'); emit('close')">{{ t('onboarding.reopen') }}</Button>
              <Button variant="primary" size="sm" @click="setTab('providers')">{{ t('settings.manageProviders') }}</Button>
            </div>
          </section>
        </section>

        <!-- Providers -->
        <section v-show="activeTab === 'providers'" class="panel">
          <ProvidersPanel
            :discard-token="providerDiscardToken"
            @dirty-change="providerDirty = $event"
          />
        </section>

        <!-- Agent defaults -->
        <section v-show="activeTab === 'agent'" class="panel">
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
                <div v-if="modelGroups.length > 0" class="select-wrap">
                  <Select
                    :model-value="config.defaultModel ?? ''"
                    :disabled="configSaving"
                    :aria-label="t('settings.defaultModel')"
                    @update:model-value="setDefaultModel"
                  >
                    <option v-if="!config.defaultModel" value="" disabled>{{ t('settings.noDefaultModel') }}</option>
                    <optgroup v-for="group in modelGroups" :key="group.provider" :label="group.provider">
                      <option v-for="model in group.options" :key="model.id" :value="model.id">
                        {{ model.label }}
                      </option>
                    </optgroup>
                  </Select>
                </div>
                <span v-else class="rvalue mono">{{ config.defaultModel ?? t('settings.noDefaultModel') }}</span>
              </div>

              <div class="row">
                <span class="rlabel">
                  {{ t('settings.defaultPermission') }}
                  <span class="hint">{{ t('settings.defaultPermissionHint') }}</span>
                </span>
                <SegmentedControl
                  :model-value="defaultPermissionMode"
                  :options="permissionModes.map((m) => ({ value: m, label: t(permissionLabelKey[m]) }))"
                  @update:model-value="setDefaultPermissionMode($event as 'manual' | 'auto' | 'yolo')"
                />
              </div>

              <div class="row">
                <span class="rlabel">
                  {{ t('settings.defaultThinking') }}
                  <span class="hint">{{ t('settings.defaultThinkingHint') }}</span>
                </span>
                <Switch
                  :model-value="thinkingEnabled()"
                  :disabled="configSaving"
                  :label="t('settings.defaultThinking')"
                  @update:model-value="toggleDefaultThinking()"
                />
              </div>

              <div class="row">
                <span class="rlabel">
                  {{ t('settings.defaultPlanMode') }}
                  <span class="hint">{{ t('settings.defaultPlanModeHint') }}</span>
                </span>
                <Switch
                  :model-value="configBool(config.defaultPlanMode)"
                  :disabled="configSaving"
                  :label="t('settings.defaultPlanMode')"
                  @update:model-value="toggleConfigBoolean('defaultPlanMode')"
                />
              </div>

              <div class="row">
                <span class="rlabel">
                  {{ t('settings.mergeSkills') }}
                  <span class="hint">{{ t('settings.mergeSkillsHint') }}</span>
                </span>
                <Switch
                  :model-value="configBool(config.mergeAllAvailableSkills)"
                  :disabled="configSaving"
                  :label="t('settings.mergeSkills')"
                  @update:model-value="toggleConfigBoolean('mergeAllAvailableSkills')"
                />
              </div>

              <section v-if="secondaryModelFlagEnabled" class="sec">
                <h3 class="sec-title">{{ t('settings.secondaryModelSection') }}</h3>
                <div class="row">
                  <span class="rlabel">
                    {{ t('settings.secondaryModel') }}
                    <span class="hint">{{ t('settings.secondaryModelHint') }}</span>
                  </span>
                  <SecondaryModelPicker
                    v-if="modelGroups.length > 0"
                    :model-value="secondaryModel"
                    :effort="secondaryModelEffort"
                    :groups="modelGroups"
                    :model-info-by-id="modelInfoById"
                    :disabled="configSaving"
                    @select="setSecondaryModel"
                  />
                  <span v-else class="rvalue">{{ t('settings.noSecondaryModel') }}</span>
                </div>
              </section>
            </template>

            <div v-else class="empty-config">
              {{ t('settings.configUnavailable') }}
            </div>
          </section>
        </section>

        <!-- Advanced: version, diagnostics + data/privacy -->
        <section v-show="activeTab === 'advanced'" class="panel">
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.versionAndUpdates') }}</h3>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.appVersion') }}
                <span class="hint">{{ t('settings.appVersionHint') }}</span>
              </span>
              <span class="rvalue mono">{{ appVersion }}</span>
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.serverVersion') }}
                <span class="hint">{{ t('settings.serverVersionHint') }}</span>
              </span>
              <span class="value-wrap">
                <span class="rvalue mono">{{ resolvedServerVersion }}</span>
                <IconButton
                  size="sm"
                  :label="serverVersionCopied ? t('settings.copied') : t('settings.copyServerVersion')"
                  :data-testid="'copy-server-version'"
                  @click="copyServerVersion"
                >
                  <Icon :name="serverVersionCopied ? 'check' : 'copy'" size="sm" />
                </IconButton>
              </span>
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.serverAddress') }}
                <span class="hint">{{ t('settings.serverAddressHint') }}</span>
              </span>
              <span class="value-wrap">
                <span class="rvalue mono">{{ serverAddress }}</span>
                <IconButton
                  size="sm"
                  :label="serverAddressCopied ? t('settings.copied') : t('settings.copyServerAddress')"
                  :data-testid="'copy-server-address'"
                  @click="copyServerAddress"
                >
                  <Icon :name="serverAddressCopied ? 'check' : 'copy'" size="sm" />
                </IconButton>
              </span>
            </div>
            <div class="row">
              <span class="rlabel">{{ t('settings.backend') }}</span>
              <span class="rvalue mono">{{ backendLabel }}</span>
            </div>
          </section>
          <section v-if="config" class="sec">
            <div v-if="config" class="row">
              <span class="rlabel">
                {{ t('settings.telemetry') }}
                <span class="hint">{{ t('settings.telemetryHint') }}</span>
                <span class="hint">{{ t('settings.telemetryRestartHint') }}</span>
              </span>
              <Switch
                :model-value="config.telemetry !== false"
                :disabled="configSaving"
                :label="t('settings.telemetry')"
                @update:model-value="toggleTelemetry()"
              />
            </div>
          </section>
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.diagnostics') }}</h3>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.exportLog') }}
                <span v-if="!isTraceEnabled()" class="hint">{{ t('settings.logHint') }}</span>
              </span>
              <Button variant="secondary" size="sm" @click="exportLog">{{ t('settings.exportLogBtn') }}</Button>
            </div>
            <div class="row">
              <span class="rlabel">{{ t('settings.copyDetails') }}</span>
              <Button data-testid="copy-diagnostics" variant="secondary" size="sm" @click="copyDiagnostics">
                {{ diagnosticsCopied ? t('settings.copied') : t('settings.copyDetails') }}
              </Button>
            </div>
          </section>
        </section>

        <!-- Lab: experimental flags. -->
        <section v-show="activeTab === 'lab'" class="panel">
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.tabs.lab') }}</h3>
            <template v-if="config">
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.lab.sidebarTabs') }}
                  <span class="hint">{{ t('settings.lab.sidebarTabsHint') }}</span>
                </span>
                <Switch
                  :model-value="experimentalFlag('sidebarTabs')"
                  :disabled="configSaving"
                  :label="t('settings.lab.sidebarTabs')"
                  @update:model-value="toggleExperimental('sidebarTabs', $event)"
                />
              </div>
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.lab.secondaryModel') }}
                  <span class="hint">{{ t('settings.lab.secondaryModelHint') }}</span>
                </span>
                <Switch
                  :model-value="experimentalFlag('secondary-model')"
                  :disabled="configSaving"
                  :label="t('settings.lab.secondaryModel')"
                  @update:model-value="toggleExperimental('secondary-model', $event)"
                />
              </div>
            </template>
            <div v-else class="empty-config">
              {{ t('settings.configUnavailable') }}
            </div>
          </section>
        </section>

        <!-- Archived sessions -->
        <section v-show="activeTab === 'archived'" class="panel">
          <div class="panel-head">
            <div class="panel-kicker">Archived sessions</div>
            <h4 class="panel-title">{{ t('settings.archivedTitle') }}</h4>
            <p class="panel-desc">{{ t('settings.archivedDesc') }}</p>
          </div>

          <div class="archive-toolbar">
            <label class="archive-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input v-model="archiveQuery" :placeholder="t('settings.archivedSearch')" />
            </label>
            <Select
              :model-value="archiveWsFilter"
              size="sm"
              :aria-label="t('settings.archivedAllWorkspaces')"
              @update:model-value="archiveWsFilter = $event as string"
            >
              <option value="all">{{ t('settings.archivedAllWorkspaces') }}</option>
              <option v-for="ws in archiveWorkspaces" :key="ws" :value="ws">{{ ws }}</option>
            </Select>
            <SegmentedControl
              size="sm"
              :model-value="archiveSort"
              :options="[
                { value: 'archived-desc', label: t('settings.archivedSortArchived') },
                { value: 'created-desc', label: t('settings.archivedSortCreated') },
                { value: 'name-asc', label: t('settings.archivedSortName') },
              ]"
              @update:model-value="archiveSort = $event as 'archived-desc' | 'created-desc' | 'name-asc'"
            />
          </div>

          <div v-if="archivedLoading" class="archive-empty">
            {{ t('settings.archivedLoadingAll') }}
          </div>

          <template v-else>
            <div v-if="groupedArchived.length > 0" class="archive-list">
              <section v-for="g in groupedArchived" :key="g.cwd" class="archive-card">
                <div class="archive-workspace">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6l2 2h10v9H3z" /><path d="M3 7V5h6l2 2" /></svg>
                  <span class="path">{{ g.cwd }}</span>
                  <span class="count">{{ t('settings.archivedSessionsCount', { count: g.items.length }) }}</span>
                </div>
                <div class="setting-card">
                  <div v-for="s in g.items" :key="s.id" class="archive-row">
                    <div class="archive-meta">
                      <div class="archive-name">{{ s.title }}</div>
                      <div class="archive-time">{{ t('settings.archivedAt', { time: archiveTime(s.updatedAt) }) }}</div>
                    </div>
                    <Button variant="secondary" size="sm" @click="onRestore(s.id)">{{ t('settings.archivedRestore') }}</Button>
                  </div>
                </div>
              </section>
            </div>
            <div v-else class="archive-empty">
              {{ archivedItems.length === 0 ? t('settings.archivedEmpty') : t('settings.archivedNoMatch') }}
            </div>
          </template>
        </section>

      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.sd { display: flex; flex-direction: row; min-height: 0; height: 100%; }

.settings-tabs {
  display: flex;
  flex-direction: column;
  flex: none;
  width: 148px;
  padding: var(--space-2);
  gap: 2px;
  overflow-y: auto;
}
.tab {
  text-align: left;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}
.tab .ui-icon { flex: none; color: var(--color-text-faint); }
.tab.on .ui-icon { color: var(--color-accent); }
.tab:hover { background: var(--color-surface-sunken); color: var(--color-text); }
.tab.on { background: var(--color-accent-soft); color: var(--color-accent); font-weight: var(--weight-medium); }
.tab:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }

.body { display: flex; flex-direction: column; overflow-y: auto; padding: var(--space-2) var(--space-5) var(--space-5) var(--space-6); flex: 1; min-width: 0; }
.panel { display: block; }
.sec { padding: var(--space-4) 0; border-bottom: 1px solid var(--color-line); }
.sec:last-child { border-bottom: none; }
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.sec-title {
  margin: 0 0 var(--space-3);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.sec-head .sec-title { margin-bottom: 0; }
.saving {
  flex: none;
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 38px;
  padding: var(--space-1) 0;
}
.rlabel {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  color: var(--color-text);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rvalue {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rvalue.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.value-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 60%;
  min-width: 0;
  flex: none;
}
.value-wrap .rvalue { max-width: 100%; }
.hint { font-family: var(--font-ui); font-size: var(--text-xs); color: var(--color-text-faint); }

.select-wrap { min-width: 220px; max-width: min(320px, 50vw); flex: none; }

.empty-config {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  color: var(--color-text-muted);
  padding: var(--space-1) 0;
}

.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }

@media (max-width: 640px) {
  .sd { flex-direction: column; }
  .settings-tabs {
    flex-direction: row;
    width: auto;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-1);
    overflow-x: auto;
  }
  .tab { white-space: nowrap; flex: none; }
  .row {
    align-items: flex-start;
    flex-direction: column;
  }
  .select-wrap {
    width: 100%;
    max-width: none;
  }
}
/* Archived-sessions tab */
.setting-card { border: 1px solid var(--color-line); border-radius: var(--radius-xl); overflow: hidden; background: var(--color-bg); }
.panel-head { margin-bottom: var(--space-4); }
.panel-kicker { font-size: var(--text-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--color-text-faint); margin-bottom: var(--space-1); }
.panel-title { margin: 0 0 var(--space-2); font-family: var(--font-ui); font-size: var(--text-2xl); font-weight: var(--weight-semibold); letter-spacing: -0.01em; color: var(--color-text); }
.panel-desc { margin: 0; font-family: var(--font-ui); font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--color-text-muted); max-width: 560px; }
.archive-toolbar { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); flex-wrap: wrap; }
.archive-search { flex: 1; min-width: 200px; height: 36px; display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); border-radius: var(--radius-md); border: 1px solid var(--color-line); color: var(--color-text-faint); font-size: var(--text-sm); background: var(--color-surface-raised); transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out); }
.archive-search:focus-within { border-color: var(--color-accent); box-shadow: var(--p-focus-ring); color: var(--color-text-muted); }
.archive-search svg { width: 15px; height: 15px; flex: none; }
.archive-search input { width: 100%; border: none; outline: none; background: transparent; font: inherit; color: var(--color-text); }
.archive-list { display: flex; flex-direction: column; gap: var(--space-4); }
.archive-card .setting-card { margin-bottom: 0; }
.archive-workspace { display: flex; align-items: center; gap: var(--space-2); margin: 0 2px var(--space-2); color: var(--color-text-muted); font-size: var(--text-sm); font-weight: var(--weight-medium); }
.archive-workspace svg { width: 16px; height: 16px; color: var(--color-text-faint); flex: none; }
.archive-workspace .path { font-family: var(--font-mono); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.archive-workspace .count { margin-left: auto; color: var(--color-text-faint); font-weight: var(--weight-regular); font-size: var(--text-xs); flex: none; }
.archive-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--color-line); }
.archive-row:first-child { border-top: none; }
.archive-row:hover { background: var(--color-surface-sunken); }
.archive-meta { min-width: 0; }
.archive-name { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.archive-time { margin-top: 2px; font-size: var(--text-xs); color: var(--color-text-faint); font-family: var(--font-mono); }
.archive-draining { margin-bottom: var(--space-3); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--color-accent-soft); color: var(--color-accent-hover); font-size: var(--text-sm); }
.archive-empty { padding: var(--space-6) var(--space-4); border: 1px solid var(--color-line); border-radius: var(--radius-xl); color: var(--color-text-faint); font-size: var(--text-sm); text-align: center; background: var(--color-bg); }
@media (max-width: 640px) {
  .archive-toolbar { flex-direction: column; align-items: stretch; }
  .archive-search { min-width: 0; }
}
/* Enlarge the settings frame a bit (Dialog `xl` = 760px wide, fixed-height
   680px). Scoped to this dialog only. */
:deep(.ui-dialog) { width: min(980px, 96vw); }
:deep(.ui-dialog--fixed-height) { height: min(780px, calc(100vh - var(--space-8) * 2)); }
</style>
