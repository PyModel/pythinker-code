<!-- apps/pythinker-web/src/components/settings/SettingsDialog.vue -->
<!-- The app's dedicated Settings page (modal). Consolidates what used to be
     scattered in the sidebar account popover: appearance, account,
     connection, plus notifications and the troubleshooting-log export. -->
<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import { getPythinkerWebApi } from '../../api';
import type {
  AppSubagentModelPolicy,
  AppSubagentModelPolicyState,
  AppConfig,
  AppExperimentalFlagState,
  AppModel,
  AppServerMeta,
  AppSession,
} from '../../api/types';
import { useDialogFocus } from '../../composables/useDialogFocus';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import { expertTalkContextKey } from '../../composables/expertTalkContext';
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
import Banner from '../ui/Banner.vue';
import Field from '../ui/Field.vue';
import type { IconName } from '../../lib/icons';
import ProvidersPanel from './ProvidersPanel.vue';
import SecondaryModelPicker from './SecondaryModelPicker.vue';

const { t } = useI18n();
const expertTalk = inject(expertTalkContextKey);

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
  /** Fold a finished turn's work away, leaving the summary. */
  turnFolding?: boolean;
  /** Summarise consecutive tool calls into one row while the answer runs. */
  activityRunFolding?: boolean;
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
  /** Effective experimental flag states from GET /api/v1/meta. */
  experimentalFlagStates?: AppExperimentalFlagState[];
  /** Saved + effective subagent model routing policy (dedicated endpoint). */
  subagentModelPolicy?: AppSubagentModelPolicyState | null;
  subagentModelPolicySaving?: boolean;
  initialTab?: 'general' | 'providers' | 'agent' | 'expertOpinion';
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
  setTurnFolding: [on: boolean];
  setActivityRunFolding: [on: boolean];
  openOnboarding: [];
  updateConfig: [patch: Partial<AppConfig>];
  saveSubagentModelPolicy: [policy: AppSubagentModelPolicy];
  clearSubagentModelPolicy: [];
  close: [];
}>();

type SettingsTab = 'general' | 'agent' | 'expertOpinion' | 'account' | 'providers' | 'advanced' | 'update' | 'lab' | 'archived';

const activeTab = ref<SettingsTab>(props.initialTab ?? 'general');
const fontScale = computed(() => uiFontScaleForSize(props.uiFontSize));
const desktopBridge = typeof window === 'undefined' ? undefined : window.pythinkerDesktop;

const tabs: { id: SettingsTab; labelKey: string; icon: IconName }[] = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: 'sliders' },
  { id: 'agent', labelKey: 'settings.tabs.agent', icon: 'cute-bot' },
  { id: 'expertOpinion', labelKey: 'settings.tabs.expertOpinion', icon: 'sparkles' },
  { id: 'account', labelKey: 'settings.tabs.account', icon: 'user' },
  { id: 'providers', labelKey: 'settings.tabs.providers', icon: 'bolt' },
  { id: 'lab', labelKey: 'settings.tabs.lab', icon: 'flask' },
  { id: 'archived', labelKey: 'settings.tabs.archived', icon: 'archive' },
  ...(desktopBridge === undefined
    ? []
    : [{ id: 'update' as const, labelKey: 'settings.tabs.update', icon: 'update-available' as const }]),
  { id: 'advanced', labelKey: 'settings.tabs.advanced', icon: 'microscope' },
];

const serverAddress = readPythinkerApiConfig().serverHttpUrl;
const appVersion =
  typeof __PYTHINKER_WEB_VERSION__ === 'string' && __PYTHINKER_WEB_VERSION__.trim()
    ? __PYTHINKER_WEB_VERSION__
    : '0.0.0-dev';
const desktopUpdateState = ref<DesktopUpdateState>();
const desktopUpdateBusy = ref(false);
const desktopUpdateActionError = ref<string>();
let removeDesktopUpdateListener: (() => void) | undefined;
const resolvedAppVersion = computed(() => desktopUpdateState.value?.installedVersion ?? appVersion);
const serverMeta = ref<Pick<AppServerMeta, 'serverVersion' | 'serverId' | 'backend'> & Partial<AppServerMeta> | null>(null);
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
  if (desktopBridge !== undefined) {
    removeDesktopUpdateListener = desktopBridge.onUpdateState((next) => {
      desktopUpdateState.value = next;
    });
    void desktopBridge.getUpdateState().then((next) => {
      desktopUpdateState.value = next;
    });
  }
});
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  removeDesktopUpdateListener?.();
  if (copyFlashTimer !== null) clearTimeout(copyFlashTimer);
});

