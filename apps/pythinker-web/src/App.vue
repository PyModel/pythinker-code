<!-- apps/pythinker-web/src/App.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Sidebar from './components/Sidebar.vue';
import SessionAdminView, { type AdminSession } from './components/SessionAdminView.vue';
import ResizeHandle from './components/ResizeHandle.vue';
import ConversationPane from './components/chat/ConversationPane.vue';
import MediaLightbox from './components/MediaLightbox.vue';
import FilePreview from './components/FilePreview.vue';
import EditorPanel from './components/editor/EditorPanel.vue';
import ThinkingPanel from './components/chat/ThinkingPanel.vue';
import AgentDetailPanel from './components/chat/AgentDetailPanel.vue';
import ToolDiffPanel from './components/chat/ToolDiffPanel.vue';
import TurnDiffPanel from './components/chat/TurnDiffPanel.vue';
import SideChatPanel from './components/chat/SideChatPanel.vue';
import DiffView from './components/chat/DiffView.vue';
import ModelPicker from './components/settings/ModelPicker.vue';
import SettingsDialog from './components/settings/SettingsDialog.vue';
import AddWorkspaceDialog from './components/dialogs/AddWorkspaceDialog.vue';
import ConfirmDialogHost from './components/dialogs/ConfirmDialogHost.vue';
import StatusPanel from './components/chat/StatusPanel.vue';
import WarningToasts from './components/WarningToasts.vue';
import UpdateToast from './components/UpdateToast.vue';
import ActionToast from './components/ui/ActionToast.vue';
import WindowControls from './components/WindowControls.vue';
import MobileTopBar from './components/mobile/MobileTopBar.vue';
import MobileSwitcherSheet from './components/mobile/MobileSwitcherSheet.vue';
import MobileSettingsSheet from './components/mobile/MobileSettingsSheet.vue';
import Onboarding from './components/settings/Onboarding.vue';
import GlobalLoading from './components/GlobalLoading.vue';
import DebugPanel from './debug/DebugPanel.vue';
import { isTraceEnabled } from './debug/trace';
import { usePythinkerWebClient } from './composables/usePythinkerWebClient';
import { useConfirmDialog } from './composables/useConfirmDialog';
import type { PromptAttachment } from './composables/usePythinkerWebClient';
import type { ToolMedia, TurnAttachment } from './types';
import { useAuthGate } from './composables/useAuthGate';
import { usePageTitle } from './composables/usePageTitle';
import { useSidebarLayout } from './composables/useSidebarLayout';
import { resolveMediaUrl, useFilePreview, type DetailTarget } from './composables/useFilePreview';
import {
  closeFileEditor,
  installEditorSessionSource,
  openFileEditor,
} from './composables/useWorkspaceEditor';
import type { TurnFileChange } from './lib/turnFiles';
import { useDetailPanel } from './composables/useDetailPanel';
import { useIsMobile } from './composables/useIsMobile';
import { openDialogCount } from './composables/dialogStack';
import type { DynamicWorkflowMember } from './composables/dynamicWorkflowGroups';
import ServerAuthDialog from './components/ServerAuthDialog.vue';
import { initServerAuth, onAuthRequired } from './api/daemon/serverAuth';
import type { AppConfig, ThinkingLevel } from './api/types';
import { effortLabel, effectiveThinkingLevel } from './lib/modelThinking';
import { stripSkillPrefix } from './lib/slashCommands';
import { composeTitle } from './lib/sessionEmoji';
import { getTurnInterruption } from './api/daemon/agentEventProjector';
import Button from './components/ui/Button.vue';
import IconButton from './components/ui/IconButton.vue';
import Icon from './components/ui/Icon.vue';
import InternalBuildBanner from './components/InternalBuildBanner.vue';
import { isMacosDesktop } from './lib/desktopFlag';

// Hydrate the server-transport credential (fragment token or localStorage)
// BEFORE the client connects, so the first REST/WS calls already carry it.
initServerAuth();
// Stays false until the server actually rejects us with 401/40101. Starting
// from "no credential ⇒ prompt" flashed the token dialog for a frame in
// `--dangerous-bypass-auth` mode, before /meta had advertised the bypass.
const authRequired = ref(false);
let offAuthRequired: (() => void) | null = null;

const client = usePythinkerWebClient();
const archivedSessions = ref<import('./types').Session[]>([]);
const showSessionAdmin = ref(false);
const sessionActionToast = ref<{
  kind: 'done' | 'open';
  ids: string[];
} | null>(null);
const exportActionToast = ref<{ state: 'running' | 'done'; sessionId: string } | null>(null);
const titleNoticeToast = ref<string | null>(null);
let titleNoticeToastTimer: ReturnType<typeof setTimeout> | null = null;

const activeWorkspaceRecentSessions = computed(() => {
  const workspaceId = client.activeWorkspaceId.value;
  if (!workspaceId) return [];
  return [...client.sessionsForView.value, ...archivedSessions.value]
    .filter((session) => session.workspaceId === workspaceId)
    .toSorted((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 6);
});

function mapArchivedSession(session: import('./api/types').AppSession): import('./types').Session {
  return {
    id: session.id,
    title: session.title,
    time: new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
      -Math.max(0, Math.floor((Date.now() - new Date(session.updatedAt).getTime()) / 86_400_000)),
      'day',
    ),
    busy: false,
    updatedAt: session.updatedAt,
    workspaceId: session.workspaceId,
    archived: true,
  };
}

async function loadDoneSessions(): Promise<void> {
  try {
    const items: import('./api/types').AppSession[] = [];
    let beforeId: string | undefined;
    for (;;) {
      const page = await client.loadArchivedSessions({ beforeId, pageSize: 100 });
      items.push(...page.items);
      if (!page.hasMore || page.items.length === 0) break;
      beforeId = page.items.at(-1)?.id;
      if (beforeId === undefined) break;
    }
    archivedSessions.value = items.map(mapArchivedSession);
  } catch (error) {
    console.warn('loadDoneSessions failed', error);
  }
}

const adminOpenSessions = computed<AdminSession[]>(() => {
  const updatedById = new Map(
    client.workspaceGroups.value.flatMap((group) => group.sessions.map((session) => [session.id, session.updatedAt] as const)),
  );
  return client.sessionsForView.value.map((session) => ({
    id: session.id,
    title: session.title,
    workspaceId: session.workspaceId ?? '',
    workspaceName: session.workspaceName ?? '-',
    lastPrompt: session.lastPrompt,
    updatedAt: session.updatedAt ?? updatedById.get(session.id) ?? new Date(0).toISOString(),
    archived: false,
  }));
});

async function loadAdminArchivedSessions(): Promise<AdminSession[]> {
  const items: import('./api/types').AppSession[] = [];
  let beforeId: string | undefined;
  for (;;) {
    const result = await client.loadArchivedSessions({ beforeId, pageSize: 100 });
    items.push(...result.items);
    if (!result.hasMore || result.items.length === 0) break;
    beforeId = result.items.at(-1)?.id;
    if (beforeId === undefined) break;
  }
  const workspaces = client.workspacesView.value;
  return items.filter((session) => !session.parentSessionId).map((session) => {
    const workspace = workspaces.find((item) => item.id === session.workspaceId || item.root === session.cwd);
    return {
      id: session.id,
      title: session.title,
      workspaceId: workspace?.id ?? session.workspaceId ?? session.cwd,
      workspaceName: workspace?.name ?? session.cwd.split('/').filter(Boolean).at(-1) ?? '-',
      lastPrompt: session.lastPrompt,
      updatedAt: session.updatedAt,
      archived: true,
    };
  });
}

function openSessionAdmin(): void {
  showSessionAdmin.value = true;
  void client.loadAllSessions();
}

