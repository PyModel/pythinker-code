<!-- apps/pythinker-web/src/components/Sidebar.vue -->
<!-- Unified sidebar: session groups with collapsible workspace headers.
     The old workspace rail and workspace tabs have been removed;
     workspace switching, folding and renaming all live in the group header. -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Session, WorkspaceGroup, WorkspaceView } from '../types';
import type { SettingsTab } from '../composables/useSettingsNav';
import SessionRow from './SessionRow.vue';
import PythinkerLogo from './PythinkerLogo.vue';
import SettingsNav from './settings/SettingsNav.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    activeWorkspace: WorkspaceView | null;
    activeWorkspaceId: string | null;
    sessions: Session[];
    groups: WorkspaceGroup[];
    activeId: string;
    attentionBySession?: Record<string, number>;
    /** Per-session pending counts split by kind, for the coloured tags. */
    pendingBySession?: Record<string, { approvals: number; questions: number }>;
    unreadBySession?: Record<string, boolean>;
    /** Width (px) of the session column, driven by the App resize handle. */
    colWidth?: number;
    mode?: 'sessions' | 'settings';
    activeSettingsTab?: SettingsTab;
  }>(),
  {
    activeWorkspace: null,
    activeWorkspaceId: null,
    attentionBySession: () => ({}),
    pendingBySession: () => ({}),
    unreadBySession: () => ({}),
    colWidth: 220,
    mode: 'sessions',
    activeSettingsTab: 'general',
  },
);

const emit = defineEmits<{
  select: [sessionId: string];
  create: [];
  createInWorkspace: [workspaceId: string];
  selectWorkspace: [workspaceId: string];
  selectWorkspaces: [ids: string[]];
  addWorkspace: [];
  rename: [id: string, title: string];
  archive: [id: string];
  fork: [id: string];
  renameWorkspace: [id: string, name: string];
  deleteWorkspace: [id: string];
  openSettings: [];
  closeSettings: [];
  selectSettingsTab: [tab: SettingsTab];
  collapse: [];
}>();



// ---------------------------------------------------------------------------
// Collapse groups
// ---------------------------------------------------------------------------
const collapsedIds = ref<Set<string>>(new Set());
const toggledIds = ref<Set<string>>(new Set());

function isCollapsed(id: string): boolean {
  return toggledIds.value.has(id) ? collapsedIds.value.has(id) : id !== props.activeWorkspaceId;
}

function toggleCollapse(id: string): void {
  const next = new Set(collapsedIds.value);
  if (isCollapsed(id)) {
    next.delete(id);
    // Reset session expansion when workspace is expanded
    const expandedNext = new Set(expandedWsIds.value);
    expandedNext.delete(id);
    expandedWsIds.value = expandedNext;
  } else {
    next.add(id);
  }
  collapsedIds.value = next;
  toggledIds.value = new Set(toggledIds.value).add(id);
}

// ---------------------------------------------------------------------------
// Session list truncation per workspace
// ---------------------------------------------------------------------------
const DEFAULT_VISIBLE_COUNT = 10;

/** workspace id → true = show all sessions */
const expandedWsIds = ref<Set<string>>(new Set());

function isExpanded(wsId: string): boolean {
  return expandedWsIds.value.has(wsId);
}

function toggleExpand(wsId: string): void {
  const next = new Set(expandedWsIds.value);
  if (next.has(wsId)) next.delete(wsId);
  else next.add(wsId);
  expandedWsIds.value = next;
}

/** Show the most recent N sessions. If the active session is older than N,
    replace the last slot with it so the highlight never disappears. */
function visibleSessions(sessions: Session[], expanded: boolean, activeId?: string): Session[] {
  if (expanded || sessions.length <= DEFAULT_VISIBLE_COUNT) return sessions;
  const visible = sessions.slice(0, DEFAULT_VISIBLE_COUNT);
  if (activeId && !visible.some((s) => s.id === activeId)) {
    const active = sessions.find((s) => s.id === activeId);
    if (active) visible[DEFAULT_VISIBLE_COUNT - 1] = active;
  }
  return visible;
}

// ---------------------------------------------------------------------------
// Workspace search and display filters
// ---------------------------------------------------------------------------
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);

function searchTerm(): string {
  return searchQuery.value.trim().toLowerCase();
}