const desktopUpdateStatus = computed(() => {
  const current = desktopUpdateState.value;
  if (current === undefined) return t('settings.desktop.loading');
  switch (current.status) {
    case 'disabled':
      return t('settings.desktop.disabled');
    case 'checking':
      return t('settings.desktop.checking');
    case 'available':
      return t('settings.desktop.available', { version: current.availableVersion });
    case 'downloading':
      return t('settings.desktop.downloading', { version: current.availableVersion });
    case 'downloaded':
      return t('settings.desktop.downloaded', { version: current.availableVersion });
    case 'skipped':
      return t('settings.desktop.skipped', { version: current.skippedVersion ?? current.availableVersion });
    case 'error':
      return current.message ?? t('settings.desktop.errorGeneric');
    default:
      return t('settings.desktop.upToDate');
  }
});

const desktopUpdateProgress = computed(() => {
  const value = desktopUpdateState.value?.percent;
  return value === undefined || !Number.isFinite(value) ? undefined : Math.min(100, Math.max(0, value));
});

const desktopUpdateChannels: DesktopUpdateChannel[] = ['stable', 'beta', 'nightly'];
const desktopUpdateChannelDisabled = computed(() => {
  const status = desktopUpdateState.value?.status;
  return desktopUpdateBusy.value
    || status === undefined
    || status === 'checking'
    || status === 'downloading'
    || status === 'downloaded';
});
const desktopUpdateCheckDisabled = computed(() => {
  const status = desktopUpdateState.value?.status;
  return desktopUpdateBusy.value
    || status === undefined
    || status === 'disabled'
    || status === 'checking'
    || status === 'downloading'
    || status === 'downloaded';
});
const desktopUpdateLastChecked = computed(() => {
  const raw = desktopUpdateState.value?.lastCheckedAt;
  if (raw === undefined) return t('settings.desktop.neverChecked');
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return t('settings.desktop.neverChecked');
  return t('settings.desktop.lastChecked', {
    time: new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date),
  });
});

function formatBytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1_024 && unit < units.length - 1) {
    amount /= 1_024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}

const desktopUpdateProgressDetail = computed(() => {
  const current = desktopUpdateState.value;
  if (current?.status !== 'downloading') return '';
  const parts: string[] = [];
  if (desktopUpdateProgress.value !== undefined) parts.push(`${Math.round(desktopUpdateProgress.value)}%`);
  if (current.transferred !== undefined && current.total !== undefined) {
    parts.push(t('settings.desktop.bytesOfTotal', {
      transferred: formatBytes(current.transferred),
      total: formatBytes(current.total),
    }));
  } else if (current.transferred !== undefined) {
    parts.push(formatBytes(current.transferred));
  }
  if (current.bytesPerSecond !== undefined) parts.push(`${formatBytes(current.bytesPerSecond)}/s`);
  return parts.join(' · ');
});

const desktopUpdateError = computed(() => {
  if (desktopUpdateActionError.value !== undefined) return desktopUpdateActionError.value;
  return desktopUpdateState.value?.status === 'error' ? desktopUpdateStatus.value : undefined;
});

async function runDesktopUpdate(action: () => Promise<DesktopUpdateState>): Promise<void> {
  if (desktopUpdateBusy.value) return;
  desktopUpdateBusy.value = true;
  desktopUpdateActionError.value = undefined;
  try {
    desktopUpdateState.value = await action();
  } catch (error) {
    desktopUpdateActionError.value = error instanceof Error ? error.message : String(error);
  } finally {
    desktopUpdateBusy.value = false;
  }
}

function setAutomaticUpdateChecks(enabled: boolean): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.setAutoUpdate(enabled));
}

function setDesktopUpdateChannel(channel: string): void {
  if (desktopBridge !== undefined && desktopUpdateChannels.includes(channel as DesktopUpdateChannel)) {
    void runDesktopUpdate(() => desktopBridge.setUpdateChannel(channel as DesktopUpdateChannel));
  }
}

function setDesktopUpdateNotifications(enabled: boolean): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.setNotifyUpdate(enabled));
}

function checkForDesktopUpdate(): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.checkForUpdates());
}

function downloadDesktopUpdate(): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.downloadUpdate());
}

function skipDesktopUpdate(): void {
  const version = desktopUpdateState.value?.availableVersion;
  if (desktopBridge !== undefined && version !== undefined) {
    void runDesktopUpdate(() => desktopBridge.skipUpdate(version));
  }
}

function undoSkippedDesktopUpdate(): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.undoSkippedUpdate());
}

function openDesktopUpdateNotes(): void {
  const version = desktopUpdateState.value?.availableVersion;
  if (desktopBridge !== undefined && version !== undefined) {
    void runDesktopUpdate(() => desktopBridge.openUpdateReleaseNotes(version));
  }
}

function restartToDesktopUpdate(): void {
  if (desktopBridge !== undefined) void runDesktopUpdate(() => desktopBridge.restartToUpdate());
}

// Config saves and the parent refresh can overlap; only the newest request may
// write, so a slow older `/meta` response never leaves stale flag chips behind.
let serverMetaRequest = 0;