function showSessionActionToast(kind: 'done' | 'open', ids: string | string[]): void {
  sessionActionToast.value = { kind, ids: Array.isArray(ids) ? ids : [ids] };
}
// When the server runs with `--dangerous-bypass-auth`, `/meta` advertises it
// and we skip the token prompt entirely — there is no credential to enter.
const showServerAuth = computed(
  () => !client.dangerousBypassAuth.value && authRequired.value,
);
provide('resolveImage', client.resolveImageUrl);
// Friendly model / thinking-effort labels for subagent surfaces (TasksPane,
// SubagentGrid, AgentDetailPanel). The model resolver prefers the exact id —
// model names can collide across providers — then falls back to the raw id
// with any provider prefix stripped.
provide('modelDisplay', (modelId: string | undefined): string | undefined => {
  if (modelId === undefined || modelId.length === 0) return undefined;
  const matched =
    client.models.value.find((m) => m.id === modelId) ??
    client.models.value.find((m) => m.model === modelId);
  return matched?.displayName || matched?.model || (modelId.includes('/') ? modelId.split('/').pop()! : modelId);
});
provide('subagentEffort', (effort: string | undefined): string | undefined =>
  effort !== undefined && effort.length > 0 && effort !== 'off' && effort !== 'on' ? effortLabel(effort) : undefined,
);
// Live dynamic_workflow member roster for the inline AgentDynamicWorkflow tool card. Sourced from the
// AppTask store so the card shows each subagent's live phase; on refresh the
// tasks are gone and the card falls back to the parsed tool result. Includes
// single-member "dynamic workflows" (e.g. AgentDynamicWorkflow with one resume_agent_ids entry),
// which buildDynamicWorkflowGroups filters out for the badge counter.
provide(
  'resolveDynamicWorkflowMembers',
  (toolCallId: string): DynamicWorkflowMember[] => client.dynamicWorkflowMembersByToolCallId.value.get(toolCallId) ?? [],
);
const { t } = useI18n();
const { confirm } = useConfirmDialog();

// KAP/daemon debug panel — opt-in via ?debug=1 or localStorage pythinker-web.debug=1.
const debugEnabled = isTraceEnabled();

// Narrow viewports (≤640px) render the single-column mobile shell; desktop is
// unchanged. Falls back to desktop when matchMedia is unavailable.
const isMobile = useIsMobile();

// Mobile sheet visibility
const showMobileSwitcher = ref(false);
const showMobileSettings = ref(false);

// Active session title for the mobile top bar.
const activeSessionTitle = computed<string>(() => {
  const id = client.activeSessionId.value;
  return client.sessions.value.find((session) => session.id === id)?.title
    ?? archivedSessions.value.find((session) => session.id === id)?.title
    ?? '';
});
const activeLastTurnReason = computed(() => {
  const id = client.activeSessionId.value;
  return client.sessions.value.find((session) => session.id === id)?.lastTurnReason;
});
// Last step interruption observed for the active session (turn.step.interrupted
// payload: reason 'max_steps' + message). Pairs with activeLastTurnReason to
// render the step-limit failed-turn banner variant. Read non-reactively from
// the projector's module map; the `sessions` dep above re-runs this whenever
// the session record updates (including the turn.ended that flips lastTurnReason).
const activeTurnError = computed(() => {
  const id = client.activeSessionId.value;
  if (!id) return undefined;
  return getTurnInterruption(id);
});
const activeSessionDone = computed(() =>
  archivedSessions.value.some((session) => session.id === client.activeSessionId.value),
);

// Number of sessions in the active workspace (mobile top-bar sub-line).
const activeWorkspaceSessionCount = computed<number>(
  () => client.visibleWorkspace.value?.sessionCount ?? 0,
);

// running: true when activity is not idle
const running = computed(() => client.activity.value !== 'idle');

// Auth readiness gates the main app. Once the first load finishes and auth is
// still missing, show a full-page login entry instead of an in-app banner.
const authLogoRef = ref<SVGSVGElement | null>(null);
const { showAuthGate, blinkAuthLogo } = useAuthGate({ client, authLogoRef });


// Static page title (app name only). The session title and workspace name are
// intentionally excluded so the tab title stays stable. Prefixes an animated
// spinner while the agent is running so activity is visible at a glance.
usePageTitle({ running, showAuthGate });

// Status panel (/status) renders current client state only — show the
// effective thinking level so "no preference" reads as the model default that
// will actually run, not a blank.
const statusPanelThinking = computed<ThinkingLevel>(() => {
  const model = client.models.value.find((m) => m.id === client.status.value.modelId);
  return effectiveThinkingLevel(model, client.thinking.value);
});

// First-run onboarding. Shown until the user
// finishes it once; re-openable from the settings popover.
const showOnboarding = ref(!client.onboarded.value);
function completeOnboarding(): void {
  client.setOnboarded(true);
  showOnboarding.value = false;
}
function openOnboarding(): void {
  showOnboarding.value = true;
}

// iOS Safari does not shrink `dvh` for the on-screen keyboard. Instead it pans
// the visual viewport (offsetTop > 0) to reveal the focused field, which a
// 100dvh in-flow shell cannot follow: the dock ends up behind the keyboard, or
// the page shows a blank band past the shell's bottom edge. Pin the shell to
// the VISUAL viewport instead: position:fixed + top/height mirrored from
// visualViewport (height shrinks with the keyboard, offsetTop tracks the pan).
// No-ops on desktop, where offsetTop is 0 and height equals innerHeight.
let appHeightRaf = 0;
function setAppHeight(): void {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  root.setProperty('--app-height', `${vv?.height ?? window.innerHeight}px`);
  root.setProperty('--app-top', `${vv?.offsetTop ?? 0}px`);
}
function syncAppHeight(): void {
  if (appHeightRaf) return;
  appHeightRaf = requestAnimationFrame(() => {
    appHeightRaf = 0;
    setAppHeight();
  });
}

onMounted(() => {
  // Register the 401 listener before the first requests go out, so a token
  // rejection during the initial load() can never be missed.
  offAuthRequired = onAuthRequired(() => {
    authRequired.value = true;
    // The server now demands a token, so any cached "bypass" state from a
    // previous mode is stale — drop it so the token prompt can show.
    client.clearDangerousBypassAuth();
  });
  void client.load();
  loadSidebarCollapsed();
  setAppHeight();
  window.visualViewport?.addEventListener('resize', syncAppHeight);
  window.visualViewport?.addEventListener('scroll', syncAppHeight);
  window.addEventListener('resize', syncAppHeight);
  // Capture-phase so Escape closes the side detail layer BEFORE the
  // conversation pane's bubble-phase handler interrupts a running prompt.
  document.addEventListener('keydown', onGlobalKeydown, true);
});

onUnmounted(() => {
  closeMediaLightbox();
  document.removeEventListener('keydown', onGlobalKeydown, true);
  window.visualViewport?.removeEventListener('resize', syncAppHeight);
  window.visualViewport?.removeEventListener('scroll', syncAppHeight);
  window.removeEventListener('resize', syncAppHeight);
  if (appHeightRaf) {
    cancelAnimationFrame(appHeightRaf);
    appHeightRaf = 0;
  }
  document.documentElement.style.removeProperty('--app-height');
  document.documentElement.style.removeProperty('--app-top');
  if (offAuthRequired !== null) {
    offAuthRequired();
    offAuthRequired = null;
  }
});

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // A modal dialog open on top of the side panel owns Escape — leave the event
  // alone so the dialog can close itself instead of the panel behind it.
  if (anyOverlayOpen.value) return;
  if (detailTarget.value === 'turnDiff') closeTurnDiff();
  else if (!closeOpenSidePanel()) return;
  e.stopPropagation();
  e.preventDefault();
}

// ---------------------------------------------------------------------------
// Unified right-side detail layer. Only one detail is open at a time. The
// shared `detailTarget` ref lives here so the file-preview and detail-panel
// composables can both claim the single right-side slot.
// ---------------------------------------------------------------------------
const detailTarget = ref<DetailTarget | null>(null);
const turnDiffTarget = ref<{ turnId: string; changes: TurnFileChange[] } | null>(null);

function openTurnDiff(target: { turnId: string; changes: TurnFileChange[] }): void {
  if (detailTarget.value === 'turnDiff' && turnDiffTarget.value?.turnId === target.turnId) {
    closeTurnDiff();
    return;
  }
  turnDiffTarget.value = target;
  detailTarget.value = 'turnDiff';
}

function closeTurnDiff(): void {
  turnDiffTarget.value = null;
  if (detailTarget.value === 'turnDiff') detailTarget.value = null;
}

// True for one frame while the active session changes: suppresses the right
// panel's width transition so a restored panel snaps to its width instead of
// animating open from zero.
const panelSwitching = ref(false);
watch(client.activeSessionId, () => {
  closeTurnDiff();
  panelSwitching.value = true;
  void nextTick(() => { panelSwitching.value = false; });
});

