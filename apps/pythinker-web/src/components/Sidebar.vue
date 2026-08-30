<!-- apps/pythinker-web/src/components/Sidebar.vue -->
<!-- Unified sidebar: session groups with collapsible workspace headers.
     The old workspace rail and workspace tabs have been removed;
     workspace switching, folding and renaming all live in the group header. -->
<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyTextToClipboard } from '../lib/clipboard';
import {
  loadCollapsedWorkspaces,
  saveCollapsedWorkspaces,
} from '../lib/storage';
import { moveInOrder, type DropPosition, type WorkspaceSortMode } from '../lib/workspaceOrder';
import type {
  FilePreviewRequest,
  Session,
  WorkspaceGroup as WorkspaceGroupType,
  WorkspaceView,
} from '../types';
import type { AppWorkspace } from '../api/types';
import SearchSessionsDialog from './dialogs/SearchSessionsDialog.vue';
import WorkspaceGroup from './WorkspaceGroup.vue';
import WorkspaceExplorer from './WorkspaceExplorer.vue';
import { isDesktop, isMacosDesktop } from '../lib/desktopFlag';
import { useDesktopUpdate } from '../composables/useDesktopUpdate';
import AsyncLoadFailed from './ui/AsyncLoadFailed.vue';
import ErrorBoundary from './ui/ErrorBoundary.vue';
import IconButton from './ui/IconButton.vue';
import Icon from './ui/Icon.vue';
import Kbd from './ui/Kbd.vue';
import Menu from './ui/Menu.vue';
import MenuItem from './ui/MenuItem.vue';
import Pill from './ui/Pill.vue';
import PinnedSessionList from './PinnedSessionList.vue';
import ReleaseNotes from './ReleaseNotes.vue';
import SessionRow from './SessionRow.vue';

const { t } = useI18n();
const update = useDesktopUpdate();

const props = withDefaults(
  defineProps<{
    activeWorkspace: WorkspaceView | null;
    activeWorkspaceId: string | null;
    sessions: Session[];
    /** All known workspaces — powers the search dialog's workspace hits. */
    workspaces?: AppWorkspace[];
    archivedSessions?: Session[];
    pinnedIds?: string[];
    pinnedCollapsed?: boolean;
    groups: WorkspaceGroupType[];
    activeId: string;
    /** Current workspace sort mode — drives the section-header sort button. */
    workspaceSortMode: WorkspaceSortMode;
    attentionBySession?: Record<string, number>;
    /** Per-session pending counts split by kind, for the coloured tags. */
    pendingBySession?: Record<string, { approvals: number; questions: number }>;
    unreadBySession?: Record<string, boolean>;
    /** Width (px) of the session column, driven by the App resize handle. */
    colWidth?: number;
    /** True when the sidebar is collapsed: the container animates to width 0
     *  (content keeps `colWidth` and is clipped), then hides itself. */
    collapsed?: boolean;
    /** True while the resize handle is dragged — disables the width transition
     *  so the sidebar follows the pointer 1:1. */
    dragging?: boolean;
    /** Enables the experimental Open / Done / Workspaces tab strip. */
    tabsEnabled?: boolean;
  }>(),
  {
    activeWorkspace: null,
    activeWorkspaceId: null,
    attentionBySession: () => ({}),
    pendingBySession: () => ({}),
    unreadBySession: () => ({}),
    archivedSessions: () => [],
    workspaces: () => [],
    pinnedIds: () => [],
    pinnedCollapsed: false,
    colWidth: 220,
    collapsed: false,
    dragging: false,
    tabsEnabled: false,
  },
);

const emit = defineEmits<{
  select: [sessionId: string];
  create: [];
  createInWorkspace: [workspaceId: string];
  selectWorkspace: [workspaceId: string];
  addWorkspace: [];
  /** Folder paths dropped onto the sidebar column (desktop shell only). */
  addWorkspacePaths: [paths: string[]];
  rename: [id: string, title: string];
  /** Generate a session title; the callback receives the title (or null). */
  generateTitle: [id: string, onTitle: (title: string | null) => void];
  archive: [id: string];
  restore: [id: string];
  pin: [id: string];
  reorderPins: [ids: string[]];
  togglePinnedCollapsed: [];
  setSessionEmoji: [id: string, emoji: string | null];
  loadDoneSessions: [];
  fork: [id: string];
  export: [id: string];
  renameWorkspace: [id: string, name: string];
  deleteWorkspace: [id: string];
  reorderWorkspaces: [ids: string[]];
  setWorkspaceSortMode: [mode: WorkspaceSortMode];
  loadMoreSessions: [workspaceId: string];
  loadAllSessions: [];
  openSettings: [];
  openSessionAdmin: [];
  openFile: [target: FilePreviewRequest];
  collapse: [];
}>();

const statusView = ref<'open' | 'done' | 'workspaces'>('open');
const explorerOpen = ref(false);
const explorerWorkspaceId = ref<string | null>(null);
const listView = ref<'flat' | 'grouped'>('grouped');
watch(() => props.tabsEnabled, (enabled) => {
  if (!enabled) statusView.value = 'open';
});
const pinnedSessions = computed(() => {
  const byId = new Map(props.sessions.map((session) => [session.id, session]));
  return props.pinnedIds.flatMap((id) => {
    const session = byId.get(id);
    return session ? [session] : [];
  });
});
const unpinnedSessions = computed(() =>
  props.sessions.filter((session) => !props.pinnedIds.includes(session.id)),
);
const unpinnedGroups = computed(() => props.groups.map((group) => ({
  ...group,
  sessions: group.sessions.filter((session) => !props.pinnedIds.includes(session.id)),
})));

// Done tab: archive sessions grouped by workspace (client-side grouping of the
// already-loaded list; only groups with at least one done session render).
const doneGroups = computed(() =>
  props.groups
    .map((group) => ({
      workspace: group.workspace,
      sessions: props.archivedSessions.filter(
        (session) => session.workspaceId === group.workspace.id,
      ),
    }))
    .filter((group) => group.sessions.length > 0),
);
const explorerGroup = computed(
  () => props.groups.find((group) => group.workspace.id === explorerWorkspaceId.value) ?? null,
);
const explorerWorkspace = computed(() => explorerGroup.value?.workspace ?? null);
const explorerSessionId = computed(() => {
  const group = explorerGroup.value;
  if (!group) return null;
  if (props.activeId && group.sessions.some((session) => session.id === props.activeId)) {
    return props.activeId;
  }
  return group.sessions[0]?.id ?? null;
});

function showStatus(status: 'open' | 'done' | 'workspaces'): void {
  statusView.value = status;
  if (status === 'done') emit('loadDoneSessions');
}

function chooseListView(view: 'flat' | 'grouped'): void {
  listView.value = view;
  closeSectionMenu();
}

function openSessionAdmin(): void {
  closeSectionMenu();
  emit('openSessionAdmin');
}

function toggleExplorer(workspaceId: string): void {
  if (explorerOpen.value && explorerWorkspaceId.value === workspaceId) {
    explorerOpen.value = false;
    return;
  }
  explorerWorkspaceId.value = workspaceId;
  explorerOpen.value = true;
}

// ---------------------------------------------------------------------------
// Session search dialog (Spotlight-style; filters title + last prompt)
// ---------------------------------------------------------------------------
const showSearch = ref(false);
const sessionSearchKeys = isAppleShortcutPlatform() ? ['⌘', 'K'] : ['Ctrl', 'K'];

function openSearch(): void {
  // Sessions are loaded per-workspace (first page only); lazily drain the rest
  // so the dialog's client-side filter covers everything.
  emit('loadAllSessions');
  showSearch.value = true;
}

function onSearchKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openSearch();
  }
}

onMounted(() => window.addEventListener('keydown', onSearchKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onSearchKeydown));

function isAppleShortcutPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/Mac|iPod|iPhone|iPad/.test(navigator.platform)) return true;

  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return userAgentData?.platform === 'macOS' || userAgentData?.platform === 'iOS';
}

// Scroll-linked header seam: the .search-wrap bottom border/shadow only appears
// once the session list has actually scrolled, so an unscrolled list shows no
// abrupt boundary.
const sessionsScrolled = ref(false);
function onSessionsScroll(e: Event): void {
  sessionsScrolled.value = (e.target as HTMLElement).scrollTop > 0;
}