async function loadServerMeta(): Promise<void> {
  const request = ++serverMetaRequest;
  let next: typeof serverMeta.value;
  try {
    next = await getPythinkerWebApi().getMeta();
  } catch {
    next = null;
  }
  if (request === serverMetaRequest) serverMeta.value = next;
}

// A saved config can change what the server decides (flag sources, effective
// values); re-read the metadata so the Lab chips never show a pre-save state.
watch(
  () => props.config,
  () => {
    void loadServerMeta();
  },
);

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
    `App version: ${resolvedAppVersion.value}`,
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
// after a successful copy.
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

// Subagent model routing — the Agent tab section. Reads and writes go
// through the dedicated policy endpoint (If-Match on the last read version);
// the card below shows what is saved next to what currently applies.
const modelInfoById = computed<Record<string, AppModel>>(() =>
  Object.fromEntries((props.models ?? []).map((model) => [model.id, model])),
);

function experimentalFlag(flag: string): boolean {
  return props.config?.experimental?.[flag] === true;
}

// Effective state comes from the server: the switch edits the saved setting,
// the chips explain when that setting is not what currently applies.
function experimentalFlagState(flag: string): AppExperimentalFlagState | undefined {
  const fromMeta = serverMeta.value?.experimentalFlagStates?.find((state) => state.id === flag);
  return fromMeta ?? props.experimentalFlagStates?.find((state) => state.id === flag);
}

function toggleExperimental(flag: string, value: boolean): void {
  const next = { ...props.config?.experimental, [flag]: value };
  emit('updateConfig', { experimental: next } as Partial<AppConfig>);
}

const expertOpinionModels = computed(() => (props.models ?? []).filter((model) =>
  model.maxContextSize > 0 &&
  (model.capabilities ?? []).some((capability) =>
    capability.trim().toLowerCase().replaceAll('-', '_') === 'tool_use'
  ),
));
const expertOpinionModelIds = computed(() =>
  new Set(expertOpinionModels.value.map((model) => model.id)),
);
const expertOpinionModelGroups = computed(() => modelGroups.value
  .map((group) => ({
    provider: group.provider,
    options: group.options.filter((option) => expertOpinionModelIds.value.has(option.id)),
  }))
  .filter((group) => group.options.length > 0),
);
const expertOpinionStatus = computed(() => expertTalk?.status.value);
const expertOpinionEnabled = computed(() =>
  experimentalFlagState('expert_talk')?.enabled
    ?? expertOpinionStatus.value?.feature === 'enabled',
);
const expertOpinionLeadModelId = ref('');
const expertOpinionPeerModelId = ref('');
const expertOpinionLeadThinkingEffort = ref('');
const expertOpinionPeerThinkingEffort = ref('');
const expertOpinionPairDirty = ref(false);
const expertOpinionPreferredPair = computed(() => expertTalk?.preferredPair.value);
const expertOpinionPairValid = computed(() =>
  expertOpinionLeadModelId.value !== expertOpinionPeerModelId.value &&
  expertOpinionModelIds.value.has(expertOpinionLeadModelId.value) &&
  expertOpinionModelIds.value.has(expertOpinionPeerModelId.value),
);
const expertOpinionPairSaved = computed(() =>
  expertOpinionPreferredPair.value?.fusionLeadModelId === expertOpinionLeadModelId.value &&
  expertOpinionPreferredPair.value?.peerModelId === expertOpinionPeerModelId.value &&
  (expertOpinionPreferredPair.value?.fusionLeadThinkingEffort ?? '') === expertOpinionLeadThinkingEffort.value &&
  (expertOpinionPreferredPair.value?.peerThinkingEffort ?? '') === expertOpinionPeerThinkingEffort.value,
);

function syncExpertOpinionPair(): void {
  if (expertOpinionPairDirty.value) return;
  const configured = expertOpinionPreferredPair.value ?? expertOpinionStatus.value?.config;
  expertOpinionLeadModelId.value = configured?.fusionLeadModelId ?? '';
  expertOpinionPeerModelId.value = configured?.peerModelId ?? '';
  expertOpinionLeadThinkingEffort.value = configured?.fusionLeadThinkingEffort ?? '';
  expertOpinionPeerThinkingEffort.value = configured?.peerThinkingEffort ?? '';
}

watch(
  [() => expertOpinionStatus.value?.config, () => expertOpinionPreferredPair.value],
  syncExpertOpinionPair,
  { immediate: true, deep: true },
);

function setExpertOpinionLead(selection: { model: string; effort?: string }): void {
  expertOpinionLeadModelId.value = selection.model;
  expertOpinionLeadThinkingEffort.value = selection.effort ?? '';
  expertOpinionPairDirty.value = true;
}

function setExpertOpinionPeer(selection: { model: string; effort?: string }): void {
  expertOpinionPeerModelId.value = selection.model;
  expertOpinionPeerThinkingEffort.value = selection.effort ?? '';
  expertOpinionPairDirty.value = true;
}