const {
  previewTarget,
  previewFile,
  previewLoading,
  previewError,
  previewDownloadUrl,
  previewExternalActions,
  openFilePreview,
  closeFilePreview,
  openPreviewInEditor,
  revealPreviewFile,
} = useFilePreview({ client, detailTarget });

installEditorSessionSource(() => client.activeSessionId.value);

function handleOpenInEditor(path: string): void {
  detailTarget.value = 'editor';
  void openFileEditor({ path, line: previewTarget.value?.line });
}

function handleCloseEditor(): void {
  if (detailTarget.value === 'editor') detailTarget.value = null;
}

watch(detailTarget, (target, previous) => {
  if (previous === 'editor' && target !== 'editor') closeFileEditor();
});

const lightboxMedia = ref<ToolMedia | null>(null);
const lightboxSrc = ref<string | null>(null);
let lightboxRequestSeq = 0;
let revokeLightboxUrl: (() => void) | undefined;

async function openMediaPreview(media: ToolMedia): Promise<void> {
  if (media.kind !== 'image' && media.kind !== 'video') return;
  const requestSeq = ++lightboxRequestSeq;
  revokeLightboxUrl?.();
  revokeLightboxUrl = undefined;
  lightboxMedia.value = null;
  lightboxSrc.value = null;
  const resolved = await resolveMediaUrl(media);
  if (requestSeq !== lightboxRequestSeq) {
    resolved.revoke?.();
    return;
  }
  revokeLightboxUrl = resolved.revoke;
  lightboxMedia.value = media;
  lightboxSrc.value = resolved.url;
}

function closeMediaLightbox(): void {
  lightboxRequestSeq += 1;
  revokeLightboxUrl?.();
  revokeLightboxUrl = undefined;
  lightboxMedia.value = null;
  lightboxSrc.value = null;
}

// True while the right-side slot is actually occupied, so the sidebar reserves
// room for it and the conversation can never be squeezed. Keyed off detailTarget
// (the real occupant) rather than previewTarget, which can stay set after the
// panel is hidden.
const previewOpen = computed(() => detailTarget.value !== null);

// ---------------------------------------------------------------------------
// Layout: resizable session column. ResizeHandle owns the column width (with
// localStorage persistence); we mirror it here to drive the App grid.
// ---------------------------------------------------------------------------
const {
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  sidebarMax,
  sessionColWidth,
  sidebarCollapsed,
  sidebarDragging,
  sideWidth,
  loadSidebarCollapsed,
  toggleSidebarCollapse,
} = useSidebarLayout({ previewOpen });

// ---------------------------------------------------------------------------
// Unified right-side detail layer (thinking / compaction / agent / diff / side
// chat) plus the preview-panel width. Only one detail is open at a time.
// ---------------------------------------------------------------------------
const {
  PREVIEW_WIDTH_KEY,
  PREVIEW_MIN,
  previewDefaultWidth,
  previewMax,
  previewWidth,
  previewPanelWidth,
  compactionPanelText,
  compactionPanelVisible,
  openCompactionPanel,
  closeCompactionPanel,
  agentPanelMember,
  agentPanelTurns,
  agentPanelLoading,
  agentPanelLoadError,
  agentPanelLoadingMore,
  agentPanelLoadMoreError,
  agentPanelHasMore,
  agentPanelRunning,
  openAgentPanel,
  closeAgentPanel,
  loadOlderAgentMessages,
  toolDiffTarget,
  openToolDiff,
  closeToolDiff,
  detailDiffMode,
  detailDiffPath,
  openDiffDetail,
  closeDiffDetail,
  selectDiffFile,
  btwVisible,
  openSideChatTab,
  closeSideChat,
  sidePanelVisible,
  panelDragging,
  closeOpenSidePanel,
} = useDetailPanel({ client, sideWidth, detailTarget, closeFilePreview });

// Reference to ConversationPane so we can imperatively switch tabs
const conversationPaneRef = ref<InstanceType<typeof ConversationPane> | null>(null);

// Dialog visibility refs
const showModelPicker = ref(false);

const showAddWorkspace = ref(false);
const showStatusPanel = ref(false);
const showSettings = ref(false);
const settingsInitialTab = ref<'general' | 'providers'>('general');
const overlayOpen = computed(() =>
  openDialogCount.value > 0 ||
  showModelPicker.value ||
  showAddWorkspace.value ||
  showStatusPanel.value ||
  showSettings.value ||
  showMobileSwitcher.value ||
  showMobileSettings.value ||
  lightboxMedia.value !== null,
);

type SubmitPayload = {
  text: string;
  attachments: PromptAttachment[];
};
const pendingWorkspaceSubmit = ref<SubmitPayload | null>(null);
// Inline error shown inside the add-workspace picker after the daemon rejects
// a path. Kept separate from the global toast so the feedback is visible above
// the picker's backdrop and persists until the user retries or closes.
const addWorkspaceError = ref<string | null>(null);

// Any of these modal/overlay layers, when open, owns Escape. The global
// capture-phase handler must NOT close a background side panel out from under an
// open dialog — otherwise Escape dismisses the panel behind the dialog and the
// dialog's own Escape handler never fires. New top-level dialogs go here too.
const anyOverlayOpen = computed<boolean>(
  () =>
    openDialogCount.value > 0 ||
    showModelPicker.value ||
    showAddWorkspace.value ||
    showStatusPanel.value ||
    showSettings.value ||
    showOnboarding.value ||
    showMobileSwitcher.value ||
    showMobileSettings.value ||
    lightboxMedia.value !== null,
);

// Loading state for model fetches
const modelsLoading = ref(false);
const modelsUnavailable = ref(false);
const configSaving = ref(false);

async function openModelPicker(): Promise<void> {
  modelsLoading.value = true;
  modelsUnavailable.value = false;
  showModelPicker.value = true;
  try {
    // Full refresh first (every refreshable provider, not just OAuth), so the
    // list always reflects the live catalog — the WS model-catalog event that
    // used to keep the cache warm is no longer forwarded by the daemon.
    await client.refreshAllProviders();
  } catch {
    modelsUnavailable.value = true;
  } finally {
    modelsLoading.value = false;
  }
}

function openSettings(tab: 'general' | 'providers' = 'general'): void {
  settingsInitialTab.value = tab;
  showSettings.value = true;
}

function openProviders(): void {
  openSettings('providers');
}

function openLogin(): void {
  // No managed-account sign-in in this distribution: "log in" opens provider setup.
  openProviders();
}

async function handleSelectModel(modelId: string): Promise<void> {
  showModelPicker.value = false;
  // Same semantics as the composer dropdown rows: the overlay is just the
  // "more models" continuation of the same flow, so it must also bump the
  // global default (see handleComposerSelectModel).
  await handleComposerSelectModel(modelId);
}

async function handleComposerSelectModel(modelId: string): Promise<void> {
  // Primary action: switch the active session's model via POST /sessions/{id}/profile
  // (same as the model picker overlay). Awaited so the model pill reflects the
  // result and failures surface. In the onboarding draft this just stores the
  // pick for the first session.
  const switched = await client.setModel(modelId);

  // Side effect: also bump the daemon-wide default model via POST /config so
  // new sessions inherit the choice. Fire-and-forget — it must not block the UI
  // or mask the session switch. Only after a confirmed switch (a stale/invalid
  // alias must not become the global default), and skip when it already
  // matches the default.
  if (switched && modelId !== client.defaultModel.value) {
    void client.updateConfig({ defaultModel: modelId });
  }
}

// Destructive session/workspace actions confirm through the shared
// modal here (the menu components only emit the intent). Each passes its work
// as the dialog `action`, so the dialog stays open with a loading state until
// the operation settles.
async function markSessionDone(id: string): Promise<void> {
  await client.archiveSession(id);
  await loadDoneSessions();
  showSessionActionToast('done', id);
}

async function reopenSession(id: string): Promise<void> {
  if (!await client.restoreSession(id)) return;
  archivedSessions.value = archivedSessions.value.filter((session) => session.id !== id);
  showSessionActionToast('open', id);
}

async function renameSidebarSession(id: string, title: string): Promise<void> {
  await client.renameSession(id, title);
  if (archivedSessions.value.some((session) => session.id === id)) await loadDoneSessions();
}