function filteredSessions(sessions: Session[], expanded: boolean, activeId?: string): Session[] {
  const query = searchTerm();
  return query
    ? sessions.filter((session) => session.title.toLowerCase().includes(query))
    : visibleSessions(sessions, expanded, activeId);
}

function groupMatchesSearch(group: WorkspaceGroup): boolean {
  const query = searchTerm();
  return !query
    || group.workspace.name.toLowerCase().includes(query)
    || group.sessions.some((session) => session.title.toLowerCase().includes(query));
}

async function toggleSearch(): Promise<void> {
  if (searchOpen.value) {
    searchOpen.value = false;
    searchQuery.value = '';
    return;
  }
  searchOpen.value = true;
  await nextTick();
  try {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  } catch {
    // jsdom may not implement focus/select
  }
}

async function openSearch(): Promise<void> {
  if (!searchOpen.value) await toggleSearch();
}

defineExpose({ openSearch });

function closeEmptySearch(): void {
  if (!searchQuery.value.trim()) searchOpen.value = false;
}

function clearSearch(): void {
  searchQuery.value = '';
  searchOpen.value = false;
}

const filterMenuOpen = ref(false);
const filterMenuStyle = ref<Record<string, string>>({});
const filterMenuRef = ref<HTMLElement | null>(null);

function onFilterMenuDocClick(e: MouseEvent): void {
  const target = e.target as Element;
  if (target.closest('.ws-filter-btn') || target.closest('.ws-filter-menu')) return;
  closeFilterMenu();
}

async function toggleFilterMenu(e: MouseEvent): Promise<void> {
  if (filterMenuOpen.value) {
    closeFilterMenu();
    return;
  }
  const btn = e.currentTarget as HTMLElement;
  filterMenuOpen.value = true;
  document.addEventListener('mousedown', onFilterMenuDocClick);
  document.addEventListener('scroll', closeFilterMenu, true);
  window.addEventListener('resize', closeFilterMenu);
  await nextTick();
  const menu = filterMenuRef.value;
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
  filterMenuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
  };
}

function closeFilterMenu(): void {
  filterMenuOpen.value = false;
  document.removeEventListener('mousedown', onFilterMenuDocClick);
  document.removeEventListener('scroll', closeFilterMenu, true);
  window.removeEventListener('resize', closeFilterMenu);
}

function collapseAll(workspaceGroups: WorkspaceGroup[]): void {
  const ids = workspaceGroups.map((group) => group.workspace.id);
  collapsedIds.value = new Set(ids);
  toggledIds.value = new Set(ids);
  closeFilterMenu();
}

function expandAll(): void {
  collapsedIds.value = new Set();
  toggledIds.value = new Set(props.groups.map((group) => group.workspace.id));
  closeFilterMenu();
}

// ---------------------------------------------------------------------------
// Shift-multi-select workspaces
// ---------------------------------------------------------------------------
const selectedIds = ref<Set<string>>(new Set());

function handleGhClick(wsId: string, e: MouseEvent): void {
  if (e.shiftKey) {
    e.stopPropagation();
    const next = new Set(selectedIds.value);
    if (next.has(wsId)) next.delete(wsId);
    else next.add(wsId);
    selectedIds.value = next;
    emit('selectWorkspaces', Array.from(next));
    return;
  }
  // Normal click: clear multi-selection then toggle collapse
  selectedIds.value = new Set();
  emit('selectWorkspaces', []);
  toggleCollapse(wsId);
}

function onSelectSession(sessionId: string): void {
  selectedIds.value = new Set();
  emit('selectWorkspaces', []);
  emit('select', sessionId);
}

// ---------------------------------------------------------------------------
// Rename workspace (inline, like SessionRow)
// ---------------------------------------------------------------------------
const renamingId = ref<string | null>(null);
const renameValue = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

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

// ---------------------------------------------------------------------------
// Workspace right-click menu (copy path, rename)
// ---------------------------------------------------------------------------
const ghMenuOpen = ref(false);
const ghMenuTarget = ref<WorkspaceView | null>(null);
const ghMenuStyle = ref<Record<string, string>>({});
const ghMenuRef = ref<HTMLElement | null>(null);