// ---------------------------------------------------------------------------
// Collapse groups
// ---------------------------------------------------------------------------
const collapsedIds = ref<Set<string>>(new Set(loadCollapsedWorkspaces()));

function isCollapsed(id: string): boolean {
  return collapsedIds.value.has(id);
}

function toggleCollapse(id: string): void {
  const next = new Set(collapsedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds.value = next;
  saveCollapsedWorkspaces(next);
}

function collapseAllWorkspaces(): void {
  const next = new Set(props.groups.map((g) => g.workspace.id));
  collapsedIds.value = next;
  saveCollapsedWorkspaces(next);
  closeSectionMenu();
}

function expandAllWorkspaces(): void {
  const next = new Set<string>();
  collapsedIds.value = next;
  saveCollapsedWorkspaces(next);
  closeSectionMenu();
}

// True when every workspace is collapsed — drives the single toggle button's
// icon (expand when fully collapsed, collapse otherwise) and action.
const allCollapsed = computed(
  () =>
    props.groups.length > 0 &&
    props.groups.every((g) => collapsedIds.value.has(g.workspace.id)),
);

// ---------------------------------------------------------------------------
// In-group expand / collapse (show-more pagination)
// ---------------------------------------------------------------------------
// Tracks which workspace groups are "expanded" past their first page. Ephemeral
// (not persisted): a refresh reloads only the first page, so everything starts
// collapsed. Loading more expands automatically; the user can collapse back to
// the first page without losing the already-loaded data.
const expandedIds = ref<Set<string>>(new Set());

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

function toggleExpand(id: string): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

function onLoadMore(id: string): void {
  // Loading more should reveal the new rows immediately.
  if (!expandedIds.value.has(id)) {
    const next = new Set(expandedIds.value);
    next.add(id);
    expandedIds.value = next;
  }
  emit('loadMoreSessions', id);
}

// ---------------------------------------------------------------------------
// Workspace drag-to-reorder
// ---------------------------------------------------------------------------
// The header of each group is the drag handle (see WorkspaceGroup). We track
// which group is being dragged and where the insertion marker sits (before or
// after the group under the pointer), then on drop we emit the new id order
// upward — the parent persists it and the computed `groups` re-sorts. Using the
// pointer's position within the target (top half = before, bottom half = after)
// is what lets a workspace be dropped at the very bottom of the list.
const draggingWsId = ref<string | null>(null);
const dragOver = ref<{ id: string; position: DropPosition } | null>(null);

function onWsDragstart(id: string): void {
  draggingWsId.value = id;
}

function onWsDragend(): void {
  draggingWsId.value = null;
  dragOver.value = null;
}

function dropPosition(event: DragEvent): DropPosition {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function onGroupDragOver(event: DragEvent, targetId: string): void {
  if (draggingWsId.value === null || draggingWsId.value === targetId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dragOver.value = { id: targetId, position: dropPosition(event) };
}

function onGroupDrop(targetId: string): void {
  const fromId = draggingWsId.value;
  const position = dragOver.value?.id === targetId ? dragOver.value.position : 'before';
  dragOver.value = null;
  draggingWsId.value = null;
  if (!fromId || fromId === targetId) return;
  const next = moveInOrder(
    props.groups.map((g) => g.workspace.id),
    fromId,
    targetId,
    position,
  );
  emit('reorderWorkspaces', next);
}

function handleGhClick(wsId: string, e: MouseEvent): void {
  // Ignore clicks that land on the group's action buttons; those
  // have their own handlers and must not also toggle collapse.
  if ((e.target as Element).closest('.gh-more, .gh-explorer, .gh-add')) return;
  toggleCollapse(wsId);
}

function onSelectSession(sessionId: string): void {
  emit('select', sessionId);
}

// ---------------------------------------------------------------------------
// Rename workspace (inline, like SessionRow)
// ---------------------------------------------------------------------------
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

// Hand the rename-input ref OBJECT (not its unwrapped value) down to
// WorkspaceGroup: top-level refs are auto-unwrapped in templates, so a getter
// keeps the ref intact. The child writes its input element back, and Sidebar
// keeps owning focus (startRenameWorkspace focuses it on nextTick).
function getRenameInputRef() {
  return renameInputRef;
}

function startRenameWorkspace(id: string, name: string): void {
  renamingId.value = id;
  renameValue.value = name;
  void nextTick().then(() => renameInputRef.value?.focus());
}

function confirmRenameWorkspace(): void {
  const id = renamingId.value;
  const name = renameValue.value.trim();
  if (id && name) {
    emit('renameWorkspace', id, name);
  }
  renamingId.value = null;
}

function cancelRenameWorkspace(): void {
  renamingId.value = null;
}

function onUpdateRenameValue(value: string): void {
  renameValue.value = value;
}

// The workspaces-tab rename input registers into the same ref the workspace
// header input uses, so focus lands on whichever rename input is rendered.
function registerRenameInput(el: unknown): void {
  renameInputRef.value = el instanceof HTMLInputElement ? el : null;
}

// ---------------------------------------------------------------------------
// Workspace right-click menu (copy path, rename)
// ---------------------------------------------------------------------------
const ghMenuOpen = ref(false);
const ghMenuTarget = ref<WorkspaceView | null>(null);
const ghMenuStyle = ref<Record<string, string>>({});
const ghMenuRef = ref<InstanceType<typeof Menu> | null>(null);

function onGhMenuDocClick(e: MouseEvent): void {
  if (ghMenuRef.value?.el && !ghMenuRef.value.el.contains(e.target as Node)) {
    closeGhMenu();
  }
}

function openGhMenu(ws: WorkspaceView, e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  ghMenuTarget.value = ws;
  ghMenuStyle.value = {
    top: `${e.clientY}px`,
    left: `${e.clientX}px`,
  };
  ghMenuOpen.value = true;
  document.addEventListener('mousedown', onGhMenuDocClick, true);
}

function closeGhMenu(): void {
  ghMenuOpen.value = false;
  document.removeEventListener('mousedown', onGhMenuDocClick, true);
  ghMenuTarget.value = null;
}

function copyPathFromMenu(): void {
  if (ghMenuTarget.value) {
    void copyTextToClipboard(ghMenuTarget.value.root);
  }
  closeGhMenu();
}

function startRenameFromMenu(): void {
  if (ghMenuTarget.value) {
    startRenameWorkspace(ghMenuTarget.value.id, ghMenuTarget.value.name);
  }
  closeGhMenu();
}

function deleteFromMenu(): void {
  const ws = ghMenuTarget.value;
  if (!ws) return;
  closeGhMenu();
  // The modal confirm + async delete live in App.vue (confirmDeleteWorkspace).
  emit('deleteWorkspace', ws.id);
}

// ---------------------------------------------------------------------------
// Workspace inline more-menu (kebab, hover-triggered). Rendered position:fixed
// and anchored to the ⋯ button so the scrolling session list can't clip it.
// It stays open on scroll (so a streaming turn doesn't dismiss it) and closes
// on outside-click or window resize.
// ---------------------------------------------------------------------------
const wsMenuOpenId = ref<string | null>(null);
const wsMenuTarget = ref<WorkspaceView | null>(null);
const wsMenuStyle = ref<Record<string, string>>({});
const wsMenuRef = ref<InstanceType<typeof Menu> | null>(null);

function onWsMenuDocClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('.gh-more') || target.closest('.ws-menu')) return;
  closeWsMenu();
}

async function toggleWsMenu(ws: WorkspaceView, e: MouseEvent): Promise<void> {
  if (wsMenuOpenId.value === ws.id) {
    closeWsMenu();
    return;
  }
  const btn = e.currentTarget as HTMLElement;
  wsMenuTarget.value = ws;
  wsMenuOpenId.value = ws.id;
  document.addEventListener('mousedown', onWsMenuDocClick);
  window.addEventListener('resize', closeWsMenu);
  await nextTick();
  const menu = wsMenuRef.value?.el;
  const r = btn.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const menuH = menu?.offsetHeight ?? 0;
  const menuW = menu?.offsetWidth ?? 0;
  let top = r.bottom + gap;
  if (top + menuH > window.innerHeight - margin) {
    top = Math.max(margin, r.top - menuH - gap);
  }
  let left = r.right - menuW;
  if (left < margin) left = margin;
  wsMenuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

function closeWsMenu(): void {
  wsMenuOpenId.value = null;
  wsMenuTarget.value = null;
  document.removeEventListener('mousedown', onWsMenuDocClick);
  window.removeEventListener('resize', closeWsMenu);
}

function copyWsPath(ws: WorkspaceView): void {
  void copyTextToClipboard(ws.root);
  closeWsMenu();
}

function startRenameWs(ws: WorkspaceView): void {
  startRenameWorkspace(ws.id, ws.name);
  closeWsMenu();
}

function deleteWs(ws: WorkspaceView): void {
  closeWsMenu();
  // The modal confirm + async delete live in App.vue (confirmDeleteWorkspace).
  emit('deleteWorkspace', ws.id);
}

// ---------------------------------------------------------------------------
// Workspace section overflow menu (the ⋯ in the WORKSPACES header). Holds the
// sort mode and the "show paths" toggle as text items with a check mark for the
// active one. Anchored to the trigger via position:fixed so the scrolling list
// can't clip it.
// ---------------------------------------------------------------------------
const sectionMenuOpen = ref(false);
const sectionMenuStyle = ref<Record<string, string>>({});
const sectionMenuRef = ref<InstanceType<typeof Menu> | null>(null);

function onSectionMenuDocClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('.side-section-kebab') || target.closest('.section-menu')) return;
  closeSectionMenu();
}