async function setSidebarSessionEmoji(id: string, emoji: string | null): Promise<void> {
  const archived = archivedSessions.value.find((session) => session.id === id);
  if (!archived) {
    await client.setSessionEmoji(id, emoji);
    return;
  }
  await renameSidebarSession(id, composeTitle(emoji, archived.title));
}

async function runAdminBatch(
  items: AdminSession[],
  action: 'archive' | 'restore',
): Promise<void> {
  const ids = items.map((item) => item.id);
  for (const id of ids) {
    if (action === 'archive') await client.archiveSession(id);
    else await client.restoreSession(id);
  }
  await loadDoneSessions();
  showSessionActionToast(action === 'archive' ? 'done' : 'open', ids);
}

async function undoSessionAction(): Promise<void> {
  const toast = sessionActionToast.value;
  if (!toast) return;
  sessionActionToast.value = null;
  for (const id of toast.ids) {
    if (toast.kind === 'done') await client.restoreSession(id);
    else await client.archiveSession(id);
  }
  await loadDoneSessions();
}

async function handleExportSession(id?: string): Promise<void> {
  const sessionId = id ?? client.activeSessionId.value;
  if (!sessionId) return;
  exportActionToast.value = { state: 'running', sessionId };
  const exported = await client.exportSession(sessionId);
  exportActionToast.value = exported ? { state: 'done', sessionId } : null;
}

async function confirmDeleteWorkspace(id: string): Promise<void> {
  const name = client.workspacesView.value.find((w) => w.id === id)?.name ?? id;
  await confirm({
    title: t('sidebar.removeWorkspace'),
    message: t('workspace.removeWorkspaceConfirm', { name }),
    variant: 'danger',
    action: () => client.deleteWorkspace(id),
  });
}

async function handleUpdateConfig(patch: Partial<AppConfig>): Promise<void> {
  configSaving.value = true;
  try {
    const saved = await client.updateConfig(patch);
    if (saved) {
      await client.checkAuth();
    }
  } finally {
    configSaving.value = false;
  }
}

// Edit + resend the last user message: undo the latest exchange on the daemon,
// then drop that message's text back into the composer for editing.
async function handleEditMessage(payload: {
  text: string;
  attachments?: TurnAttachment[];
}): Promise<void> {
  await client.undo(1);
  await nextTick();
  conversationPaneRef.value?.loadComposerForEdit(payload.text, payload.attachments);
}

// Handler for slash commands emitted by Composer (via ConversationPane)
function handleCommand(cmd: string): void {
  // `/compact <text>` carries an optional free-text instruction steering what
  // the summary should focus on (TUI parity).
  if (cmd === '/compact' || cmd.startsWith('/compact ')) {
    client.compact(cmd.slice('/compact'.length).trim() || undefined);
    return;
  }
  // `/dynamic_workflow` toggles dynamic_workflow mode; `/dynamic_workflow on|off` sets it; `/dynamic_workflow <task>` enables
  // dynamic_workflow and runs the task right away (TUI parity).
  if (cmd === '/dynamic_workflow' || cmd.startsWith('/dynamic_workflow ')) {
    const arg = cmd.slice('/dynamic_workflow'.length).trim();
    if (arg === 'on') client.setDynamicWorkflowMode(true);
    else if (arg === 'off') client.setDynamicWorkflowMode(false);
    else if (arg) { client.setDynamicWorkflowMode(true); void client.sendPrompt(arg); }
    else void client.toggleDynamicWorkflowMode();
    return;
  }
  // `/goal <objective>` creates a goal (and submits it); `/goal pause|resume|cancel`
  // controls the active one; bare `/goal` toggles goal mode for the next message.
  if (cmd === '/goal' || cmd.startsWith('/goal ')) {
    const arg = cmd.slice('/goal'.length).trim();
    if (arg === 'pause' || arg === 'resume' || arg === 'cancel') client.controlGoal(arg);
    else if (arg) void client.createGoal(arg);
    else client.toggleGoalMode();
    return;
  }
  // `/btw <question>` opens (creating if needed) the side chat and asks it; bare
  // `/btw` toggles the side-chat tab for the active session.
  if (cmd === '/btw' || cmd.startsWith('/btw ')) {
    const arg = cmd.slice('/btw'.length).trim();
    if (!arg && client.sideChatVisible.value) {
      // Use the detail-layer close so detailTarget is cleared too; the bare
      // client.closeSideChat() only hides the panel and leaves detailTarget set.
      closeSideChat();
    } else {
      void openSideChatTab(arg || undefined);
    }
    return;
  }
  switch (cmd) {
    // `/new` and `/clear` are aliases: both open the onboarding composer. The
    // session is only created when the user sends the first message.
    case '/new':
    case '/clear':
      handleCreateSession();
      break;
    case '/fork':
      void client.forkSession();
      break;
    case '/export':
      void handleExportSession();
      break;
    case '/undo':
      void client.undo();
      break;
    case '/plan':
      client.togglePlanMode();
      break;
    case '/status':
      showStatusPanel.value = true;
      break;
    case '/login':
      openLogin();
      break;
    default: {
      // Not a built-in command → treat it as a session skill activation
      // (the user picked `/skill:<skill>` from the menu, or typed
      // `/<skill> args`). Strip the `skill:` display prefix — the REST API
      // takes the bare skill name. The daemon answers an unknown name with
      // skill.not_found, surfaced as a warning, so a stray slash is harmless.
      // With no active session, create one first (same path as the first
      // prompt) so the activation isn't silently dropped on the new-session
      // screen.
      const space = cmd.indexOf(' ');
      const name = stripSkillPrefix((space === -1 ? cmd : cmd.slice(0, space)).slice(1));
      const args = space === -1 ? undefined : cmd.slice(space + 1).trim() || undefined;
      if (!name) break;
      if (!client.activeSessionId.value && client.activeWorkspaceId.value) {
        void client.startSessionAndActivateSkill(client.activeWorkspaceId.value, name, args);
      } else {
        void client.activateSkill(name, args);
      }
      break;
    }
  }
}

function handleUnqueue(index: number): void {
  client.unqueue(index);
}

// Editing a queued message: the Composer already loaded the text into its
// textarea; here we just remove it from the queue so it isn't sent twice.
function handleEditQueued(index: number): void {
  client.unqueue(index);
}

function handleReorderQueue(payload: { from: number; to: number }): void {
  client.reorderQueue(payload.from, payload.to);
}

async function handleSubmit(payload: SubmitPayload): Promise<void> {
  const wsId = client.activeWorkspaceId.value;
  if (!client.activeSessionId.value && wsId) {
    await client.startSessionAndSendPrompt(wsId, payload.text, payload.attachments);
    return;
  }
  if (!client.activeSessionId.value && !wsId) {
    pendingWorkspaceSubmit.value = payload;
    showAddWorkspace.value = true;
    return;
  }
  void client.sendPrompt(payload.text, payload.attachments);
}

// Failed-turn recovery: re-send the last user prompt through the ordinary send
// path. Approximates the reference's daemon-side resumeTurn — this wire has no
// resume endpoint, so we resubmit the user's own text (chat-turn attachments
// are not replayed).
async function handleContinueTurn(text: string): Promise<void> {
  const wsId = client.activeWorkspaceId.value;
  if (!client.activeSessionId.value && wsId) {
    await client.startSessionAndSendPrompt(wsId, text, []);
    return;
  }
  if (!client.activeSessionId.value) return;
  void client.sendPrompt(text);
}

async function handleAddWorkspace(root: string): Promise<void> {
  addWorkspaceError.value = null;
  const added = await client.addWorkspaceByPath(root);
  // Keep the picker open (and the pending submission intact) when the daemon
  // rejects the path so the user can retry with a valid one. The error is shown
  // inline in the picker. Closing via Escape goes through handleCloseAddWorkspace,
  // which drops the pending prompt.
  if (!added) {
    addWorkspaceError.value = t('workspace.addFailed');
    return;
  }
  showAddWorkspace.value = false;
  const pending = pendingWorkspaceSubmit.value;
  pendingWorkspaceSubmit.value = null;
  const wsId = client.activeWorkspaceId.value;
  if (pending && wsId) {
    await client.startSessionAndSendPrompt(wsId, pending.text, pending.attachments);
  }
}