function onGhMenuDocClick(e: MouseEvent): void {
  if (ghMenuRef.value && !ghMenuRef.value.contains(e.target as Node)) {
    closeGhMenu();
  }
}

function openGhMenu(ws: WorkspaceView, e: MouseEvent): void {
  if (e.shiftKey) {
    // shift+right-click = multi-select (same as shift+click)
    e.stopPropagation();
    const next = new Set(selectedIds.value);
    if (next.has(ws.id)) next.delete(ws.id);
    else next.add(ws.id);
    selectedIds.value = next;
    emit('selectWorkspaces', Array.from(next));
    return;
  }
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
  disarmDeleteWs();
}

function copyPathFromMenu(): void {
  if (ghMenuTarget.value) {
    void navigator.clipboard.writeText(ghMenuTarget.value.root);
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
  if (!armDeleteWs(ws.id)) return; // first click arms ("confirm?"), keep menu open
  emit('deleteWorkspace', ws.id);
  closeGhMenu();
}

// ---------------------------------------------------------------------------
// Two-step workspace delete (shared by the kebab menu and the context menu):
// the first click arms the item — it turns into a "confirm" label — and a
// second click within 2.5s actually deletes; otherwise the item reverts.
// ---------------------------------------------------------------------------
const deleteArmedWsId = ref<string | null>(null);
let deleteArmTimer: ReturnType<typeof setTimeout> | undefined;

function disarmDeleteWs(): void {
  clearTimeout(deleteArmTimer);
  deleteArmedWsId.value = null;
}

/** Returns true when the delete is confirmed (second click while armed). */
function armDeleteWs(id: string): boolean {
  if (deleteArmedWsId.value === id) {
    disarmDeleteWs();
    return true;
  }
  clearTimeout(deleteArmTimer);
  deleteArmedWsId.value = id;
  deleteArmTimer = setTimeout(() => {
    deleteArmedWsId.value = null;
  }, 2500);
  return false;
}

// ---------------------------------------------------------------------------
// Workspace inline more-menu (kebab, hover-triggered). Rendered position:fixed
// and anchored to the ⋯ button so the scrolling session list can't clip it;
// it doesn't follow the anchor, so scroll/resize simply close it.
// ---------------------------------------------------------------------------
const wsMenuOpenId = ref<string | null>(null);
const wsMenuTarget = ref<WorkspaceView | null>(null);
const wsMenuStyle = ref<Record<string, string>>({});
const wsMenuRef = ref<HTMLElement | null>(null);

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
  document.addEventListener('scroll', closeWsMenu, true);
  window.addEventListener('resize', closeWsMenu);
  await nextTick();
  const menu = wsMenuRef.value;
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
  disarmDeleteWs();
  document.removeEventListener('mousedown', onWsMenuDocClick);
  document.removeEventListener('scroll', closeWsMenu, true);
  window.removeEventListener('resize', closeWsMenu);
}

function copyWsPath(ws: WorkspaceView): void {
  void navigator.clipboard.writeText(ws.root);
  closeWsMenu();
}

function startRenameWs(ws: WorkspaceView): void {
  startRenameWorkspace(ws.id, ws.name);
  closeWsMenu();
}

function deleteWs(ws: WorkspaceView): void {
  if (!armDeleteWs(ws.id)) return; // first click arms ("confirm?"), keep menu open
  emit('deleteWorkspace', ws.id);
  closeWsMenu();
}

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onGhMenuDocClick, true);
  document.removeEventListener('mousedown', onWsMenuDocClick);
  document.removeEventListener('scroll', closeWsMenu, true);
  window.removeEventListener('resize', closeWsMenu);
  closeFilterMenu();
  clearTimeout(deleteArmTimer);
});
</script>