async function setExpertOpinionEnabled(value: boolean): Promise<void> {
  if (!value && expertOpinionStatus.value?.activation.state === 'armed') {
    await expertTalk?.disarm();
  }
  toggleExperimental('expert_talk', value);
}

async function saveExpertOpinionPair(): Promise<void> {
  if (!expertTalk || !expertOpinionPairValid.value) return;
  await expertTalk.configurePair({
    fusionLeadModelId: expertOpinionLeadModelId.value,
    peerModelId: expertOpinionPeerModelId.value,
    fusionLeadThinkingEffort: expertOpinionLeadThinkingEffort.value || undefined,
    peerThinkingEffort: expertOpinionPeerThinkingEffort.value || undefined,
  });
  if (expertTalk.error.value !== undefined) return;
  expertOpinionPairDirty.value = false;
  syncExpertOpinionPair();
}

function expertOpinionModelAvailable(modelId: string): boolean {
  return expertOpinionModelIds.value.has(modelId);
}

const ROUTING_MODES = ['inherit', 'default', 'pool', 'force'] as const;
type RoutingMode = (typeof ROUTING_MODES)[number];

const draftMode = ref<RoutingMode>('inherit');
const draftModel = ref('');
const draftEffort = ref('');
const draftPool = ref<Set<string>>(new Set());

function adoptPolicy(policy: AppSubagentModelPolicy | undefined): void {
  draftMode.value = policy?.mode ?? 'inherit';
  draftModel.value = policy !== undefined && policy.mode !== 'inherit' ? policy.defaultModel : '';
  draftEffort.value = policy !== undefined && policy.mode !== 'inherit' ? (policy.defaultEffort ?? '') : '';
  draftPool.value = new Set(policy?.mode === 'pool' ? Object.keys(policy.models) : []);
}
watch(() => props.subagentModelPolicy?.policy, adoptPolicy, { immediate: true, deep: true });

function draftPolicy(): AppSubagentModelPolicy | undefined {
  const effort = draftEffort.value || undefined;
  switch (draftMode.value) {
    case 'inherit':
      return { mode: 'inherit' };
    case 'default':
    case 'force':
      return draftModel.value ? { mode: draftMode.value, defaultModel: draftModel.value, defaultEffort: effort } : undefined;
    case 'pool': {
      if (draftPool.value.size === 0 || !draftPool.value.has(draftModel.value)) return undefined;
      const models = Object.fromEntries([...draftPool.value].map((id) => [id, '']));
      return { mode: 'pool', defaultModel: draftModel.value, models, defaultEffort: effort };
    }
  }
}

function commitDraft(): void {
  const policy = draftPolicy();
  if (policy === undefined) return;
  if (policy.mode === 'inherit') {
    if (props.subagentModelPolicy?.policy.mode !== 'inherit') emit('clearSubagentModelPolicy');
    return;
  }
  emit('saveSubagentModelPolicy', policy);
}

function selectMode(mode: RoutingMode): void {
  if (draftMode.value === mode) return;
  draftMode.value = mode;
  if (mode === 'pool' && draftPool.value.size === 0 && draftModel.value) {
    draftPool.value = new Set([draftModel.value]);
  }
  commitDraft();
}

function pickModel(selection: { model: string; effort?: string }): void {
  draftModel.value = selection.model;
  draftEffort.value = selection.effort ?? '';
  commitDraft();
}