function handleCloseAddWorkspace(): void {
  pendingWorkspaceSubmit.value = null;
  addWorkspaceError.value = null;
  showAddWorkspace.value = false;
}

// Folder-drop from the sidebar (desktop shell): one addWorkspace call per
// dropped path through the same flow as the picker confirm. A rejected path
// opens the picker with the inline error so the user can see and fix it.
async function handleAddWorkspacePaths(paths: string[]): Promise<void> {
  for (const root of paths) {
    addWorkspaceError.value = null;
    const added = await client.addWorkspaceByPath(root);
    if (!added) {
      addWorkspaceError.value = t('workspace.addFailed');
      showAddWorkspace.value = true;
      return;
    }
  }
}

// Generate a session title via the daemon's managed chat_title tool. The
// daemon persists the title itself (the list refreshes via the WS event); the
// result streams back into the rename input through the callback. Unavailable
// generation surfaces as an info toast, mirroring the reference UI.
async function handleGenerateSessionTitle(
  sessionId: string,
  onTitle: (title: string | null) => void,
): Promise<void> {
  const title = await client.generateSessionTitle(sessionId);
  if (title === null) {
    titleNoticeToast.value = t('sidebar.genTitleUnavailable');
    if (titleNoticeToastTimer !== null) clearTimeout(titleNoticeToastTimer);
    titleNoticeToastTimer = setTimeout(() => {
      titleNoticeToast.value = null;
      titleNoticeToastTimer = null;
    }, 5000);
  }
  onTitle(title);
}

function focusComposerAfterDraft(): void {
  void nextTick(() => {
    conversationPaneRef.value?.focusComposer();
  });
}

// Primary "+ New": enter the draft state in the current workspace so the
// right pane shows the onboarding composer. The session is only created when
// the user sends the first message.
function handleCreateSession(): void {
  const wsId = client.activeWorkspaceId.value;
  if (wsId) {
    client.openWorkspaceDraft(wsId);
  } else {
    client.clearActiveSession();
  }
  focusComposerAfterDraft();
}

// Workspace-level "+ New" (sidebar group or mobile switcher): enter the draft
// state in the chosen workspace. No backend session is created until the user
// actually sends a message.
function handleCreateSessionInWorkspace(workspaceId: string): void {
  client.openWorkspaceDraft(workspaceId);
  focusComposerAfterDraft();
}

// Chat header: open a GitHub PR in a new tab.
function openPr(url: string): void {
  if (url) window.open(url, '_blank', 'noopener');
}
</script>