async function toggleSectionMenu(e: MouseEvent): Promise<void> {
  if (sectionMenuOpen.value) {
    closeSectionMenu();
    return;
  }
  const btn = e.currentTarget as HTMLElement;
  sectionMenuOpen.value = true;
  document.addEventListener('mousedown', onSectionMenuDocClick);
  window.addEventListener('resize', closeSectionMenu);
  await nextTick();
  const menu = sectionMenuRef.value?.el;
  const r = btn.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const menuH = menu?.offsetHeight ?? 0;
  const menuW = menu?.offsetWidth ?? 0;
  let top = r.bottom + gap;
  if (top + menuH > window.innerHeight - margin) {
    top = Math.max(margin, r.top - menuH - gap);
  }
  let left = r.right - menuW;
  if (left < margin) left = margin;
  sectionMenuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

function closeSectionMenu(): void {
  sectionMenuOpen.value = false;
  document.removeEventListener('mousedown', onSectionMenuDocClick);
  window.removeEventListener('resize', closeSectionMenu);
}

function chooseSortMode(mode: WorkspaceSortMode): void {
  emit('setWorkspaceSortMode', mode);
  closeSectionMenu();
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGhMenuDocClick, true);
  document.removeEventListener('mousedown', onWsMenuDocClick);
  document.removeEventListener('mousedown', onSectionMenuDocClick);
  window.removeEventListener('resize', closeWsMenu);
  window.removeEventListener('resize', closeSectionMenu);
});

// ---------------------------------------------------------------------------
// Folder-drop to add a workspace: dragging an OS folder onto the column shows
// the drop overlay and emits the resolved paths upward (App adds them via the
// existing addWorkspace flow). Path resolution needs the desktop shell: a
// browser cannot read an absolute path out of a drop, so the interaction only
// activates inside the desktop app. We extract via the legacy Electron `File.path` — on shells that expose
// neither, the overlay still shows but the drop resolves no paths (no-op).
// ---------------------------------------------------------------------------
const dropDepth = ref(0);
const dropOverlayVisible = ref(false);

function isFolderDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.items ?? []).some(
    (item) => item.kind === 'file' && item.type === '',
  );
}