<template>
  <aside class="side">
    <!-- Session column -->
    <div class="col" :style="{ width: colWidth + 'px' }">
      <!-- Header: logo + collapse (no hard border — flows into workspace list) -->
      <div class="ch">
        <div class="ch-brand">
          <PythinkerLogo size="sm" interactive />
          <span class="ch-name">Pythinker Code</span>
        </div>
        <button
          type="button"
          class="collapse-btn"
          :title="t('sidebar.collapseSidebar')"
          :aria-label="t('sidebar.collapseSidebar')"
          @click.stop="emit('collapse')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9.5 4v16" />
          </svg>
        </button>
      </div>

      <!-- New session -->
      <div class="btn-wrap">
        <button type="button" class="btn-new-chat" @click.stop="emit('create')">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v6M5 8h6" />
          </svg>
          <span>{{ t('sidebar.newSession') }}</span>
        </button>
      </div>

      <!-- The header and New Session button above stay mounted in both modes; only
           the body below swaps between the session list and the settings nav. -->
      <template v-if="mode === 'sessions'">
      <!-- Workspace section actions -->
      <div class="ws-head">
        <input
          v-if="searchOpen"
          ref="searchInputRef"
          v-model="searchQuery"
          class="ws-search-input"
          type="search"
          :placeholder="t('sidebar.searchSessions')"
          :aria-label="t('sidebar.searchSessions')"
          @keydown.esc.stop.prevent="clearSearch"
          @blur="closeEmptySearch"
        />
        <span v-else class="ws-head-label">{{ t('sidebar.workspaces') }}</span>
        <div class="ws-head-actions">
          <button
            type="button"
            class="ws-search-btn"
            :title="t('sidebar.searchSessions')"
            :aria-label="t('sidebar.searchSessions')"
            @click.stop="toggleSearch"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="m10.5 10.5 3 3" />
            </svg>
          </button>
          <button
            type="button"
            class="ws-filter-btn"
            :title="t('sidebar.filterWorkspaces')"
            :aria-label="t('sidebar.filterWorkspaces')"
            :aria-expanded="filterMenuOpen"
            aria-haspopup="menu"
            @click.stop="toggleFilterMenu($event)"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" />
              <circle cx="6" cy="4" r="1.25" fill="currentColor" stroke="none" />
              <circle cx="10" cy="8" r="1.25" fill="currentColor" stroke="none" />
              <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            class="ws-add-btn"
            :title="t('sidebar.newWorkspace')"
            :aria-label="t('sidebar.newWorkspace')"
            @click.stop="emit('addWorkspace')"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 4V2.5A1 1 0 0 1 2 1.5h3.5l1.3 2H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" />
              <path d="M1 5.5h13M10.5 8v3M9 9.5h3" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Session list — grouped by workspace -->
      <div class="sessions">
        <!-- Empty state — only when no workspace is registered at all; empty
             workspaces still render their group header (with the + button). -->
        <div v-if="groups.length === 0" class="empty">
          {{ t('workspace.noWorkspace') }}
        </div>

        <template v-else>
          <div v-for="g in groups" :key="g.workspace.id" v-show="groupMatchesSearch(g)" class="group">
            <div
              class="gh"
              :class="{ on: g.workspace.id === activeWorkspaceId, sel: selectedIds.has(g.workspace.id) }"
              @click.stop="handleGhClick(g.workspace.id, $event)"
              @contextmenu="openGhMenu(g.workspace, $event)"
            >
              <div class="gh-top">
                <!-- Folder icon -->
                <svg
                  class="gh-folder"
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.2"
                  aria-hidden="true"
                >
                  <template v-if="isCollapsed(g.workspace.id)">
                    <rect x="1" y="3.5" width="12" height="8.5" rx="1"/>
                    <path d="M1 5V3.5A1 1 0 0 1 2 2.5h3.5l1.3 2"/>
                  </template>
                  <template v-else>
                    <path d="M1 3.5V2.5A1 1 0 0 1 2 1.5h3.5l1.3 2h5.2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z"/>
                    <path d="M1 5.5h12"/>
                  </template>
                </svg>

                <!-- Workspace name -->
                <span
                  v-if="renamingId !== g.workspace.id"
                  class="gh-name"
                  :title="g.workspace.root"
                >{{ g.workspace.name }}</span>
                <input
                  v-else
                  ref="renameInputRef"
                  v-model="renameValue"
                  class="gh-rename"
                  type="text"
                  @keydown.enter="confirmRenameWorkspace"
                  @keydown.esc="cancelRenameWorkspace"
                  @blur="cancelRenameWorkspace"
                  @click.stop
                />

                <button
                  type="button"
                  class="gh-more"
                  :class="{ open: wsMenuOpenId === g.workspace.id }"
                  :title="t('sidebar.options')"
                  :aria-label="t('sidebar.options')"
                  aria-haspopup="menu"
                  :aria-expanded="wsMenuOpenId === g.workspace.id"
                  @click.stop="toggleWsMenu(g.workspace, $event)"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <circle cx="8" cy="3" r="1.3" />
                    <circle cx="8" cy="8" r="1.3" />
                    <circle cx="8" cy="13" r="1.3" />
                  </svg>
                </button>

                <button
                  type="button"
                  class="gh-add"
                  :title="t('workspace.newInGroup')"
                  :aria-label="t('workspace.newInGroup')"
                  @click.stop="emit('createInWorkspace', g.workspace.id)"
                >
                  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M8 3v10M3 8h10"/>
                  </svg>
                </button>
              </div>

            </div>
            <div v-show="!isCollapsed(g.workspace.id)" class="group-sessions">
              <SessionRow
                v-for="s in filteredSessions(g.sessions, isExpanded(g.workspace.id), activeId)"
                :key="s.id"
                :session="s"
                :active="s.id === activeId"
                :approval-count="pendingBySession[s.id]?.approvals ?? 0"
                :question-count="pendingBySession[s.id]?.questions ?? 0"
                :unread="unreadBySession[s.id] ?? false"
                @select="onSelectSession($event)"
                @rename="(id, title) => emit('rename', id, title)"
                @archive="emit('archive', $event)"
                @fork="emit('fork', $event)"
              />
              <button
                v-if="!searchTerm() && !isExpanded(g.workspace.id) && filteredSessions(g.sessions, false, activeId).length < g.sessions.length"
                class="show-more"
                @click.stop="toggleExpand(g.workspace.id)"
              >
                {{ t('sidebar.showMore', { count: g.sessions.length - filteredSessions(g.sessions, false, activeId).length }) }}
              </button>
              <div v-if="g.sessions.length === 0" class="group-empty">{{ t('sidebar.noSessions') }}</div>
            </div>
          </div>
        </template>
      </div>

      <div class="side-foot">
        <button type="button" class="settings-row" @click.stop="emit('openSettings')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
          </svg>
          <span>{{ t('settings.title') }}</span>
        </button>
      </div>
      </template>

      <template v-else>
        <div class="settings-nav-body">
          <SettingsNav :active-tab="activeSettingsTab" @select="emit('selectSettingsTab', $event)" />
        </div>
        <div class="side-foot">
          <button type="button" class="settings-row" @click.stop="emit('closeSettings')">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m10 3-5 5 5 5" />
            </svg>
            <span>{{ t('settings.backToSessions') }}</span>
          </button>
        </div>
      </template>
    </div>

    <div
      v-if="filterMenuOpen"
      ref="filterMenuRef"
      class="ws-menu ws-filter-menu"
      :style="filterMenuStyle"
      role="menu"
      @click.stop
    >
      <button type="button" class="ws-menu-item" role="menuitem" @click.stop="collapseAll(groups)">
        {{ t('sidebar.collapseAll') }}
      </button>
      <button type="button" class="ws-menu-item" role="menuitem" @click.stop="expandAll">
        {{ t('sidebar.expandAll') }}
      </button>
    </div>

    <!-- Workspace right-click menu (position:fixed) -->
    <div
      v-if="ghMenuOpen"
      ref="ghMenuRef"
      class="gh-menu"
      :style="ghMenuStyle"
      @click.stop
    >
      <button type="button" class="ghm-item" @click="copyPathFromMenu">
        {{ t('sidebar.copyPath') }}
      </button>
      <button type="button" class="ghm-item" @click="startRenameFromMenu">
        {{ t('sidebar.rename') }}
      </button>
      <button type="button" class="ghm-item del" @click="deleteFromMenu">
        {{ ghMenuTarget && deleteArmedWsId === ghMenuTarget.id ? t('sidebar.confirm') : t('sidebar.removeWorkspace') }}
      </button>
    </div>

    <!-- Workspace kebab menu (position:fixed, anchored to the ⋯ button so the
         scrolling session list cannot clip it) -->
    <div
      v-if="wsMenuOpenId !== null && wsMenuTarget"
      ref="wsMenuRef"
      class="ws-menu"
      :style="wsMenuStyle"
      @click.stop
    >
      <button class="ws-menu-item" @click.stop="copyWsPath(wsMenuTarget)">
        {{ t('sidebar.copyPath') }}
      </button>
      <div class="ws-menu-divider" />
      <button class="ws-menu-item" @click.stop="startRenameWs(wsMenuTarget)">
        {{ t('sidebar.rename') }}
      </button>
      <div class="ws-menu-divider" />
      <button class="ws-menu-item del" @click.stop="deleteWs(wsMenuTarget)">
        {{ deleteArmedWsId === wsMenuTarget.id ? t('sidebar.confirm') : t('sidebar.removeWorkspace') }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.side {
  border-right: 1px solid var(--line);
  background: var(--panel);
  display: flex;
  flex-direction: row;
  min-width: 0;
  height: 100%;
  /* Alignment contract, inherited by SessionRow and the theme overrides in
     style.css: text in the workspace header and session rows all starts at
     --sb-pad-x + --sb-gutter + --sb-gap from the sidebar edge. */
  --sb-pad-x: 16px;  /* row horizontal padding */
  --sb-gutter: 20px; /* leading icon slot (14px folder icon + 6px margin) */
  --sb-gap: 6px;     /* gap between the icon slot and the text */
}

/* Session column. Width is set inline from the App resize handle. */
.col {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  container-type: inline-size;
  container-name: sidebar-col;
}

/* Header: logo + collapse (no border — flows into the workspace list). */
.ch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px 4px;
  width: 100%;
  box-sizing: border-box;
}
:global(html[data-desktop-platform='darwin'] .ch) {
  padding-top: 20px;
}
:global(html[data-desktop-platform='darwin'] .ch button),
:global(html[data-desktop-platform='darwin'] .ch .ch-brand) {
  -webkit-app-region: no-drag;
}
.ch-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* Take the row's slack so the action buttons group together on the right. */
  flex: 1;
}
.ch-name {
  font-size: var(--ui-font-size);
  font-weight: 500;
  line-height: 22px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* In narrow sidebars the product name drops out so the logo keeps its fixed
   size and the action buttons remain reachable. */
@container sidebar-col (max-width: 250px) {
  .ch-name { display: none; }
}
.collapse-btn {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: none;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.collapse-btn:hover { background: var(--soft); color: var(--ink); }
.collapse-btn:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

/* Action buttons */
.btn-wrap {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
}
.btn-wrap button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  font-family: var(--mono);
  font-size: var(--ui-font-size);
  font-weight: 400;
  line-height: 1;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
}
.btn-wrap button svg { flex: none; }
.btn-wrap button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 1px;
}
.btn-wrap button span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn-new-chat {
  flex: 1;
  justify-content: center;
  gap: 10px;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.btn-new-chat:hover {
  background: color-mix(in srgb, var(--ink) 6%, var(--soft));
}

/* Workspace section header */
.ws-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px var(--sb-pad-x) 2px;
  min-width: 0;
}
.ws-head-label {
  color: var(--muted);
  font-size: var(--ui-font-size);
  min-width: 0;
}
.ws-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.ws-head-actions button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ws-head-actions button:hover { background: var(--soft); color: var(--ink); }
.ws-head-actions button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}
.ws-search-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  box-sizing: border-box;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--soft);
  color: var(--ink);
  font: inherit;
  outline: none;
}
.ws-search-input:focus { border-color: var(--blue); }