<template>
  <div class="app-shell">
    <WindowControls />
    <ServerAuthDialog v-if="showServerAuth" />
    <section v-if="showAuthGate" class="auth-page">
      <div class="auth-page-inner">
        <svg ref="authLogoRef" class="auth-page-logo ch-logo" viewBox="0 0 32 22" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pythinker Code" @mousedown.prevent @click="blinkAuthLogo">
          <defs>
            <mask id="authPythinkerEyes" maskUnits="userSpaceOnUse">
              <rect x="0" y="0" width="32" height="22" fill="#fff" />
              <g class="ch-eyes" fill="#000">
                <rect class="ch-eye" x="11.8" y="7" width="2.8" height="8" rx="1.4" />
                <rect class="ch-eye" x="17.4" y="7" width="2.8" height="8" rx="1.4" />
              </g>
            </mask>
          </defs>
          <rect x="1" y="1" width="30" height="20" rx="6" fill="var(--logo)" mask="url(#authPythinkerEyes)" />
        </svg>
        <div class="auth-page-copy">
          <h1>{{ t('app.authPageTitle') }}</h1>
          <p>{{ t('app.authPageMessage') }}</p>
        </div>
        <Button class="auth-page-btn" variant="primary" @click="openLogin">
          <Icon name="log-in" size="md" />
          <span>{{ t('app.authPageLogin') }}</span>
        </Button>
      </div>
    </section>
    <div
      v-else
      class="app"
      :class="{
        mobile: isMobile,
        'sidebar-collapsed': sidebarCollapsed && !isMobile,
        'macos-desktop': isMacosDesktop,
      }"
      :style="{ '--preview-w': previewPanelWidth + 'px' }"
    >
    <!-- Desktop navigation: workspace rail + resizable session column. -->
    <template v-if="!isMobile">
      <Sidebar
        :collapsed="sidebarCollapsed"
        :dragging="sidebarDragging"
        :col-width="sideWidth"
        :active-workspace="client.visibleWorkspace.value"
        :active-workspace-id="client.activeWorkspaceId.value"
        :sessions="client.sessionsForView.value"
        :archived-sessions="archivedSessions"
        :pinned-ids="client.pinnedSessionIds.value"
        :pinned-collapsed="client.pinnedCollapsed.value"
        :groups="client.workspaceGroups.value"
        :active-id="client.activeSessionId.value"
        :attention-by-session="client.attentionBySession.value"
        :pending-by-session="client.pendingBySession.value"
        :unread-by-session="client.unreadBySession.value"
        :workspace-sort-mode="client.workspaceSortMode.value"
        :workspaces="client.workspacesView.value"
        :tabs-enabled="client.config.value?.experimental?.sidebarTabs === true"
        @select="client.selectSession($event)"
        @create="handleCreateSession"
        @create-in-workspace="handleCreateSessionInWorkspace($event)"
        @select-workspace="client.openWorkspace($event)"
        @add-workspace="showAddWorkspace = true"
        @add-workspace-paths="handleAddWorkspacePaths"
        @rename="renameSidebarSession"
        @generate-title="handleGenerateSessionTitle"
        @archive="markSessionDone($event)"
        @restore="reopenSession($event)"
        @pin="client.togglePinnedSession($event)"
        @reorder-pins="client.reorderPinnedSessions($event)"
        @toggle-pinned-collapsed="client.togglePinnedCollapsed()"
        @set-session-emoji="setSidebarSessionEmoji"
        @load-done-sessions="loadDoneSessions"
        @fork="(id) => client.forkSession(id)"
        @export="(id) => handleExportSession(id)"
        @rename-workspace="(id, name) => client.renameWorkspace(id, name)"
        @delete-workspace="confirmDeleteWorkspace($event)"
        @reorder-workspaces="client.reorderWorkspaces($event)"
        @set-workspace-sort-mode="client.setWorkspaceSortMode($event)"
        @load-more-sessions="(id) => void client.loadMoreSessions(id)"
        @load-all-sessions="void client.loadAllSessions()"
        @open-settings="openSettings()"
        @open-session-admin="openSessionAdmin"
        @collapse="toggleSidebarCollapse"
      />
      <ResizeHandle
        v-show="!sidebarCollapsed"
        class="side-handle"
        :storage-key="SIDEBAR_WIDTH_KEY"
        :default-width="SIDEBAR_DEFAULT"
        :min="SIDEBAR_MIN"
        :max="sidebarMax"
        @update:width="sessionColWidth = $event"
        @update:dragging="sidebarDragging = $event"
      />
    </template>

    <!-- Mobile navigation: slim top bar (switcher + settings sheets). -->
    <MobileTopBar
      v-else
      :workspace="client.visibleWorkspace.value"
      :session-title="activeSessionTitle"
      :running="running"
      :branch="client.status.value.branch"
      :session-count="activeWorkspaceSessionCount"
      @open-switcher="showMobileSwitcher = true"
      @open-settings="showMobileSettings = true"
    />

    <SessionAdminView
      v-if="showSessionAdmin"
      :open-sessions="adminOpenSessions"
      :workspaces="client.workspacesView.value"
      :load-archived="loadAdminArchivedSessions"
      :archive-session="markSessionDone"
      :restore-session="reopenSession"
      :run-batch="runAdminBatch"
      @open="showSessionAdmin = false; client.selectSession($event)"
      @rename="(id, title) => client.renameSession(id, title)"
      @fork="(id) => client.forkSession(id)"
      @export="(id) => handleExportSession(id)"
      @back="showSessionAdmin = false"
    />

    <ConversationPane
      v-else
      ref="conversationPaneRef"
      :mobile="isMobile"
      :turns="client.turns.value"
      :session-id="client.activeSessionId.value"
      :approvals="client.pendingApprovals.value"
      :changes="client.changes.value"
      :git-info="client.gitInfo.value"
      :tasks="client.tasks.value"
      :todos="client.todos.value"
      :goal="client.goal.value"
      :activation-badges="client.activationBadges.value"
      :status="client.status.value"
      :thinking="client.thinking.value"
      :plan-mode="client.planMode.value"
      :plan-armed="client.planArmed.value"
      :session-plans="client.sessionPlans.value"
      :overlay-open="overlayOpen"
      :goal-mode="client.goalMode.value"
      :dynamic-workflow-mode="client.dynamicWorkflowMode.value"
      :models="client.models.value"
      :starred-ids="client.starredModelIds.value"
      :skills="client.skills.value"
      :questions="client.questions.value"
      :pending-question-actions="client.pendingQuestionActions"
      :pending-approval-actions="client.pendingApprovalActions"
      :running="running"
      :turn-active="client.turnActive.value"
      :queued="client.queued.value"
      :search-files="client.searchFiles"
      :upload-image="client.uploadImage"
      :working="client.working.value"
      :starting="client.isStartingFirstPrompt.value"
      :fast-moon="client.fastMoon.value"
      :file-reload-key="client.activeSessionId.value"
      :session-loading="client.sessionLoading.value"
      :compaction="client.compaction.value"
      :has-more-messages="client.hasMoreMessages.value"
      :loading-more="client.loadingMoreMessages.value"
      :loading-more-error="client.loadMoreMessagesError.value"
      :load-older-messages="client.loadOlderMessages"
      :workspace-name="client.visibleWorkspace.value?.name"
      :workspace-root="client.visibleWorkspace.value?.root ?? client.status.value.cwd"
      :git-diff-stats="client.gitDiffStats.value"
      :workspaces="client.workspacesView.value"
      :active-workspace-id="client.activeWorkspaceId.value"
      :session-title="activeSessionTitle"
      :pr="client.activePullRequest.value"
      :conversation-toc="client.conversationToc.value"
      :last-turn-reason="activeLastTurnReason"
      :turn-error-kind="activeTurnError?.reason === 'max_steps' ? 'max_steps' : undefined"
      :turn-error-message="activeTurnError?.message"
      :session-done="activeSessionDone"
      :pinned="client.pinnedSessionIds.value.includes(client.activeSessionId.value ?? '')"
      :recent-sessions="activeWorkspaceRecentSessions"
      @open-changes="openDiffDetail()"
      @select-workspace="handleCreateSessionInWorkspace($event)"
      @add-workspace="showAddWorkspace = true"
      @open-pr="openPr"
      @submit="handleSubmit($event)"
      @steer="client.steerPrompt($event.text, $event.attachments)"
      @approval="(approvalId, response) => client.respondApproval(approvalId, response)"
      @cancel-task="client.cancelTask($event)"
      @answer="(questionId, response) => client.respondQuestion(questionId, response)"
      @dismiss="(questionId) => client.dismissQuestion(questionId)"
      @command="handleCommand"
      @interrupt="client.abortCurrentPrompt()"
      @unqueue="handleUnqueue"
      @edit-queued="handleEditQueued"
      @reorder-queue="handleReorderQueue"
      @set-permission="client.setPermission($event)"
      @set-thinking="client.setThinking($event)"
      @toggle-plan="client.togglePlanMode()"
      @toggle-workflow="client.toggleDynamicWorkflowMode()"
      @toggle-goal="client.toggleGoalMode()"
      @create-goal="client.createGoal($event)"
      @control-goal="client.controlGoal($event)"
      @refresh-git-status="client.activeSessionId.value && client.loadGitStatus(client.activeSessionId.value)"
      @rename-session="(id, title) => client.renameSession(id, title)"
      @fork-session="(id) => client.forkSession(id)"
      @archive-session="markSessionDone($event)"
      @restore-session="reopenSession($event)"
      @select-session="client.selectSession($event)"
      @toggle-pin="client.togglePinnedSession($event)"
      @open-session-admin="openSessionAdmin"
      @export-session="(id) => handleExportSession(id)"
      @compact="client.compact()"
      @pick-model="openModelPicker()"
      @select-model="handleComposerSelectModel($event)"
      @open-file="openFilePreview($event)"
      @open-media="openMediaPreview($event)"
      @open-compaction="openCompactionPanel($event)"
      @open-agent="openAgentPanel($event)"
      @open-tool-diff="openToolDiff($event)"
      @open-turn-diff="openTurnDiff($event)"
      @edit-message="handleEditMessage"
      @continue-turn="handleContinueTurn"
    />

    <!-- Sidebar toggle — floating only while the sidebar is COLLAPSED on
         every platform: the in-header collapse button serves the expanded
         state. It must come AFTER ConversationPane in the DOM: Electron
         computes the window-drag region in tree order (drag rects union,
         no-drag rects subtract), so a no-drag element placed before the
         ChatHeader drag region would have its hole painted back over —
         making the button an inert drag area. -->
    <IconButton
      v-if="!isMobile && sidebarCollapsed"
      class="sidebar-toggle-btn"
      size="sm"
      :label="sidebarCollapsed ? t('sidebar.expandSidebar') : t('sidebar.collapseSidebar')"
      @click="toggleSidebarCollapse"
    >
      <Icon :name="sidebarCollapsed ? 'panel-expand' : 'panel-collapse'" />
    </IconButton>

    <!-- Floating "New chat" while the sidebar is collapsed: mirrors the
         sidebar's + New action (draft in the active workspace). Rendered next
         to the toggle button and hidden on mobile. -->
    <IconButton
      v-if="!isMobile && sidebarCollapsed"
      class="new-chat-btn"
      size="sm"
      :label="t('sidebar.newChat')"
      @click="handleCreateSession"
    >
      <Icon name="chat-new" />
    </IconButton>

    <ResizeHandle
      v-if="!showSessionAdmin && sidePanelVisible && !isMobile"
      class="preview-handle"
      :storage-key="PREVIEW_WIDTH_KEY"
      :default-width="previewDefaultWidth"
      :min="PREVIEW_MIN"
      :max="previewMax"
      reverse
      :aria-label="t('layout.resizePreviewAria')"
      @update:width="previewWidth = $event"
      @update:dragging="panelDragging = $event"
    />

    <!-- Desktop: the aside is a PERMANENT grid column whose width transitions
         0 ↔ var(--preview-w) — opening genuinely squeezes the chat column over
         (one animation, no slide-over hacks). Mobile mounts only when open
         (full-screen overlay). Content stays v-if'd, so a closed panel is a
         zero-width empty shell. -->
    <aside
      v-if="!showSessionAdmin && (!isMobile || sidePanelVisible)"
      class="global-preview"
      :class="{ open: sidePanelVisible, mobile: isMobile, 'no-anim': panelDragging || panelSwitching }"
      role="complementary"
      :aria-label="t('layout.detailPanelAria')"
      :aria-hidden="!sidePanelVisible"
    >
      <ThinkingPanel
        v-if="detailTarget === 'compaction' && compactionPanelVisible"
        :text="compactionPanelText ?? ''"
        :subtitle="t('conversation.summaryTitle')"
        @close="closeCompactionPanel"
      />
      <AgentDetailPanel
        v-else-if="detailTarget === 'agent' && agentPanelMember"
        :member="agentPanelMember"
        :turns="agentPanelTurns"
        :running="agentPanelRunning"
        :loading="agentPanelLoading"
        :load-error="agentPanelLoadError"
        :has-more="agentPanelHasMore"
        :loading-more="agentPanelLoadingMore"
        :load-more-error="agentPanelLoadMoreError"
        @close="closeAgentPanel"
        @load-older-messages="loadOlderAgentMessages"
        @open-file="openFilePreview($event)"
        @open-media="openMediaPreview($event)"
        @open-agent="openAgentPanel($event)"
        @open-turn-diff="openTurnDiff($event)"
      />
      <SideChatPanel
        v-else-if="detailTarget === 'btw' && btwVisible"
        :turns="client.sideChatTurns.value"
        :running="client.sideChatRunning.value"
        :sending="client.sideChatSending.value"
        @send="client.sendSideChatPrompt($event)"
        @close="closeSideChat"
      />
      <DiffView
        v-else-if="detailTarget === 'diff'"
        :mode="detailDiffMode"
        :changes="client.changes.value"
        :git-info="client.gitInfo.value"
        :file-diff="client.fileDiff.value"
        :selected-diff-path="client.selectedDiffPath.value"
        :file-diff-loading="client.fileDiffLoading.value"
        closable
        @open="selectDiffFile"
        @back="detailDiffMode = 'list'; detailDiffPath = null; client.clearFileDiff()"
        @close="closeDiffDetail"
      />
      <ToolDiffPanel
        v-else-if="detailTarget === 'toolDiff' && toolDiffTarget"
        :target="toolDiffTarget"
        @close="closeToolDiff"
      />
      <TurnDiffPanel
        v-else-if="detailTarget === 'turnDiff' && turnDiffTarget"
        :changes="turnDiffTarget.changes"
        :cwd="client.visibleWorkspace.value?.root ?? client.status.value.cwd"
        @open-file="openFilePreview($event)"
        @close="closeTurnDiff"
      />
      <EditorPanel
        v-else-if="detailTarget === 'editor'"
        @close="handleCloseEditor"
      />
      <FilePreview
        v-else-if="detailTarget === 'file'"
        :file="previewFile"
        :loading="previewLoading"
        :error="previewError"
        :line="previewTarget?.line"
        :download-url="previewDownloadUrl"
        closable
        :external-actions="previewExternalActions"
        :editable="client.fsWriteSupported.value && client.activeSessionId.value !== null"
        :open-file="openFilePreview"
        @close="closeFilePreview"
        @open-external="openPreviewInEditor"
        @reveal="revealPreviewFile"
        @open-editor="handleOpenInEditor($event)"
      />
    </aside>

    <!-- Internal-build tag — pinned to the app's bottom-right corner, above
         whatever pane happens to be there. Purely informational: pointer
         events pass through so it never blocks clicks. -->
    <InternalBuildBanner class="internal-build-fab" />

    <MediaLightbox
      v-if="lightboxMedia && lightboxSrc"
      :media="lightboxMedia"
      :src="lightboxSrc"
      @close="closeMediaLightbox"
    />

    <!-- Model Picker overlay -->
    <ModelPicker
      v-if="showModelPicker"
      :models="client.models.value"
      :current="client.status.value.modelId"
      :starred-ids="client.starredModelIds.value"
      :loading="modelsLoading"
      :unavailable="modelsUnavailable"
      @select="handleSelectModel($event)"
      @toggle-star="client.toggleStarModel($event)"
      @close="showModelPicker = false"
    />

    <!-- Status panel overlay (/status) — renders current client state, no daemon call -->
    <StatusPanel
      v-if="showStatusPanel"
      :status="client.status.value"
      :thinking="statusPanelThinking"
      :plan-mode="client.planMode.value"
      :dynamic-workflow-mode="client.dynamicWorkflowMode.value"
      :cost-usd="client.sessionCost.value"
      @close="showStatusPanel = false"
    />

    <!-- Add Workspace overlay (daemon folder browser + paste-path fallback) -->
    <AddWorkspaceDialog
      v-if="showAddWorkspace"
      :browse-fs="client.browseFs"
      :get-fs-home="client.getFsHome"
      :default-path="client.visibleWorkspace.value?.root ?? client.status.value.cwd"
      :error="addWorkspaceError"
      @add="handleAddWorkspace($event)"
      @close="handleCloseAddWorkspace"
    />

    <!-- Global connecting splash on first load (until the daemon round-trips) -->
    <Transition name="gload-fade">
      <GlobalLoading v-if="!client.initialized.value" :issue="client.connectIssue.value" />
    </Transition>

    <!-- First-run onboarding overlay. Held back
         until the first load settled so it can't cover the connecting splash
         (it teleports to <body> and would float above the retry error). -->
    <Onboarding
      v-if="client.initialized.value && showOnboarding && !showAuthGate"
      @complete="completeOnboarding"
      @skip="completeOnboarding"
    />

    <!-- Floating warnings / agent errors (e.g. a 403 from the model provider) -->
    <WarningToasts :warnings="client.warnings.value" @dismiss="client.dismissWarning" />
    <UpdateToast />
    <div class="action-toast-stack">
      <ActionToast
        v-if="sessionActionToast"
        :key="`${sessionActionToast.kind}:${sessionActionToast.ids.join(',')}`"
        :duration="8000"
        @dismiss="sessionActionToast = null"
      >
        <span>
          {{ t(
            sessionActionToast.kind === 'done' ? 'admin.actionArchived' : 'admin.actionRestored',
            { n: sessionActionToast.ids.length },
          ) }}
        </span>
        <button type="button" class="session-action-undo" @click="undoSessionAction">
          {{ t('sidebar.archiveToastUndo') }}
        </button>
      </ActionToast>
      <ActionToast
        v-if="exportActionToast"
        :key="`${exportActionToast.sessionId}:${exportActionToast.state}`"
        :duration="exportActionToast.state === 'running' ? 60000 : 4000"
        @dismiss="exportActionToast = null"
      >
        {{ t(exportActionToast.state === 'running' ? 'admin.exporting' : 'admin.exported') }}
      </ActionToast>
      <ActionToast
        v-if="titleNoticeToast"
        :key="titleNoticeToast"
        :duration="5000"
        @dismiss="titleNoticeToast = null"
      >
        {{ titleNoticeToast }}
      </ActionToast>
    </div>

    <!-- KAP/daemon debug panel (opt-in, ?debug=1) -->
    <DebugPanel v-if="debugEnabled" />

    <!-- Mobile switcher bottom-sheet: workspace groups + sessions (mirrors the
         desktop sidebar) -->
    <MobileSwitcherSheet
      v-if="isMobile"
      v-model="showMobileSwitcher"
      :groups="client.workspaceGroups.value"
      :active-workspace-id="client.activeWorkspaceId.value"
      :active-id="client.activeSessionId.value"
      :attention-by-session="client.attentionBySession.value"
      :attention-by-workspace="client.attentionByWorkspace.value"
      @select="client.selectSession($event)"
      @create="handleCreateSession"
      @create-in-workspace="handleCreateSessionInWorkspace($event)"
      @add-workspace="showAddWorkspace = true"
      @rename="(id, title) => client.renameSession(id, title)"
      @archive="markSessionDone($event)"
      @delete-workspace="confirmDeleteWorkspace($event)"
      @load-more="(id) => void client.loadMoreSessions(id)"
    />

    <!-- Mobile settings bottom-sheet: session controls + app prefs + auth -->
    <MobileSettingsSheet
      v-if="isMobile"
      v-model="showMobileSettings"
      :status="client.status.value"
      :thinking="client.thinking.value"
      :models="client.models.value"
      :plan-mode="client.planMode.value"
      :goal-mode="client.goalMode.value"
      :goal="client.goal.value"
      :dynamic-workflow-mode="client.dynamicWorkflowMode.value"
      :color-scheme="client.colorScheme.value"
      :ui-font-size="client.uiFontSize.value"
      :auth-ready="client.authReady.value"
      :conversation-toc="client.conversationToc.value"
      :server-version="client.serverVersion.value"
      @pick-model="openModelPicker()"
      @set-thinking="client.setThinking($event)"
      @toggle-plan="client.togglePlanMode()"
      @toggle-workflow="client.toggleDynamicWorkflowMode()"
      @toggle-goal="client.toggleGoalMode()"
      @control-goal="client.controlGoal($event)"
      @set-permission="client.setPermission($event)"
      @set-color-scheme="client.setColorScheme($event)"
      @set-ui-font-size="client.setUiFontSize($event)"
      @set-conversation-toc="client.setConversationToc($event)"
      @login="() => { showMobileSettings = false; openLogin(); }"
      @logout="client.logout"
    />
    </div>

    <!-- Settings stays outside the auth/app branch so provider setup can open
         from the auth gate and from every in-app entry point. -->
    <SettingsDialog
      v-if="showSettings"
      :color-scheme="client.colorScheme.value"
      :accent="client.accent.value"
      :ui-font-size="client.uiFontSize.value"
      :auth-ready="client.authReady.value"
      :account-model="client.defaultModel.value"
      :notify="client.notifyOnComplete.value"
      :notify-question="client.notifyOnQuestion.value"
      :notify-approval="client.notifyOnApproval.value"
      :notify-permission="client.notifyPermission.value"
      :sound="client.soundOnComplete.value"
      :conversation-toc="client.conversationToc.value"
      :config="client.config.value"
      :models="client.models.value"
      :config-saving="configSaving"
      :server-version="client.serverVersion.value"
      :backend="client.backend.value"
      :initial-tab="settingsInitialTab"
      @set-color-scheme="client.setColorScheme($event)"
      @set-accent="client.setAccent($event)"
      @set-ui-font-size="client.setUiFontSize($event)"
      @set-notify="client.setNotifyOnComplete($event)"
      @set-notify-question="client.setNotifyOnQuestion($event)"
      @set-notify-approval="client.setNotifyOnApproval($event)"
      @set-sound="client.setSoundOnComplete($event)"
      @set-conversation-toc="client.setConversationToc($event)"
      @update-config="handleUpdateConfig($event)"
      @logout="client.logout"
      @open-onboarding="() => { showSettings = false; openOnboarding(); }"
      @close="showSettings = false"
    />

    <ConfirmDialogHost />
  </div>