function droppedFolderPaths(event: DragEvent): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const file of Array.from(event.dataTransfer?.files ?? [])) {
    const path = (file as File & { path?: string }).path;
    if (typeof path === 'string' && path.length > 0 && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

function onColDragenter(event: DragEvent): void {
  if (!isDesktop || !isFolderDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  dropDepth.value += 1;
  dropOverlayVisible.value = true;
}

function onColDragover(event: DragEvent): void {
  if (!isDesktop || !isFolderDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onColDragleave(): void {
  if (!isDesktop) return;
  dropDepth.value = Math.max(0, dropDepth.value - 1);
  if (dropDepth.value === 0) dropOverlayVisible.value = false;
}

function onColDrop(event: DragEvent): void {
  dropDepth.value = 0;
  dropOverlayVisible.value = false;
  if (!isDesktop) return;
  const paths = droppedFolderPaths(event);
  if (paths.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit('addWorkspacePaths', paths);
}

// Temporarily hide the new-workspace button while we evaluate the entry point.
const showNewWorkspaceButton = false;

// Logo long-press easter-egg: holding the Pythinker mark for 1 second opens the
// design system as a full-screen overlay.
// Pointer capture keeps the hold alive even if the pointer drifts off the mark.
const showDesignSystem = ref(false);
function closeDesignSystem(): void {
  showDesignSystem.value = false;
}
const DesignSystemLoadFailed = defineComponent({
  inheritAttrs: false,
  setup: () => () => h(AsyncLoadFailed, { onClose: closeDesignSystem }),
});
const DesignSystemView = defineAsyncComponent({
  loader: () => import('../views/DesignSystemView.vue'),
  // A failed chunk load is not a render error, so the boundary never sees it —
  // it gets its own copy here.
  errorComponent: DesignSystemLoadFailed,
});
const EGG_HOLD_MS = 1000;
let logoPressTimer: ReturnType<typeof setTimeout> | undefined;

const updateTriggerElement = ref<HTMLElement | null>(null);
const updateNotesElement = ref<HTMLElement | null>(null);
const updateNotesBodyElement = ref<HTMLElement | null>(null);
// A fade over the last rows says "there is more below". It has to be true to be
// useful, so it tracks the scroller instead of being painted unconditionally:
// short notes get no fade, and the fade clears once the reader reaches the end.
const updateNotesScrollable = ref(false);
const updateNotesOpen = ref(false);
const updateNotesStyle = ref<Record<string, string>>({});
let updateNotesCloseTimer: ReturnType<typeof setTimeout> | undefined;

const updateReleaseDate = computed(() => {
  const raw = update.state.value?.releaseDate;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
});

function syncUpdateNotesScroll(): void {
  const body = updateNotesBodyElement.value;
  if (!body) {
    updateNotesScrollable.value = false;
    return;
  }
  updateNotesScrollable.value = body.scrollHeight - body.scrollTop - body.clientHeight > 1;
}

function positionUpdateNotes(): void {
  const trigger = updateTriggerElement.value;
  const panel = updateNotesElement.value;
  if (!trigger || !panel) return;
  const triggerRect = trigger.getBoundingClientRect();
  const margin = 16;
  const gap = 8;
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const left = Math.min(
    Math.max(triggerRect.left, margin),
    Math.max(margin, window.innerWidth - margin - width),
  );
  const below = triggerRect.bottom + gap;
  const top = below + height <= window.innerHeight - margin
    ? below
    : Math.max(margin, triggerRect.top - height - gap);
  syncUpdateNotesScroll();
  updateNotesStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
}

function keepUpdateNotesOpen(): void {
  clearTimeout(updateNotesCloseTimer);
}

function showUpdateNotes(event: Event): void {
  if (event.currentTarget instanceof HTMLElement) updateTriggerElement.value = event.currentTarget;
  keepUpdateNotesOpen();
  updateNotesOpen.value = true;
  void nextTick(positionUpdateNotes);
}

function scheduleUpdateNotesClose(): void {
  clearTimeout(updateNotesCloseTimer);
  updateNotesCloseTimer = setTimeout(() => {
    updateNotesOpen.value = false;
  }, 120);
}

function scheduleUpdateNotesPointerClose(): void {
  const active = document.activeElement;
  if (
    active instanceof Node &&
    (updateTriggerElement.value?.contains(active) || updateNotesElement.value?.contains(active))
  ) return;
  scheduleUpdateNotesClose();
}

function onUpdateNotesFocusout(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && updateNotesElement.value?.contains(next)) return;
  scheduleUpdateNotesClose();
}

function focusUpdateNotes(event: KeyboardEvent): void {
  if (event.shiftKey) return;
  const target = updateNotesElement.value?.querySelector<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!target) return;
  event.preventDefault();
  keepUpdateNotesOpen();
  target.focus();
}

const updateStage = computed(() => update.status.value);
const updatePercentLabel = computed(() => {
  const value = update.percent.value;
  return value === undefined ? '' : `${Math.round(value)}%`;
});
const updateTriggerText = computed(() => {
  switch (updateStage.value) {
    case 'downloading': return updatePercentLabel.value || t('update.sidebarFetching');
    case 'downloaded': return t('update.sidebarRestart');
    case 'error': return t('update.sidebarRetry');
    default: return t('update.sidebarAction');
  }
});
const updateTriggerLabel = computed(() => {
  const version = update.availableVersion.value;
  switch (updateStage.value) {
    case 'downloading': return t('update.dialogDownloading', { version: version ?? '' });
    case 'downloaded': return t('update.restartAction');
    case 'error': return t('update.retryDownload');
    default: return version ? t('update.sidebarHint', { version }) : t('update.sidebarAction');
  }
});

function onUpdateTriggerClick(): void {
  updateNotesOpen.value = false;
  const version = update.availableVersion.value;
  if (version !== undefined) void update.markNotified(version);
  switch (updateStage.value) {
    case 'downloading': return;
    case 'downloaded': void update.restart(); return;
    case 'error': void update.retry(); return;
    default: void update.download();
  }
}

function onLogoPointerDown(event: PointerEvent): void {
  clearTimeout(logoPressTimer);
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  logoPressTimer = setTimeout(() => {
    showDesignSystem.value = true;
  }, EGG_HOLD_MS);
}

function onLogoPointerUp(event: PointerEvent): void {
  clearTimeout(logoPressTimer);
  const el = event.currentTarget as HTMLElement;
  if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
}

onBeforeUnmount(() => {
  clearTimeout(logoPressTimer);
  clearTimeout(updateNotesCloseTimer);
  window.removeEventListener('resize', positionUpdateNotes);
});

onMounted(() => window.addEventListener('resize', positionUpdateNotes));

watch([() => props.collapsed, update.hasUpdate], ([collapsed, hasUpdate]) => {
  if (collapsed || !hasUpdate) updateNotesOpen.value = false;
});
</script>

<template>
  <aside
    class="side"
    :class="{ 'macos-desktop': isMacosDesktop, collapsed, 'no-anim': dragging }"
    :style="{ width: collapsed ? '0px' : colWidth + 'px' }"
  >
    <!-- Session column -->
    <div
      class="col"
      :style="{ width: colWidth + 'px' }"
      @dragenter="onColDragenter"
      @dragover="onColDragover"
      @dragleave="onColDragleave"
      @drop="onColDrop"
    >
      <!-- Header: brand + collapse. On every platform the brand sits left
           and the collapse button is right-aligned in the row; on macOS
           desktop the row is also the window-drag strip — it pads left to
           clear the floating traffic lights, and the button opts out of the
           drag region so it stays clickable. -->
      <div class="ch">
        <div class="ch-brand">
          <img
            class="ch-logo"
            src="/brand/pythinker_banner_dark.svg"
            alt="Pythinker Code"
            draggable="false"
            @pointerdown="onLogoPointerDown"
            @pointerup="onLogoPointerUp"
            @pointercancel="onLogoPointerUp"
          />
        </div>
        <div class="ch-actions">
          <Pill
            v-if="update.hasUpdate.value"
            class="sidebar-update-trigger"
            :class="`is-${updateStage}`"
            data-testid="sidebar-update"
            :aria-label="updateTriggerLabel"
            :aria-busy="updateStage === 'downloading' ? 'true' : undefined"
            :disabled="update.busy.value"
            :aria-controls="updateNotesOpen ? 'sidebar-update-notes' : undefined"
            :aria-expanded="updateNotesOpen"
            aria-haspopup="dialog"
            @mouseenter="showUpdateNotes"
            @mouseleave="scheduleUpdateNotesPointerClose"
            @focus="showUpdateNotes"
            @blur="scheduleUpdateNotesClose"
            @keydown.tab="focusUpdateNotes"
            @click.stop="onUpdateTriggerClick"
          >
            <span class="sidebar-update-trigger__icon" aria-hidden="true">
              <Icon name="update-button" />
            </span>
            <span class="sidebar-update-trigger__text" data-testid="sidebar-update-text">
              {{ updateTriggerText }}
            </span>
          </Pill>
          <IconButton
            class="ch-collapse"
            size="sm"
            :label="t('sidebar.collapseSidebar')"
            @click.stop="emit('collapse')"
          >
            <Icon name="panel-collapse" />
          </IconButton>
        </div>
      </div>

      <!-- New chat + new workspace buttons -->
      <div class="btn-wrap">
        <button class="btn-new-chat" type="button" @click.stop="emit('create')">
          <Icon name="chat-new" />
          <span>{{ t('sidebar.newChat') }}</span>
        </button>
        <IconButton
          v-if="showNewWorkspaceButton"
          size="sm"
          :label="t('sidebar.newWorkspace')"
          @click.stop="emit('addWorkspace')"
        >
          <Icon name="folder" />
        </IconButton>
      </div>

      <!-- Session search — opens the Spotlight-style search dialog. Last fixed
           row above the list, so it carries the scroll-linked seam. -->
      <div class="search-wrap" :class="{ 'search-wrap--scrolled': sessionsScrolled }">
        <button class="search" type="button" @click="openSearch">
          <Icon class="search-icon" name="search" />
          <span class="search-input">{{ t('sidebar.search') }}</span>
          <Kbd :keys="sessionSearchKeys" />
        </button>
      </div>

      <WorkspaceExplorer
        v-show="explorerOpen"
        :active="explorerOpen"
        :workspace="explorerWorkspace"
        :session-id="explorerSessionId"
        @close="explorerOpen = false"
        @open-file="emit('openFile', $event)"
      />

      <div v-if="!explorerOpen && tabsEnabled" class="status-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="statusView === 'open'"
          :class="{ active: statusView === 'open' }"
          @click="showStatus('open')"
        >
          {{ t('sidebar.tabOpen') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="statusView === 'done'"
          :class="{ active: statusView === 'done' }"
          @click="showStatus('done')"
        >
          {{ t('sidebar.tabDone') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="statusView === 'workspaces'"
          :class="{ active: statusView === 'workspaces' }"
          @click="showStatus('workspaces')"
        >
          {{ t('sidebar.tabWorkspaces') }}
        </button>
        <IconButton
          class="status-view-switcher side-section-kebab"
          size="sm"
          :label="t('sidebar.viewSwitcher')"
          aria-haspopup="menu"
          :aria-expanded="sectionMenuOpen"
          @click.stop="toggleSectionMenu($event)"
        >
          <Icon name="sliders" />
        </IconButton>
      </div>

      <PinnedSessionList
        v-if="!explorerOpen && statusView === 'open'"
        :sessions="pinnedSessions"
        :active-id="activeId"
        :collapsed="pinnedCollapsed"
        :pending-by-session="pendingBySession"
        :unread-by-session="unreadBySession"
        @select="onSelectSession"
        @rename="(id, title) => emit('rename', id, title)"
        @generate-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
        @archive="emit('archive', $event)"
        @fork="emit('fork', $event)"
        @export="emit('export', $event)"
        @pin="emit('pin', $event)"
        @set-emoji="(id, emoji) => emit('setSessionEmoji', id, emoji)"
        @reorder="emit('reorderPins', $event)"
        @toggle-collapsed="emit('togglePinnedCollapsed')"
      />

      <!-- Session list — grouped by workspace -->
      <div v-if="!explorerOpen" class="sessions" @scroll="onSessionsScroll">

        <!-- Done tab — done sessions grouped by workspace with count headers.
             The group header collapses like an open-tab workspace group and
             carries the same context actions (kebab → rename/copy/remove). -->
        <div v-if="statusView === 'done'">
          <div v-for="dg in doneGroups" :key="dg.workspace.id" class="done-group">
            <div
              class="done-gh"
              @click="toggleCollapse(dg.workspace.id)"
              @contextmenu="openGhMenu(dg.workspace, $event)"
            >
              <Icon
                class="done-gh-folder"
                :name="isCollapsed(dg.workspace.id) ? 'folder-closed' : 'folder'"
              />
              <span class="done-gh-name">{{ dg.workspace.name }}</span>
              <span class="done-gh-count">{{ dg.sessions.length }}</span>
              <IconButton
                class="done-gh-more gh-more"
                :class="{ open: wsMenuOpenId === dg.workspace.id }"
                size="sm"
                :label="t('sidebar.options')"
                @click.stop="toggleWsMenu(dg.workspace, $event)"
              >
                <Icon name="dots-horizontal" />
              </IconButton>
            </div>
            <div v-if="!isCollapsed(dg.workspace.id)" class="done-gh-sessions">
              <SessionRow
                v-for="session in dg.sessions"
                :key="session.id"
                :session="session"
                :active="false"
                :done="true"
                :pinned="pinnedIds.includes(session.id)"
                @select="onSelectSession"
                @rename="(id, title) => emit('rename', id, title)"
                @generate-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
                @restore="emit('restore', $event)"
                @fork="emit('fork', $event)"
                @export="emit('export', $event)"
                @pin="emit('pin', $event)"
                @set-emoji="(id, emoji) => emit('setSessionEmoji', id, emoji)"
              />
            </div>
          </div>
          <div v-if="archivedSessions.length === 0" class="empty">
            {{ t('sidebar.noDoneSessions') }}
          </div>
        </div>

        <!-- Workspaces tab — directory-style rows of all registered
             workspaces; click opens a new session in the workspace, the kebab
             holds the standard workspace actions (copy path / rename /
             remove), and the header holds the new-workspace entry. -->
        <div v-else-if="statusView === 'workspaces'">
          <div class="side-section-label">
            <span class="side-section-title">{{ t('sidebar.tabWorkspaces') }}</span>
            <div class="side-section-actions">
              <IconButton
                class="side-section-toggle"
                size="sm"
                :label="t('sidebar.newWorkspace')"
                @click.stop="emit('addWorkspace')"
              >
                <Icon name="folder-plus" />
              </IconButton>
            </div>
          </div>
          <div
            v-for="g in groups"
            :key="g.workspace.id"
            class="ws-dir"
            :class="{ on: g.workspace.id === activeWorkspaceId }"
            @click="emit('createInWorkspace', g.workspace.id)"
            @contextmenu="openGhMenu(g.workspace, $event)"
          >
            <div class="ws-dir-row">
              <Icon class="ws-dir-icon" name="folder-closed" />
              <input
                v-if="renamingId === g.workspace.id"
                :ref="registerRenameInput"
                v-model="renameValue"
                class="ws-dir-rename"
                type="text"
                @keydown.enter.stop="confirmRenameWorkspace"
                @keydown.esc.stop="cancelRenameWorkspace"
                @blur="confirmRenameWorkspace"
                @click.stop
              />
              <span v-else class="ws-dir-name" @dblclick.stop="startRenameWorkspace(g.workspace.id, g.workspace.name)">
                {{ g.workspace.name }}
              </span>
              <IconButton
                v-if="renamingId !== g.workspace.id"
                class="gh-more ws-dir-act"
                :class="{ open: wsMenuOpenId === g.workspace.id }"
                size="sm"
                :label="t('sidebar.options')"
                @click.stop="toggleWsMenu(g.workspace, $event)"
              >
                <Icon name="dots-horizontal" />
              </IconButton>
            </div>
            <div class="ws-dir-sub">{{ g.workspace.root }}</div>
          </div>
          <div v-if="groups.length === 0" class="empty">
            {{ t('workspace.noWorkspace') }}
          </div>
        </div>

        <template v-else-if="listView === 'flat'">
          <SessionRow
            v-for="session in unpinnedSessions"
            :key="session.id"
            :session="session"
            :active="session.id === activeId"
            :pinned="pinnedIds.includes(session.id)"
            :approval-count="pendingBySession[session.id]?.approvals ?? 0"
            :question-count="pendingBySession[session.id]?.questions ?? 0"
            :unread="unreadBySession[session.id] ?? false"
            @select="onSelectSession"
            @rename="(id, title) => emit('rename', id, title)"
            @generate-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
            @archive="emit('archive', $event)"
            @fork="emit('fork', $event)"
            @export="emit('export', $event)"
            @pin="emit('pin', $event)"
            @set-emoji="(id, emoji) => emit('setSessionEmoji', id, emoji)"
          />
          <div v-if="sessions.length === 0" class="empty">{{ t('sidebar.noOpenSessions') }}</div>
        </template>

        <template v-else>
        <div v-if="sessions.length === 0 && groups.length > 0" class="empty">
          {{ t('sidebar.noOpenSessions') }}
        </div>
        <!-- Empty state — only when no workspace is registered at all; empty
             workspaces still render their group header (with the + button). -->
        <div v-if="groups.length === 0" class="empty">
          {{ t('workspace.noWorkspace') }}
        </div>

        <template v-else>
          <div class="side-section-label">
            <span class="side-section-title">{{ t('sidebar.workspaces') }}</span>
            <div class="side-section-actions">
              <IconButton
                class="side-section-toggle"
                size="sm"
                :label="allCollapsed ? t('sidebar.expandAll') : t('sidebar.collapseAll')"
                @click.stop="allCollapsed ? expandAllWorkspaces() : collapseAllWorkspaces()"
              >
                <Icon v-if="allCollapsed" name="expand" />
                <Icon v-else name="collapse" />
              </IconButton>
              <IconButton
                class="side-section-toggle side-section-kebab"
                size="sm"
                :label="t('sidebar.options')"
                aria-haspopup="menu"
                :aria-expanded="sectionMenuOpen"
                @click.stop="toggleSectionMenu($event)"
              >
                <Icon name="dots-horizontal" />
              </IconButton>
            </div>
          </div>
          <div
            v-for="g in unpinnedGroups"
            :key="g.workspace.id"
            class="ws-drop-target"
            :class="{
              'drop-before': dragOver?.id === g.workspace.id && dragOver.position === 'before',
              'drop-after': dragOver?.id === g.workspace.id && dragOver.position === 'after',
            }"
            @dragover="onGroupDragOver($event, g.workspace.id)"
            @drop="onGroupDrop(g.workspace.id)"
          >
            <WorkspaceGroup
              :group="g"
              :active-workspace-id="activeWorkspaceId"
              :active-id="activeId"
              :renaming-id="renamingId"
              :rename-value="renameValue"
              :rename-input-ref="getRenameInputRef()"
              :pending-by-session="pendingBySession"
              :unread-by-session="unreadBySession"
              :pinned-ids="pinnedIds"
              :ws-menu-open-id="wsMenuOpenId"
              :explorer-active="explorerOpen && explorerWorkspaceId === g.workspace.id"
              :dragging="draggingWsId === g.workspace.id"
              :is-collapsed="isCollapsed"
              :is-expanded="isExpanded"
              @group-click="handleGhClick"
              @group-contextmenu="openGhMenu"
              @toggle-ws-menu="toggleWsMenu"
              @toggle-explorer="toggleExplorer"
              @create-in-workspace="(id) => emit('createInWorkspace', id)"
              @select-session="onSelectSession"
              @rename-session="(id, title) => emit('rename', id, title)"
              @generate-session-title="(id, onTitle) => emit('generateTitle', id, onTitle)"
              @archive-session="(id) => emit('archive', id)"
              @fork-session="(id) => emit('fork', id)"
              @export-session="(id) => emit('export', id)"
              @pin-session="(id) => emit('pin', id)"
              @set-session-emoji="(id, emoji) => emit('setSessionEmoji', id, emoji)"
              @load-more="onLoadMore"
              @toggle-expand="toggleExpand"
              @confirm-rename="confirmRenameWorkspace"
              @cancel-rename="cancelRenameWorkspace"
              @update-rename-value="onUpdateRenameValue"
              @ws-dragstart="onWsDragstart"
              @ws-dragend="onWsDragend"
            />
          </div>
        </template>
        </template>
      </div>

      <!-- Footer: settings entry pinned under the session list. The row is the
           growing side that truncates; a fixed side would sit beside it. -->
      <div class="side-footer">
        <div class="side-footer-account">
          <button class="btn-settings" type="button" @click.stop="emit('openSettings')">
            <Icon name="settings" />
            <span class="btn-settings-label">{{ t('settings.title') }}</span>
          </button>
        </div>
      </div>

      <!-- Folder-drop overlay (desktop): covers the column while a folder drag
           hovers it; the resolved paths flow up via @add-workspace-paths. -->
      <div class="folder-drop-overlay" :class="{ show: dropOverlayVisible }" aria-hidden="true">
        <div class="folder-drop-card">
          <Icon name="folder" size="lg" />
          <span>{{ t('sidebar.dropToAddWorkspace') }}</span>
        </div>
      </div>
    </div>

    <!-- Workspace right-click menu (position:fixed) -->
    <Menu
      v-if="ghMenuOpen"
      ref="ghMenuRef"
      class="gh-menu"
      :style="ghMenuStyle"
      @click.stop
    >
      <MenuItem @click="copyPathFromMenu">{{ t('sidebar.copyPath') }}</MenuItem>
      <MenuItem @click="startRenameFromMenu">{{ t('sidebar.rename') }}</MenuItem>
      <MenuItem danger @click="deleteFromMenu">{{ t('sidebar.removeWorkspace') }}</MenuItem>
    </Menu>

    <!-- Workspace kebab menu (position:fixed, anchored to the ⋯ button so the
         scrolling session list cannot clip it) -->
    <Menu
      v-if="wsMenuOpenId !== null && wsMenuTarget"
      ref="wsMenuRef"
      class="ws-menu"
      :style="wsMenuStyle"
      @click.stop
    >
      <MenuItem @click="copyWsPath(wsMenuTarget)">{{ t('sidebar.copyPath') }}</MenuItem>
      <MenuItem separator />
      <MenuItem @click="startRenameWs(wsMenuTarget)">{{ t('sidebar.rename') }}</MenuItem>
      <MenuItem separator />
      <MenuItem danger @click="deleteWs(wsMenuTarget)">{{ t('sidebar.removeWorkspace') }}</MenuItem>
    </Menu>
    <!-- Workspace sort menu (position:fixed, anchored to the sort button) -->
    <Menu
      v-if="sectionMenuOpen"
      ref="sectionMenuRef"
      class="section-menu"
      :style="sectionMenuStyle"
      @click.stop
    >
      <MenuItem @click="openSessionAdmin">{{ t('admin.manageSessions') }}</MenuItem>
      <MenuItem separator />
      <div class="section-menu-label">{{ t('sidebar.viewGroup') }}</div>
      <MenuItem @click="chooseListView('flat')">
        <span class="section-menu-check">
          <Icon v-if="listView === 'flat'" name="check" size="sm" />
        </span>
        {{ t('sidebar.viewFlat') }}
      </MenuItem>
      <MenuItem @click="chooseListView('grouped')">
        <span class="section-menu-check">
          <Icon v-if="listView === 'grouped'" name="check" size="sm" />
        </span>
        {{ t('sidebar.viewGrouped') }}
      </MenuItem>
      <MenuItem separator />
      <div class="section-menu-label">{{ t('sidebar.sortGroup') }}</div>
      <MenuItem @click="chooseSortMode('manual')">
        <span class="section-menu-check">
          <Icon v-if="workspaceSortMode === 'manual'" name="check" size="sm" />
        </span>
        {{ t('sidebar.sortManual') }}
      </MenuItem>
      <MenuItem @click="chooseSortMode('recent')">
        <span class="section-menu-check">
          <Icon v-if="workspaceSortMode === 'recent'" name="check" size="sm" />
        </span>
        {{ t('sidebar.sortRecent') }}
      </MenuItem>
      <MenuItem separator />
      <MenuItem @click="allCollapsed ? expandAllWorkspaces() : collapseAllWorkspaces()">
        <Icon :name="allCollapsed ? 'expand' : 'collapse'" size="sm" />
        {{ t(allCollapsed ? 'sidebar.expandAll' : 'sidebar.collapseAll') }}
      </MenuItem>
    </Menu>
    <!-- Session search dialog (Cmd/Ctrl+K) -->
    <SearchSessionsDialog
      v-if="showSearch"
      :sessions="sessions"
      :workspaces="workspaces"
      :active-id="activeId"
      @select="onSelectSession"
      @select-workspace="emit('selectWorkspace', $event)"
      @close="showSearch = false"
    />
    <!-- Keep inside <aside>: a top-level <Teleport> makes Sidebar multi-root,
         which breaks v-show on the host (Vue can't apply display:none to a
         Fragment). Teleport still renders to body regardless of placement. -->
    <Teleport to="body">
      <ErrorBoundary
        v-if="showDesignSystem"
        fullscreen
        closable
        @close="showDesignSystem = false"
      >
        <DesignSystemView @close="showDesignSystem = false" />
      </ErrorBoundary>
      <section
        v-if="updateNotesOpen"
        id="sidebar-update-notes"
        ref="updateNotesElement"
        class="sidebar-update-notes"
        :class="{ 'is-scrollable': updateNotesScrollable }"
        data-testid="sidebar-update-notes"
        :style="updateNotesStyle"
        role="dialog"
        aria-labelledby="sidebar-update-notes-title"
        @mouseenter="keepUpdateNotesOpen"
        @mouseleave="scheduleUpdateNotesPointerClose"
        @focusin="keepUpdateNotesOpen"
        @focusout="onUpdateNotesFocusout"
      >
        <div class="sidebar-update-notes__header">
          <strong id="sidebar-update-notes-title" data-testid="sidebar-update-notes-title">
            {{ t('update.releaseNotesTitle', { version: update.availableVersion.value ?? '' }) }}
          </strong>
          <span v-if="updateReleaseDate">{{ updateReleaseDate }}</span>
        </div>
        <div class="sidebar-update-notes__divider" />
        <!-- The notes scroll when they outgrow the panel, so the region has to
             be reachable by keyboard on its own: without a tab stop there is no
             way to scroll it without a pointer. -->
        <div
          ref="updateNotesBodyElement"
          class="sidebar-update-notes__body"
          data-testid="sidebar-update-notes-body"
          tabindex="0"
          role="group"
          :aria-label="t('update.releaseNotesRegion')"
          @scroll="syncUpdateNotesScroll"
        >
          <ReleaseNotes :text="update.state.value?.releaseNotes ?? ''" />
        </div>
      </section>
    </Teleport>
  </aside>
</template>

<style scoped>
.side {
  position: relative;
  /* Sidebar frost surface — extends the sanctioned TopBar `.frost` recipe by
     explicit product decision (same pattern as the Onboarding hero): translucent
     glass base + gradient wash + backdrop blur, so the session column reads as
     a vibrancy material. The blur lives on an isolated ::before layer, NOT on
     .side itself: a backdrop-filtered element becomes the containing block for
     position:fixed descendants, which would reparent and clip the kebab /
     workspace / section menus below. --color-sidebar-bg stays the solid
     composite for row masks / overlays. */
  isolation: isolate;
  display: flex;
  flex-direction: row;
  /* Anchor content to the right edge: while the container width animates to 0
     the fixed-width column slides out to the left and is clipped, instead of
     reflowing. Mirrors the right-side preview panel (App.vue .global-preview). */
  justify-content: flex-end;
  overflow: hidden;
  min-width: 0;
  height: 100%;
  transition:
    width 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    visibility 0.28s;
  /* Alignment contract, inherited by SessionRow and WorkspaceGroup:
     - row boxes (hover/selected pills) sit --sb-inset from the sidebar edges;
     - text/icons start at --sb-pad-x = --sb-inset + 8px row padding;
     - row titles start at --sb-pad-x + --sb-gutter + --sb-gap. */
  --sb-inset: var(--space-2);  /* row box inset from the sidebar edge */
  --sb-pad-x: var(--space-4);  /* content start x (inset + row padding) */
  --sb-gutter: 16px;           /* leading icon slot (matches the 16px folder icon, so the session title aligns under the workspace name) */
  --sb-gap: var(--space-2);    /* gap between the icon slot and the text */
  /* Row hover wash — global --color-hover (lighter than the selected fill;
     both translucent, so they sit on any surface). */
  --sb-hover: var(--color-hover);
}
/* Frost layer: paints above .side's own (transparent) background but below all
   content via negative z-index; .side's isolation keeps it from sinking behind
   ancestor surfaces. */
.side::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-color: var(--color-sidebar-glass);
  background-image: var(--color-sidebar-wash);
  -webkit-backdrop-filter: var(--p-sidebar-backdrop);
  backdrop-filter: var(--p-sidebar-backdrop);
}
/* While dragging the resize handle, follow the pointer 1:1 (same pattern as
   .global-preview.no-anim in App.vue). */
.side.no-anim {
  transition: none;
}
/* Fully collapsed: width 0 (animated), then drop out of hit-testing / tab
   order once the transition ends (visibility interpolates to hidden at the
   end when collapsing, and back to visible immediately when expanding). */
.side.collapsed {
  visibility: hidden;
}

/* Session column. Width is set inline from the App resize handle; it stays
   fixed while the collapsing container clips it. Carries the sidebar's right
   hairline so the border is clipped away together with the content. */
.col {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  border-right: 1px solid var(--line);
  container-type: inline-size;
  container-name: sidebar-col;
  /* Anchors the absolute folder-drop overlay to the column, not the viewport. */
  position: relative;
}

/* Header: brand strip (no border — flows into the workspace list). The brand
   sits on the left and the collapse button on the right on every platform;
   macOS also uses the header as a window-drag strip. */
.ch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: var(--space-3);
  min-height: calc(26px + 2 * var(--space-3));
  width: 100%;
  box-sizing: border-box;
}
/* macOS desktop: the window uses a hidden title bar, so the traffic lights
   float over the top-left of the sidebar. The brand row sits BELOW them (its
   own line, like the design-system spec): padding-top clears the lights,
   left padding returns to the normal sidebar gutter, and the whole strip —
   lights zone included — stays a window-drag area while the collapse button
   opts out so it remains clickable. */
.side.macos-desktop .ch {
  padding-top: 36px;
  -webkit-app-region: drag;
}
.side.macos-desktop .ch-collapse {
  -webkit-app-region: no-drag;
}
.side.macos-desktop .ch-actions {
  -webkit-app-region: no-drag;
}
.ch-logo {
  width: min(220px, 100%);
  height: auto;
  object-fit: contain;
  object-position: left center;
  flex: none;
  display: block;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: transform 0.18s ease;
}
.ch-logo:hover {
  transform: scale(1.08);
}
.ch-brand {
  display: flex;
  align-items: center;
  min-width: 0;
  /* Take the row's slack so the action buttons group together on the right. */
  flex: 1;
  user-select: none;
  touch-action: none;
}

.ch-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

.sidebar-update-trigger {
  --sidebar-update-size: 32px;
  position: relative;
  display: inline-grid;
  grid-template-areas: 'slot';
  place-items: center;
  width: var(--sidebar-update-size);
  height: var(--sidebar-update-size);
  padding: 0;
  border-radius: var(--radius-full);
  color: var(--color-text);
  font-size: var(--text-xs);
  overflow: hidden;
  transition: width var(--duration-base) var(--ease-out),
    background var(--duration-base) var(--ease-out),
    color var(--duration-base) var(--ease-out);
}
.sidebar-update-trigger__icon,
.sidebar-update-trigger__text {
  grid-area: slot;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--duration-base) var(--ease-out);
}
.sidebar-update-trigger__icon :deep(svg) {
  width: var(--sidebar-update-size);
  height: var(--sidebar-update-size);
}
.sidebar-update-trigger__text {
  padding: 0 var(--space-3);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
}
.ch-actions .sidebar-update-trigger:hover:not(:disabled),
.ch-actions .sidebar-update-trigger:focus-visible,
.ch-actions .sidebar-update-trigger.is-downloading,
.ch-actions .sidebar-update-trigger.is-downloaded,
.ch-actions .sidebar-update-trigger.is-error {
  width: auto;
  min-width: 56px;
  background: var(--color-accent);
  color: var(--color-text-on-accent);
}
.ch-actions .sidebar-update-trigger:hover:not(:disabled) .sidebar-update-trigger__icon,
.ch-actions .sidebar-update-trigger:focus-visible .sidebar-update-trigger__icon,
.ch-actions .sidebar-update-trigger.is-downloading .sidebar-update-trigger__icon,
.ch-actions .sidebar-update-trigger.is-downloaded .sidebar-update-trigger__icon,
.ch-actions .sidebar-update-trigger.is-error .sidebar-update-trigger__icon {
  opacity: 0;
}
.ch-actions .sidebar-update-trigger:hover:not(:disabled) .sidebar-update-trigger__text,
.ch-actions .sidebar-update-trigger:focus-visible .sidebar-update-trigger__text,
.ch-actions .sidebar-update-trigger.is-downloading .sidebar-update-trigger__text,
.ch-actions .sidebar-update-trigger.is-downloaded .sidebar-update-trigger__text,
.ch-actions .sidebar-update-trigger.is-error .sidebar-update-trigger__text {
  opacity: 1;
}
.sidebar-update-trigger.is-downloading {
  cursor: progress;
}
.ch-actions .sidebar-update-trigger.is-error {
  background: var(--color-danger);
}
.ch-actions .sidebar-update-trigger:disabled {
  cursor: progress;
}
.ch-actions .sidebar-update-trigger:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring-strong);
}

.sidebar-update-notes {
  position: fixed;
  z-index: var(--z-tooltip);
  box-sizing: border-box;
  width: min(440px, calc(100vw - 32px));
  max-height: min(640px, calc(100vh - 32px));
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-xl);
  background: var(--color-surface-raised);
  color: var(--color-text);
  box-shadow: var(--shadow-menu);
  font-family: var(--font-ui);
}
.sidebar-update-notes__header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-6) var(--space-6) var(--space-5);
}
.sidebar-update-notes__header strong {
  color: var(--color-text-strong);
  font-size: var(--text-lg);
}
.sidebar-update-notes__header span {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.sidebar-update-notes__divider {
  height: 1px;
  margin-inline: var(--space-6);
  background: var(--color-line);
}
/* Long notes scroll inside the body. A cut-off line reads as the end of the
   list unless something says otherwise, so the shell paints a fade over the
   last rows. It is pointer-events: none so it never eats a click or a scroll,
   and it sits on the shell rather than the scroller so it does not travel
   with the content. */
.sidebar-update-notes.is-scrollable::after {
  content: '';
  position: absolute;
  inset-inline: 1px;
  inset-block-end: 1px;
  height: var(--space-6);
  border-end-start-radius: var(--radius-xl);
  border-end-end-radius: var(--radius-xl);
  background: linear-gradient(to bottom, transparent, var(--color-surface-raised));
  pointer-events: none;
}
.sidebar-update-notes__body {
  /* min-width: 0 keeps a long unbreakable token (a commit URL) from setting
     the min-content width — the shell is overflow: hidden, so it would clip
     rather than scroll. overflow-x: clip catches anything that still escapes,
     so the popover can never scroll sideways. */
  min-width: 0;
  max-height: min(500px, calc(100vh - 150px));
  overflow-x: clip;
  overflow-y: auto;
  padding: var(--space-5) var(--space-6) var(--space-6);
  overscroll-behavior: contain;
}
.sidebar-update-notes__body:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
  border-radius: var(--radius-md);
}