/* Sessions */
.sessions {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 8px;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
}
.sessions::-webkit-scrollbar { width: 4px; }
.sessions::-webkit-scrollbar-track { background: transparent; }
.sessions::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 2px;
}
.sessions::-webkit-scrollbar-thumb:hover { background: var(--bd); }

.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--faint);
  font-size: calc(var(--ui-font-size) - 3px);
  line-height: 1.6;
}

/* Workspace group */
.group { padding-bottom: 6px; }
.gh {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 var(--sb-pad-x) 4px;
  font-size: max(9px, calc(var(--ui-font-size) - 3.5px));
  user-select: none;
  position: relative;
}
.gh-top {
  display: flex;
  align-items: center;
  gap: var(--sb-gap);
}
.gh.sel {
  background: var(--soft);
  border-radius: 4px;
}

.gh-folder {
  flex: none;
  color: var(--muted);
  /* 14px icon + 2px margin fills the --sb-gutter icon slot */
  margin-right: calc(var(--sb-gutter) - 14px);
}
.gh.on .gh-folder { color: var(--blue); }

.gh-name {
  font-size: var(--ui-font-size);
  font-weight: 500;
  color: var(--ink);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.gh-add {
  background: transparent;
  border: none;
  color: var(--faint);
  cursor: pointer;
  display: inline-flex;
  opacity: 0;
  pointer-events: none;
  align-items: center;
  justify-content: center;
  /* Keep the icon small but give the button a ≥24px tap target. Extra padding
     is vertical only so the right-rail alignment below is preserved. */
  padding: 5px 6px;
  border-radius: 4px;
  flex: none;
  /* Pull the glyph onto the right rail: its right edge lands at --sb-pad-x
     from the sidebar edge, mirroring the folder icon's left gap and lining
     up with the session timestamps below. */
  margin-right: -6px;
}
.gh-add:hover { color: var(--dim); }
.gh-add:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

/* More button — hidden until hover */
.gh-more {
  display: inline-flex;
  opacity: 0;
  pointer-events: none;
  flex: none;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: var(--muted);
  border-radius: 4px;
}
.gh:hover .gh-more,
.gh:hover .gh-add,
.gh-more:focus-visible,
.gh-add:focus-visible,
.gh-more.open {
  opacity: 1;
  pointer-events: auto;
}
.gh-more:hover,
.gh-more.open { color: var(--ink); background: var(--line2); }
.gh-more:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
  /* Keyboard users can't hover, so the focused kebab must be visible. */
  display: inline-flex;
}