</template>

<style scoped>
/* Global connecting splash fade-out (only the leave matters; it mounts instantly). */
.gload-fade-leave-active { transition: opacity 0.28s ease; }
.gload-fade-leave-to { opacity: 0; }

.app-shell {
  /* Pinned to the visual viewport (see setAppHeight): --app-top tracks iOS's
     keyboard pan and --app-height shrinks with the keyboard, so the shell
     always covers exactly the visible area. Fixed positioning keeps it out of
     the document flow that iOS pans. */
  position: fixed;
  top: var(--app-top, 0px);
  left: 0;
  right: 0;
  height: 100vh;
  height: 100dvh;
  height: var(--app-height, 100dvh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}
.auth-page {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--bg);
  color: var(--color-text);
  box-sizing: border-box;
}
.auth-page-inner {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 18px;
}
.auth-page-logo {
  width: 64px;
  height: 44px;
  flex: none;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.18s ease;
}
.auth-page-logo:hover {
  transform: scale(1.06);
}
.auth-page-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.auth-page-copy h1 {
  margin: 0;
  font-family: var(--sans);
  font-size: 30px;
  line-height: 1.15;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--color-text);
}
.auth-page-copy p {
  margin: 0;
  font-family: var(--sans);
  font-size: var(--ui-font-size-lg);
  line-height: 1.55;
  color: var(--dim);
}
.app {
  --preview-w: 460px;
  flex: 1;
  min-height: 0;
  position: relative;
  display: grid;
  /* sidebar | 0-width handle | conversation | 0-width handle | right panel.
     The 4px ResizeHandles overflow their zero-width tracks via negative margins
     so the whole strip is grabbable without consuming layout space. */
  /* Both side tracks are PERMANENT (auto = follows the aside's width, 0 when
     closed/collapsed) — opening or collapsing animates the aside's width, so
     the conversation column is squeezed over smoothly instead of snapping to a
     new template. Every column is pinned explicitly (grid-column 1–5) so a
     display:none handle can't shift auto-placement. */
  grid-template-columns: auto 0 minmax(0, 1fr) 0 auto;
  background: var(--bg);
  color: var(--color-text);
  overflow: hidden;
  box-sizing: border-box;
}
/* Grid children must be allowed to shrink below content height so that only
   the inner scroll containers (.panes / .sessions) scroll — otherwise the
   whole .app overflows and the page (incl. sidebar) scrolls together. */