.btn-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 var(--sb-inset);
}
.btn-new-chat {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 8px calc(var(--sb-pad-x) - var(--sb-inset));
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  line-height: var(--leading-tight);
  cursor: pointer;
  text-align: left;
}
.btn-new-chat:hover { background: var(--sb-hover); }
.btn-new-chat:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.btn-new-chat svg { flex: none; }
.btn-new-chat span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--sb-inset) var(--space-2);
}
.status-tabs > button:not(.status-view-switcher) {
  min-height: 28px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.status-tabs > button.active {
  background: var(--color-selected);
  color: var(--color-text);
}
.status-view-switcher { margin-left: auto; }

/* Session search — the wrapper is the last fixed row above the list and
   carries the scroll-linked seam: its bottom border/shadow only appear once
   the session list has actually scrolled, so an unscrolled list shows no
   abrupt boundary. */
.search-wrap {
  padding: 0 var(--sb-inset);
  position: relative;
  z-index: 1;
  background: var(--color-sidebar-glass);
  -webkit-backdrop-filter: var(--p-sidebar-backdrop);
  backdrop-filter: var(--p-sidebar-backdrop);
  border-bottom: 1px solid transparent;
  transition: border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out);
}
.search-wrap--scrolled {
  border-bottom-color: var(--line);
  box-shadow: var(--shadow-sm);
}
.search {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 0;
  padding: 8px calc(var(--sb-pad-x) - var(--sb-inset));
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.search:hover { background: var(--sb-hover); }
.search:focus-visible {
  background: var(--sb-hover);
  color: var(--color-text);
  outline: 2px solid var(--color-accent-bd);
  outline-offset: -2px;
}
.search-icon {
  flex: none;
}
.search-input {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  line-height: var(--leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Sessions — owns the vertical padding around the list (the 12px gap to the
   search row above and the bottom breathing room). Scrolled content passes
   through the top padding and clips at the .search-wrap seam. Scrollbar: the
   4px ::-webkit-scrollbar below; standard scrollbar-width would kill it on
   Chromium (see the global scrollbar block in style.css). */
.sessions {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--sb-inset);
  min-height: 0;
}
.sessions::-webkit-scrollbar { width: 4px; }
.sessions::-webkit-scrollbar-track { background: transparent; }
.sessions::-webkit-scrollbar-thumb {
  /* Neutral, text-derived translucency — adapts to both schemes and sits
     quietly on the sidebar surface (no accent tint on hover). */
  background: color-mix(in srgb, var(--color-text) 12%, transparent);
  border-radius: var(--radius-full);
}
.sessions::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--color-text) 25%, transparent); }