function togglePoolModel(id: string): void {
  const next = new Set(draftPool.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  draftPool.value = next;
  if (!next.has(draftModel.value)) draftModel.value = [...next][0] ?? '';
  commitDraft();
}

function setPoolDefault(id: string): void {
  if (!draftPool.value.has(id) || draftModel.value === id) return;
  draftModel.value = id;
  commitDraft();
}

function modelLabelFor(id: string): string {
  return modelOptions.value.find((option) => option.id === id)?.label ?? id;
}

function policySummary(policy: AppSubagentModelPolicy): string {
  switch (policy.mode) {
    case 'inherit':
      return t('settings.subagentRouting.summaryInherit');
    case 'pool':
      return `${t('settings.subagentRouting.mode.pool')} · ${t('settings.subagentRouting.summaryPool', {
        count: Object.keys(policy.models).length,
        model: modelLabelFor(policy.defaultModel),
      })}`;
    default: {
      const effort = policy.defaultEffort ? ` · ${policy.defaultEffort}` : '';
      return `${t(`settings.subagentRouting.mode.${policy.mode}`)} · ${modelLabelFor(policy.defaultModel)}${effort}`;
    }
  }
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

watch(activeTab, (tab) => {
  if (tab !== 'expertOpinion') return;
  void client.refreshAllProviders();
  void expertTalk?.refresh();
});

watch(
  () => experimentalFlagState('expert_talk')?.enabled,
  () => {
    if (activeTab.value === 'expertOpinion') void expertTalk?.refresh();
  },
);

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
          </section>

          <section class="sec">
            <h3 class="sec-title">{{ t('settings.messageFolding') }}</h3>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.turnFolding') }}
                <span class="hint">{{ t('settings.turnFoldingHint') }}</span>
              </span>
              <Switch
                :model-value="turnFolding ?? true"
                :label="t('settings.turnFolding')"
                @update:model-value="emit('setTurnFolding', $event)"
              />
            </div>
            <div class="row">
              <span class="rlabel">
                {{ t('settings.activityRunFolding') }}
                <span class="hint">{{ t('settings.activityRunFoldingHint') }}</span>
              </span>
              <Switch
                :model-value="activityRunFolding ?? true"
                :label="t('settings.activityRunFolding')"
                @update:model-value="emit('setActivityRunFolding', $event)"
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
            <!-- Show provider readiness and route setup to the provider manager. -->
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

              <section v-if="subagentModelPolicy" class="sec" data-testid="subagent-routing">
                <h3 class="sec-title">{{ t('settings.subagentRouting.title') }}</h3>
                <div class="routing-modes" role="radiogroup" :aria-label="t('settings.subagentRouting.title')">
                  <label v-for="mode in ROUTING_MODES" :key="mode" class="routing-mode" :class="{ on: draftMode === mode }">
                    <input
                      type="radio"
                      name="subagent-routing-mode"
                      :value="mode"
                      :checked="draftMode === mode"
                      :disabled="subagentModelPolicySaving"
                      @change="selectMode(mode)"
                    />
                    <span class="routing-mode-title">{{ t(`settings.subagentRouting.mode.${mode}`) }}</span>
                    <span class="hint">{{ t(`settings.subagentRouting.modeHint.${mode}`) }}</span>
                  </label>
                </div>
                <div v-if="draftMode === 'default' || draftMode === 'force'" class="row">
                  <span class="rlabel">
                    {{ t('settings.subagentRouting.model') }}
                    <span class="hint">{{ t('settings.subagentRouting.modelHint') }}</span>
                  </span>
                  <SecondaryModelPicker
                    v-if="modelGroups.length > 0"
                    :model-value="draftModel"
                    :effort="draftEffort"
                    :groups="modelGroups"
                    :model-info-by-id="modelInfoById"
                    :disabled="subagentModelPolicySaving"
                    @inherit="selectMode('inherit')"
                    @select="pickModel"
                  />
                  <span v-else class="rvalue">{{ t('settings.noSecondaryModel') }}</span>
                </div>
                <div v-else-if="draftMode === 'pool'" class="row routing-pool">
                  <span class="rlabel">
                    {{ t('settings.subagentRouting.pool') }}
                    <span class="hint">{{ t('settings.subagentRouting.poolHint') }}</span>
                  </span>
                  <div class="pool-list" data-testid="routing-pool">
                    <label v-for="option in modelOptions" :key="option.id" class="pool-item">
                      <input
                        type="checkbox"
                        :value="option.id"
                        :checked="draftPool.has(option.id)"
                        :disabled="subagentModelPolicySaving"
                        @change="togglePoolModel(option.id)"
                      />
                      <span class="pool-name">{{ option.label }}</span>
                      <button
                        type="button"
                        class="pool-default"
                        :class="{ on: draftModel === option.id }"
                        :disabled="!draftPool.has(option.id) || subagentModelPolicySaving"
                        @click="setPoolDefault(option.id)"
                      >{{ draftModel === option.id ? t('settings.subagentRouting.poolDefault') : t('settings.subagentRouting.makeDefault') }}</button>
                    </label>
                  </div>
                </div>
                <div class="row routing-effective" data-testid="effective-routing">
                  <span class="rlabel">
                    {{ t('settings.subagentRouting.saved') }}
                    <span class="rvalue mono" data-testid="saved-policy">{{ policySummary(subagentModelPolicy.configuredPolicy) }}</span>
                  </span>
                  <span class="rlabel">
                    {{ t('settings.subagentRouting.effective') }}
                    <span class="rvalue mono" data-testid="effective-policy">{{ policySummary(subagentModelPolicy.effectivePolicy) }}</span>
                  </span>
                  <span v-if="!subagentModelPolicy.feature.enabled" class="hint" data-testid="feature-disabled">
                    {{ t('settings.subagentRouting.featureDisabled') }}
                  </span>
                </div>
              </section>

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

            </template>

            <div v-else class="empty-config">
              {{ t('settings.configUnavailable') }}
            </div>
          </section>
        </section>

        <section v-show="activeTab === 'expertOpinion'" class="panel" data-testid="expert-opinion-settings">
          <section class="sec">
            <div class="sec-head">
              <h3 class="sec-title">{{ t('settings.expertOpinion.title') }}</h3>
              <span v-if="configSaving || expertTalk?.busy.value" class="saving">{{ t('settings.saving') }}</span>
            </div>

            <div class="row">
              <span class="rlabel">
                {{ t('settings.expertOpinion.enabled') }}
                <span class="hint">{{ t('settings.expertOpinion.enabledHint') }}</span>
                <span v-if="experimentalFlagState('expert_talk')?.externallyControlled" class="flag-chip">{{ t('settings.lab.environmentControlled') }}</span>
                <span v-if="experimentalFlagState('expert_talk')?.overridden" class="flag-chip flag-chip--warn">{{ t('settings.lab.savedSettingOverridden') }}</span>
              </span>
              <Switch
                data-testid="expert-opinion-enabled"
                :model-value="experimentalFlag('expert_talk')"
                :disabled="configSaving || !config"
                :label="t('settings.expertOpinion.enabled')"
                @update:model-value="setExpertOpinionEnabled"
              />
            </div>

            <Banner v-if="resolvedBackend !== 'v2' || !expertTalk" variant="warning">
              {{ t('settings.expertOpinion.unavailable') }}
            </Banner>
            <template v-else>
              <Banner v-if="expertOpinionModels.length < 2" variant="warning">
                {{ t('settings.expertOpinion.modelsRequired') }}
              </Banner>

              <div class="expert-opinion-flow">
                <Field :label="t('settings.expertOpinion.lead')" :hint="t('settings.expertOpinion.leadHint')">
                  <SecondaryModelPicker
                    data-testid="expert-opinion-lead"
                    :model-value="expertOpinionLeadModelId"
                    :effort="expertOpinionLeadThinkingEffort"
                    :groups="expertOpinionModelGroups"
                    :model-info-by-id="modelInfoById"
                    :allow-empty="false"
                    :empty-label="t('settings.expertOpinion.selectModel')"
                    :aria-label="t('settings.expertOpinion.lead')"
                    :disabled="!expertOpinionEnabled || expertTalk.busy.value"
                    @select="setExpertOpinionLead"
                  />
                </Field>

                <Icon class="expert-opinion-arrow" name="chevron-right" size="md" />

                <Field :label="t('settings.expertOpinion.peer')" :hint="t('settings.expertOpinion.peerHint')">
                  <SecondaryModelPicker
                    data-testid="expert-opinion-peer"
                    :model-value="expertOpinionPeerModelId"
                    :effort="expertOpinionPeerThinkingEffort"
                    :groups="expertOpinionModelGroups"
                    :model-info-by-id="modelInfoById"
                    :allow-empty="false"
                    :empty-label="t('settings.expertOpinion.selectModel')"
                    :aria-label="t('settings.expertOpinion.peer')"
                    :disabled="!expertOpinionEnabled || expertTalk.busy.value"
                    @select="setExpertOpinionPeer"
                  />
                </Field>
              </div>

              <Banner
                v-if="expertOpinionLeadModelId && !expertOpinionModelAvailable(expertOpinionLeadModelId)"
                variant="warning"
              >
                {{ t('settings.expertOpinion.missingModel', { id: expertOpinionLeadModelId }) }}
              </Banner>
              <Banner
                v-if="expertOpinionPeerModelId && !expertOpinionModelAvailable(expertOpinionPeerModelId)"
                variant="warning"
              >
                {{ t('settings.expertOpinion.missingModel', { id: expertOpinionPeerModelId }) }}
              </Banner>

              <Banner
                v-if="expertOpinionLeadModelId && expertOpinionPeerModelId && expertOpinionLeadModelId === expertOpinionPeerModelId"
                variant="warning"
              >
                {{ t('settings.expertOpinion.distinctRequired') }}
              </Banner>
              <Banner
                v-else-if="expertOpinionStatus?.config && !expertOpinionPairDirty && expertOpinionStatus.pairValidation.reason"
                variant="warning"
              >
                {{ expertOpinionStatus.pairValidation.reason }}
              </Banner>
              <Banner>{{ t('expertTalk.disclosure') }}</Banner>

              <div class="actions expert-opinion-actions">
                <Button
                  data-testid="expert-opinion-save"
                  variant="primary"
                  size="sm"
                  :disabled="!expertOpinionEnabled || !expertOpinionPairValid || expertTalk.busy.value"
                  @click="saveExpertOpinionPair"
                >
                  {{ t('settings.expertOpinion.savePair') }}
                </Button>
                <span v-if="expertOpinionPairSaved" class="hint">{{ t('settings.expertOpinion.saved') }}</span>
              </div>
            </template>
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
              <span class="rvalue mono">{{ resolvedAppVersion }}</span>
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

        <!-- Desktop updates: one standalone control surface for channel and consent. -->
        <section v-show="activeTab === 'update'" class="panel">
          <section v-if="desktopBridge" class="sec">
            <h3 class="sec-title">{{ t('settings.tabs.update') }}</h3>
            <div data-testid="desktop-update-controls" class="desktop-update-card">
              <div class="desktop-update-row desktop-update-summary">
                <div class="desktop-update-summary-copy">
                  <span class="desktop-update-icon" aria-hidden="true">
                    <Icon name="update-button" />
                  </span>
                  <span class="rlabel">
                    <span class="desktop-update-title" aria-live="polite">{{ desktopUpdateStatus }}</span>
                    <span class="hint">{{ desktopUpdateLastChecked }}</span>
                  </span>
                </div>
                <Button
                  data-testid="settings-check-update"
                  variant="secondary"
                  size="sm"
                  :loading="desktopUpdateState?.status === 'checking'"
                  :disabled="desktopUpdateCheckDisabled"
                  @click="checkForDesktopUpdate"
                >
                  {{ t('settings.desktop.checkNow') }}
                </Button>
              </div>

              <div class="desktop-update-row">
                <span class="rlabel">
                  {{ t('settings.desktop.updateChannel') }}
                  <span class="hint">{{ t('settings.desktop.updateChannelHint') }}</span>
                </span>
                <div class="select-wrap desktop-update-select">
                  <Select
                    data-testid="desktop-update-channel"
                    size="sm"
                    :model-value="desktopUpdateState?.channel ?? 'stable'"
                    :disabled="desktopUpdateChannelDisabled"
                    :aria-label="t('settings.desktop.updateChannel')"
                    @update:model-value="setDesktopUpdateChannel"
                  >
                    <option v-for="channel in desktopUpdateChannels" :key="channel" :value="channel">
                      {{ t(`settings.desktop.channels.${channel}`) }}
                    </option>
                  </Select>
                </div>
              </div>

              <div class="desktop-update-row">
                <span class="rlabel">
                  {{ t('settings.desktop.automaticChecks') }}
                  <span class="hint">{{ t('settings.desktop.automaticChecksHint') }}</span>
                </span>
                <Switch
                  data-testid="automatic-update-checks"
                  :model-value="desktopUpdateState?.autoUpdate ?? false"
                  :disabled="desktopUpdateBusy || desktopUpdateState === undefined || desktopUpdateState.status === 'disabled'"
                  :label="t('settings.desktop.automaticChecks')"
                  @update:model-value="setAutomaticUpdateChecks"
                />
              </div>

              <div class="desktop-update-row">
                <span class="rlabel">
                  {{ t('settings.desktop.notifyUpdates') }}
                  <span class="hint">{{ t('settings.desktop.notifyUpdatesHint') }}</span>
                </span>
                <Switch
                  data-testid="update-notifications"
                  :model-value="desktopUpdateState?.notifyUpdate ?? true"
                  :disabled="desktopUpdateBusy || desktopUpdateState === undefined"
                  :label="t('settings.desktop.notifyUpdates')"
                  @update:model-value="setDesktopUpdateNotifications"
                />
              </div>

              <div
                v-if="desktopUpdateState?.status === 'downloading' || desktopUpdateError || desktopUpdateState?.availableVersion"
                class="desktop-update-detail"
              >
                <div v-if="desktopUpdateState?.status === 'downloading'" class="desktop-update-progress">
                  <progress
                    v-if="desktopUpdateProgress === undefined"
                    data-testid="settings-update-progress"
                    max="100"
                    :aria-label="t('settings.desktop.progressLabel')"
                  />
                  <progress
                    v-else
                    data-testid="settings-update-progress"
                    :value="desktopUpdateProgress"
                    max="100"
                    :aria-label="t('settings.desktop.progressLabel')"
                  />
                  <span data-testid="settings-update-progress-detail">
                    {{ desktopUpdateProgressDetail || t('settings.desktop.fetching') }}
                  </span>
                </div>

                <Banner v-if="desktopUpdateError" variant="danger">
                  {{ desktopUpdateError }}
                </Banner>

                <div class="desktop-update-actions">
                  <Button
                    v-if="desktopUpdateState?.availableVersion"
                    variant="ghost"
                    size="sm"
                    :disabled="desktopUpdateBusy"
                    @click="openDesktopUpdateNotes"
                  >
                    {{ t('settings.desktop.viewNotes') }}
                  </Button>
                  <Button
                    v-if="desktopUpdateState?.status === 'available'"
                    variant="ghost"
                    size="sm"
                    :disabled="desktopUpdateBusy"
                    @click="skipDesktopUpdate"
                  >
                    {{ t('settings.desktop.skip') }}
                  </Button>
                  <Button
                    v-if="desktopUpdateState?.status === 'available' || (desktopUpdateState?.status === 'error' && desktopUpdateState.availableVersion)"
                    data-testid="settings-download-update"
                    size="sm"
                    :loading="desktopUpdateBusy"
                    @click="downloadDesktopUpdate"
                  >
                    {{ desktopUpdateState?.status === 'error' ? t('settings.desktop.retryDownload') : t('settings.desktop.download') }}
                  </Button>
                  <Button
                    v-if="desktopUpdateState?.status === 'skipped'"
                    size="sm"
                    :loading="desktopUpdateBusy"
                    @click="undoSkippedDesktopUpdate"
                  >
                    {{ t('settings.desktop.undoSkip') }}
                  </Button>
                  <Button
                    v-if="desktopUpdateState?.status === 'downloaded'"
                    data-testid="settings-restart-update"
                    size="sm"
                    :loading="desktopUpdateBusy"
                    @click="restartToDesktopUpdate"
                  >
                    {{ t('settings.desktop.restartToUpdate') }}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </section>

        <!-- Lab: experimental flags. -->
        <section v-show="activeTab === 'lab'" class="panel">
          <section class="sec">
            <h3 class="sec-title">{{ t('settings.tabs.lab') }}</h3>
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
            <template v-if="config">
              <div class="row">
                <span class="rlabel">
                  {{ t('settings.lab.sidebarTabs') }}
                  <span class="hint">{{ t('settings.lab.sidebarTabsHint') }}</span>
                  <span v-if="experimentalFlagState('sidebarTabs')?.externallyControlled" class="flag-chip">{{ t('settings.lab.environmentControlled') }}</span>
                  <span v-if="experimentalFlagState('sidebarTabs')?.overridden" class="flag-chip flag-chip--warn">{{ t('settings.lab.savedSettingOverridden') }}</span>
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
                  <span v-if="experimentalFlagState('secondary-model')?.externallyControlled" class="flag-chip">{{ t('settings.lab.environmentControlled') }}</span>
                  <span v-if="experimentalFlagState('secondary-model')?.overridden" class="flag-chip flag-chip--warn">{{ t('settings.lab.savedSettingOverridden') }}</span>
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
.flag-chip {
  display: inline-block;
  width: fit-content;
  margin-top: var(--space-1);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-line);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.flag-chip--warn { color: var(--color-warning); border-color: var(--color-warning-bd); background: var(--color-warning-soft); }

.desktop-update-card {
  --desktop-update-icon-size: 42px;
  --desktop-update-select-min-width: 180px;
  --desktop-update-select-max-width: 220px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl);
  background: var(--color-surface-raised);
}
.desktop-update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
}
.desktop-update-row + .desktop-update-row,
.desktop-update-detail { border-top: 1px solid var(--color-line); }
.desktop-update-row .rlabel { min-width: 0; flex: 1; }
.desktop-update-summary-copy {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.desktop-update-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--desktop-update-icon-size);
  height: var(--desktop-update-icon-size);
}
.desktop-update-icon :deep(svg) {
  width: var(--desktop-update-icon-size);
  height: var(--desktop-update-icon-size);
}
.desktop-update-title {
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
}
.desktop-update-select {
  min-width: var(--desktop-update-select-min-width);
  max-width: var(--desktop-update-select-max-width);
}
.desktop-update-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.desktop-update-progress {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.desktop-update-progress progress {
  width: 100%;
  height: 7px;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
  accent-color: var(--color-accent);
}
.desktop-update-progress progress::-webkit-progress-bar {
  border-radius: var(--radius-full);
  background: var(--color-surface-sunken);
}
.desktop-update-progress progress::-webkit-progress-value {
  border-radius: var(--radius-full);
  background: var(--color-accent);
}
.desktop-update-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

.select-wrap { min-width: 220px; max-width: min(320px, 50vw); flex: none; }

.empty-config {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  color: var(--color-text-muted);
  padding: var(--space-1) 0;
}

.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }

.expert-opinion-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-4) 0;
}
.expert-opinion-arrow { color: var(--color-text-faint); }
.expert-opinion-actions { align-items: center; }

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
  .desktop-update-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .expert-opinion-flow { grid-template-columns: 1fr; }
  .expert-opinion-arrow { display: none; }
  .desktop-update-summary-copy { width: 100%; }
  .desktop-update-select { max-width: none; }
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

/* Subagent model routing */
.routing-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  padding: 6px 0 10px;
}
.routing-mode {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  cursor: pointer;
}
.routing-mode.on {
  border-color: var(--color-accent-bd);
  background: var(--color-accent-soft);
}
.routing-mode input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.routing-mode:has(input:focus-visible) {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.routing-mode-title {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.pool-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.pool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
}
.pool-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pool-default {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-line);
  background: transparent;
  color: var(--color-text-muted);
  font: var(--text-xs) var(--font-ui);
  cursor: pointer;
}
.pool-default.on {
  border-color: var(--color-accent-bd);
  color: var(--color-text);
}
.pool-default:disabled {
  opacity: 0.5;
  cursor: default;
}
.routing-effective {
  flex-wrap: wrap;
  gap: 4px 16px;
}
</style>