/* Workspace kebab dropdown menu — fixed so the scroll container can't clip it;
   anchored to the ⋯ trigger from toggleWsMenu(). */
.ws-menu {
  position: fixed;
  top: 0;
  left: 0;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  z-index: 200;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow: hidden;
  min-width: 88px;
}
.ws-filter-menu { min-width: 132px; }
.ws-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--mono);
  font-size: calc(var(--ui-font-size) - 3px);
  color: var(--ink);
  padding: 6px 12px;
}
.ws-menu-item:hover { background: var(--panel2); }

/* Danger items (delete workspace) — red in both light and dark schemes. */
.ws-menu-item.del,
.ghm-item.del { color: var(--err); }
.ws-menu-item.del:hover,
.ghm-item.del:hover {
  background: color-mix(in srgb, var(--err) 10%, transparent);
}

.ws-menu-divider {
  height: 1px;
  background: var(--line);
  margin: 2px 0;
}

.group-empty {
  padding: 8px 10px 8px calc(var(--sb-pad-x) + var(--sb-gutter) + var(--sb-gap));
  font-size: calc(var(--ui-font-size) - 1.5px);
  color: var(--muted);
  font-family: var(--mono);
}
.show-more {
  display: block;
  width: 100%;
  padding: 6px 10px 6px calc(var(--sb-pad-x) + var(--sb-gutter) + var(--sb-gap));
  background: none;
  border: none;
  color: var(--dim);
  font-size: calc(var(--ui-font-size) - 1.5px);
  font-family: var(--mono);
  cursor: pointer;
  text-align: left;
}
.show-more:hover {
  color: var(--blue2);
  background: var(--soft);
}

/* Inline workspace rename input */
.gh-rename {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--ui-font-size-xs);
  font-weight: 400;
  color: var(--ink);
  background: var(--bg);
  border: 1px solid var(--blue);
  border-radius: 3px;
  padding: 2px 5px;
  outline: none;
}



/* ---------------------------------------------------------------------------
   Workspace right-click menu (position:fixed)
   --------------------------------------------------------------------------- */
.gh-menu {
  position: fixed;
  top: 0;
  left: 0;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: 200;
}
.ghm-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: var(--ui-font-size-xs);
  color: var(--text);
  background: transparent;
  border: none;
  cursor: pointer;
}
.ghm-item:hover {
  background: var(--soft);
}

/* Pinned settings action */
.settings-nav-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.side-foot {
  flex: none;
  border-top: none;
}
.settings-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 10px var(--sb-pad-x);
  border: none;
  background: none;
  color: var(--muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.settings-row:hover { color: var(--ink); background: var(--soft); }
.settings-row:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

</style>