/* Footer — settings entry pinned under the session list. Same list-style
   control family as search / New chat (full-width, left-aligned, hover
   sunken — not a Button). */
.side-footer {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--sb-inset);
  border-top: 1px solid var(--line);
}
/* A long label truncates instead of pushing the row. */
.side-footer-account {
  flex: 1 1 auto;
  min-width: 0;
}
.btn-settings-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.btn-settings {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 8px calc(var(--sb-pad-x) - var(--sb-inset));
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  line-height: var(--leading-tight);
  cursor: pointer;
  text-align: left;
}
.btn-settings:hover { background: var(--sb-hover); }
.btn-settings:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
.btn-settings svg { flex: none; }
.btn-settings span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Section label — heads the workspace list below the action buttons. Aligns
   with the rows' leading inset (--sb-pad-x) so it reads as the list's title. */
.side-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 var(--space-3) var(--space-1) var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-regular);
  text-transform: uppercase;
  color: var(--faint);
  user-select: none;
}
.side-section-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side-section-toggle {
  color: var(--faint);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
}
.side-section-label:hover .side-section-toggle,
.side-section-label:focus-within .side-section-toggle {
  opacity: 1;
}
.side-section-toggle:hover {
  color: var(--dim);
}
.side-section-toggle svg {
  width: 13px;
  height: 13px;
}
.side-section-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Workspace drag-to-reorder: a line at the top (drop-before) or bottom
   (drop-after) of the group under the cursor marks where the dragged workspace
   will land. Inset shadows avoid layout shift. */