.app > * {
  min-height: 0;
  min-width: 0;
}

/* Pin every desktop grid child to its track so auto-placement can never
   reshuffle columns when a handle is display:none (v-show/v-if). */
.app > .side { grid-column: 1; }
.side-handle { grid-column: 2; }
.app:not(.mobile) > .con { grid-column: 3; }
.preview-handle { grid-column: 4; }

/* Sidebar toggle — floating button pinned to the top-left corner. On macOS
   desktop it is resident (rendered in both states beside the traffic lights);
   on Windows/web it only appears while the sidebar is collapsed (the collapse
   button lives inside the sidebar header). While collapsed the conversation
   header pads left so its content clears the button (global block below). */
.sidebar-toggle-btn {
  position: absolute;
  /* Vertically centered in the 48px conversation header. */
  top: 11px;
  left: 16px;
  z-index: var(--z-sticky);
  /* Fade in on appearance (Windows/web: only rendered while collapsed, so
     this plays as the sidebar finishes sliding away). macOS disables it. */
  animation: sidebar-toggle-btn-in 0.18s var(--ease-out) 0.12s backwards;
  /* Floats over the macOS-desktop window-drag header; keep it clickable. */
  -webkit-app-region: no-drag;
}
/* macOS desktop (hidden title bar): the collapsed state floats the button
   beside the traffic lights (green light's right edge ≈ 68px; 72 keeps a gap
   that matches the lights' own 8px rhythm); no entrance animation since the
   drag-region union is recomputed anyway. */
.app.macos-desktop .sidebar-toggle-btn {
  left: 72px;
  animation: none;
}
@keyframes sidebar-toggle-btn-in {
  from { opacity: 0; }
}

/* Floating "New chat" — sits directly right of the toggle (sm IconButton is
   26px wide: 16 + 26 = 42; macOS: 72 + 26 = 98). Same fade-in + no-drag
   contract as the toggle. */
.new-chat-btn {
  position: absolute;
  top: 11px;
  left: 42px;
  z-index: var(--z-sticky);
  animation: sidebar-toggle-btn-in 0.18s var(--ease-out) 0.12s backwards;
  -webkit-app-region: no-drag;
}
.app.macos-desktop .new-chat-btn {
  left: 98px;
}

/* Internal-build tag pinned to the app's bottom-right corner (desktop app
   only — the component renders nothing elsewhere). Informational: never
   intercepts pointer input. */
.internal-build-fab {
  position: absolute;
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: var(--z-sticky);
  pointer-events: none;
}

/* Mobile single-column shell: slim top bar (auto) over the full-width
   conversation pane (1fr). No rail, no session column, no resize handle. */
.app.mobile {
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
}

/* The right-side panel column: a permanent grid item whose width animates
   0 ↔ var(--preview-w). The CONTENT keeps a fixed width (and carries the
   left hairline) so it clips during the transition instead of reflowing. */
.global-preview {
  grid-column: 5;
  min-width: 0;
  min-height: 0;
  width: 0;
  background: var(--bg);
  overflow: hidden;
  transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.global-preview.open {
  width: var(--preview-w);
}
/* While dragging the resize handle, follow the pointer 1:1. */
.global-preview.no-anim {
  transition: none;
}
.global-preview:not(.mobile) > * {
  width: var(--preview-w);
  height: 100%;
  box-sizing: border-box;
  border-left: 1px solid var(--line);
}
.global-preview.mobile {
  position: fixed;
  inset: 0;
  z-index: var(--z-sticky);
  width: auto;
  transition: none;
  border-top: 2px solid var(--color-text);
}

.action-toast-stack {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  pointer-events: none;
}
.session-action-undo {
  margin-top: var(--space-2);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.session-action-undo:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

@media (max-width: 640px) {
  .action-toast-stack {
    right: var(--space-3);
    bottom: max(var(--space-3), var(--safe-bottom));
    left: var(--space-3);
    align-items: stretch;
  }
  .auth-page {
    align-items: flex-start;
    padding:
      max(48px, var(--safe-top))
      max(20px, var(--safe-right))
      max(24px, var(--safe-bottom))
      max(20px, var(--safe-left));
  }
  .auth-page-copy h1 {
    font-size: 26px;
  }
  .auth-page-btn {
    width: 100%;
  }
}
</style>

<style>
:root {
  /* Right-side panel headers (ThinkingPanel / FilePreview / DiffView / SideChatPanel)
     share the same 48px height as the conversation header so the hairline reads as
     one continuous line across the layout. */
  --panel-head-h: 48px;
}

/* Sidebar collapsed (desktop): the conversation header pads left so its
   content clears the floating sidebar toggle (.sidebar-toggle-btn) — and the
   macOS traffic lights on desktop builds. Animated in step with the sidebar
   width transition. Cross-component rule (ChatHeader renders the header), so
   it lives in this global block. */
.app:not(.mobile) .chat-header {
  transition: padding-left 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.app.sidebar-collapsed .chat-header {
  padding-left: 52px;
}
.app.sidebar-collapsed.macos-desktop .chat-header {
  padding-left: 108px;
}
</style>