.ws-drop-target.drop-before { box-shadow: inset 0 2px 0 var(--color-accent); }
.ws-drop-target.drop-after { box-shadow: inset 0 -2px 0 var(--color-accent); }

.empty {
  padding: var(--space-6) var(--space-3);
  text-align: center;
  color: var(--faint);
  font-size: calc(var(--ui-font-size) - 3px);
  line-height: 1.6;
}

/* Workspace menus — surface + items come from Menu / MenuItem; only the
   fixed positioning stays here (anchored to the ⋯ trigger / cursor). */
.ws-menu,
.gh-menu,
.section-menu {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-dropdown);
}

/* Check slot for the section overflow menu — fixed width so unchecked items
   keep their text aligned with the checked one. */
.section-menu-check {
  display: inline-flex;
  flex: none;
  width: 14px;
}
.section-menu-label {
  padding: var(--space-2) var(--space-3) var(--space-1);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
}

/* ---------------------------------------------------------------------------
   Workspaces tab — directory-style workspace rows (icon + name + root path +
   hover kebab). Same inset-pill rhythm as session rows; the whole row opens a
   new session in the workspace.
--------------------------------------------------------------------------- */
.ws-dir {
  display: block;
  padding: 8px calc(var(--sb-pad-x) - var(--sb-inset));
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
  user-select: none;
}
.ws-dir:hover { background: var(--sb-hover, var(--color-hover)); }
.ws-dir.on { background: var(--color-selected); }
.ws-dir + .ws-dir { margin-top: var(--space-05); }
.ws-dir-row {
  display: flex;
  align-items: center;
  gap: var(--sb-gap);
  min-width: 0;
  position: relative;
}
.ws-dir-icon {
  flex: none;
  color: var(--color-text-muted);
}
.ws-dir-name {
  flex: 1;
  min-width: 0;
  font-size: var(--ui-font-size-sm);
  font-weight: var(--weight-caption);
  line-height: var(--leading-tight);
  color: var(--color-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: clip;
  -webkit-mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
  mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
}
.ws-dir-rename {
  flex: 1;
  min-width: 0;
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  font-weight: var(--weight-caption);
  color: var(--color-text);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  padding: 2px 5px;
  outline: none;
}
.ws-dir-sub {
  margin: var(--space-1) 0 0;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: clip;
  -webkit-mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
  mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
}
/* Hover kebab — floats over the row's right edge, revealed on hover/focus.
   The name/sub fade masks leave a 16px tail so the button never collides. */
.ws-dir-act {
  position: absolute;
  top: 50%;
  right: var(--space-1);
  transform: translateY(-50%);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--duration-fast) var(--ease-out),
    visibility 0s linear var(--duration-fast);
}
.ws-dir:hover .ws-dir-act,
.ws-dir:focus-within .ws-dir-act,
.ws-dir-act.open {
  opacity: 1;
  visibility: visible;
  transition: opacity var(--duration-fast) var(--ease-out);
}

/* ---------------------------------------------------------------------------
   Done tab — done-session groups with a count header; the header collapses
   into the shared workspace collapse set (persisted like the open tab).
--------------------------------------------------------------------------- */
.done-gh {
  display: flex;
  align-items: center;
  gap: var(--sb-gap);
  padding: 8px calc(var(--sb-pad-x) - var(--sb-inset));
  border-radius: var(--radius-sm);
  font-family: var(--font-ui);
  color: var(--color-text);
  user-select: none;
  position: relative;
  cursor: pointer;
}
.done-gh:hover { background: var(--sb-hover, var(--color-hover)); }
.done-gh-folder {
  flex: none;
  color: var(--color-text-muted);
}
.done-gh-name {
  flex: 1;
  min-width: 0;
  font-size: var(--ui-font-size-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  color: var(--color-text-muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: clip;
  -webkit-mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
  mask-image: linear-gradient(to right, var(--color-text-strong) calc(100% - 16px), transparent);
}
.done-gh-count {
  flex: none;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.done-gh-more {
  position: absolute;
  top: 50%;
  right: var(--space-1);
  transform: translateY(-50%);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--duration-fast) var(--ease-out),
    visibility 0s linear var(--duration-fast);
}
.done-gh:hover .done-gh-more,
.done-gh:focus-within .done-gh-more,
.done-gh-more.open {
  opacity: 1;
  visibility: visible;
  transition: opacity var(--duration-fast) var(--ease-out);
}
.done-gh:hover .done-gh-count,
.done-gh:focus-within .done-gh-count {
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--duration-fast) var(--ease-out),
    visibility 0s linear var(--duration-fast);
}
.done-gh-sessions {
  padding-bottom: var(--space-1);
}

/* ---------------------------------------------------------------------------
   Folder-drop overlay — covers the whole column while a folder drag hovers it
   (desktop shell only; see the drag handlers in <script>).
--------------------------------------------------------------------------- */
.folder-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3);
  box-sizing: border-box;
  background: color-mix(in srgb, var(--color-sidebar-bg) 72%, transparent);
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--duration-base) ease, visibility var(--duration-base);
}
.folder-drop-overlay.show {
  opacity: 1;
  visibility: visible;
}
.folder-drop-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--color-accent);
  background: var(--color-bg);
  color: var(--color-accent);
  font-size: var(--ui-font-size-lg);
  font-weight: var(--weight-medium);
  box-shadow: var(--shadow-md);
}
.folder-drop-card svg { flex: none; }
.folder-drop-card span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

</style>
