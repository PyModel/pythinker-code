<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../api';
import type { FsEntry } from '../api/types';
import type { FilePreviewRequest, WorkspaceView } from '../types';
import EmptyState from './ui/EmptyState.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';
import Input from './ui/Input.vue';
import Spinner from './ui/Spinner.vue';
import Tooltip from './ui/Tooltip.vue';

const props = defineProps<{
  active: boolean;
  workspace: WorkspaceView | null;
  sessionId: string | null;
}>();

const emit = defineEmits<{
  close: [];
  openFile: [target: FilePreviewRequest];
}>();

const { t } = useI18n();
const children = ref<Map<string, FsEntry[]>>(new Map());
const expandedPaths = ref<Set<string>>(new Set());
const loadingPaths = ref<Set<string>>(new Set());
const errorPaths = ref<Set<string>>(new Set());
const truncatedPaths = ref<Set<string>>(new Set());
const workspaceExpanded = ref(true);
const searchQuery = ref('');
const searchResults = ref<Array<{ path: string; name: string; kind: FsEntry['kind'] }>>([]);
const searchLoading = ref(false);
const searchFailed = ref(false);
const searchTruncated = ref(false);
const backButton = ref<HTMLButtonElement | null>(null);
let requestEpoch = 0;
let searchEpoch = 0;

defineExpose({ focus: () => backButton.value?.focus() });

interface VisibleEntry {
  entry: FsEntry;
  depth: number;
}

const visibleEntries = computed<VisibleEntry[]>(() => {
  const visible: VisibleEntry[] = [];

  function append(parentPath: string, depth: number): void {
    for (const entry of children.value.get(parentPath) ?? []) {
      visible.push({ entry, depth });
      if (entry.kind === 'directory' && expandedPaths.value.has(entry.path)) {
        append(entry.path, depth + 1);
      }
    }
  }

  if (workspaceExpanded.value) append('.', 0);
  return visible;
});

const rootLoaded = computed(() => children.value.has('.'));
const rootLoading = computed(() => loadingPaths.value.has('.'));
const rootError = computed(() => errorPaths.value.has('.'));
const hasTruncatedDirectory = computed(() => truncatedPaths.value.size > 0);
const searchActive = computed(() => searchQuery.value.trim().length > 0);

function sortedEntries(entries: FsEntry[]): FsEntry[] {
  return entries.toSorted((left, right) => {
    const leftDirectory = left.kind === 'directory';
    const rightDirectory = right.kind === 'directory';
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function replaceInSet(source: Set<string>, path: string, present: boolean): Set<string> {
  const next = new Set(source);
  if (present) next.add(path);
  else next.delete(path);
  return next;
}

async function loadDirectory(path: string): Promise<void> {
  const sessionId = props.sessionId;
  if (!sessionId || loadingPaths.value.has(path)) return;

  const epoch = requestEpoch;
  loadingPaths.value = replaceInSet(loadingPaths.value, path, true);
  errorPaths.value = replaceInSet(errorPaths.value, path, false);

  try {
    const result = await getPythinkerWebApi().listDirectory(sessionId, {
      path,
      includeGitStatus: true,
    });
    if (epoch !== requestEpoch || sessionId !== props.sessionId) return;
    children.value = new Map([
      ...children.value,
      [path, sortedEntries(result.items)],
    ]);
    truncatedPaths.value = replaceInSet(truncatedPaths.value, path, result.truncated);
  } catch {
    if (epoch !== requestEpoch || sessionId !== props.sessionId) return;
    errorPaths.value = replaceInSet(errorPaths.value, path, true);
  } finally {
    if (epoch === requestEpoch) {
      loadingPaths.value = replaceInSet(loadingPaths.value, path, false);
    }
  }
}

async function activateEntry(entry: FsEntry): Promise<void> {
  if (entry.kind !== 'directory') {
    openFile(entry.path);
    return;
  }

  if (errorPaths.value.has(entry.path)) {
    await loadDirectory(entry.path);
    return;
  }

  const expanding = !expandedPaths.value.has(entry.path);
  expandedPaths.value = replaceInSet(expandedPaths.value, entry.path, expanding);
  if (expanding && !children.value.has(entry.path)) await loadDirectory(entry.path);
}

function openFile(path: string): void {
  emit('openFile', { path });
}

async function activateSearchEntry(entry: { path: string; kind: FsEntry['kind'] }): Promise<void> {
  if (entry.kind !== 'directory') {
    openFile(entry.path);
    return;
  }

  const paths: string[] = [];
  let path = '';
  for (const segment of entry.path.split('/')) {
    path = path ? `${path}/${segment}` : segment;
    paths.push(path);
  }
  searchQuery.value = '';
  workspaceExpanded.value = true;
  expandedPaths.value = new Set([...expandedPaths.value, ...paths]);
  for (const directory of paths) {
    if (!children.value.has(directory)) await loadDirectory(directory);
  }
}

async function runSearch(workspaceId: string, query: string, epoch: number): Promise<void> {
  try {
    const result = await getPythinkerWebApi().searchFiles(workspaceId, { query, limit: 100 });
    if (epoch !== searchEpoch) return;
    searchResults.value = result.items;
    searchTruncated.value = result.truncated;
  } catch {
    if (epoch === searchEpoch) searchFailed.value = true;
  } finally {
    if (epoch === searchEpoch) searchLoading.value = false;
  }
}

function collapseFolders(): void {
  workspaceExpanded.value = true;
  expandedPaths.value = new Set();
}

function refreshTree(): void {
  searchQuery.value = '';
  resetTree();
  if (props.active && props.workspace && props.sessionId) void loadDirectory('.');
}

function resetTree(): void {
  requestEpoch += 1;
  children.value = new Map();
  expandedPaths.value = new Set();
  loadingPaths.value = new Set();
  errorPaths.value = new Set();
  truncatedPaths.value = new Set();
  workspaceExpanded.value = true;
}

watch(
  [() => props.workspace?.id ?? null, () => props.sessionId],
  ([workspaceId, sessionId]) => {
    resetTree();
    if (props.active && workspaceId && sessionId) void loadDirectory('.');
  },
  { immediate: true },
);

watch(() => props.active, (active) => {
  if (active && props.workspace && props.sessionId) void loadDirectory('.');
});

watch(
  [() => props.active, () => props.workspace?.id ?? null, () => props.sessionId, searchQuery],
  ([active, workspaceId, sessionId, query], _previous, onCleanup) => {
    const epoch = ++searchEpoch;
    const normalizedQuery = query.trim();
    searchResults.value = [];
    searchFailed.value = false;
    searchTruncated.value = false;
    if (!active || !workspaceId || !sessionId || !normalizedQuery) {
      searchLoading.value = false;
      return;
    }

    searchLoading.value = true;
    const timer = setTimeout(() => {
      void runSearch(workspaceId, normalizedQuery, epoch);
    }, 150);
    onCleanup(() => clearTimeout(timer));
  },
);
</script>

<template>
  <section id="workspace-explorer" class="workspace-explorer" :aria-label="t('sidebar.explorer')">
    <button
      ref="backButton"
      class="explorer-back"
      type="button"
      :aria-label="t('sidebar.back')"
      @click="emit('close')"
    >
      <Icon class="explorer-back-icon" name="back-arrow" />
      <span>{{ t('sidebar.back') }}</span>
    </button>

    <div class="explorer-search">
      <Icon class="explorer-search-icon" name="search" />
      <Input
        v-model="searchQuery"
        size="sm"
        type="search"
        :aria-label="t('sidebar.searchFiles')"
        :placeholder="t('sidebar.searchFilesPlaceholder')"
        :disabled="!workspace || !sessionId"
      />
      <Spinner v-if="searchLoading" size="sm" :label="t('sidebar.searchFiles')" />
    </div>

    <div v-if="workspace" class="explorer-workspace-head">
      <span class="explorer-workspace-name" :title="workspace.root">{{ workspace.name }}</span>
      <div class="explorer-workspace-actions">
        <Spinner v-if="rootLoading && !searchActive" size="sm" :label="t('sidebar.loadingWorkspaceFiles')" />
        <Tooltip :text="t('sidebar.collapseFolders')">
          <IconButton size="sm" :label="t('sidebar.collapseFolders')" @click="collapseFolders">
            <Icon name="collapse" />
          </IconButton>
        </Tooltip>
        <Tooltip :text="t('sidebar.refreshFiles')">
          <IconButton size="sm" :label="t('sidebar.refreshFiles')" @click="refreshTree">
            <Icon name="refresh" />
          </IconButton>
        </Tooltip>
      </div>
    </div>

    <div class="explorer-scroll">
      <template v-if="workspace">
        <div v-if="searchActive && searchFailed" class="explorer-message explorer-error" role="alert">
          {{ t('sidebar.searchFilesFailed') }}
        </div>

        <div v-else-if="searchActive && !searchLoading && searchResults.length === 0" class="explorer-message">
          {{ t('sidebar.noFileMatches') }}
        </div>

        <button
          v-for="entry in searchActive ? searchResults : []"
          :key="entry.path"
          class="tree-entry search-entry"
          type="button"
          :title="entry.path"
          :data-search-path="entry.path"
          @click="activateSearchEntry(entry)"
        >
          <Icon :name="entry.kind === 'directory' ? 'folder-closed' : 'file'" size="sm" />
          <span class="tree-entry-name">{{ entry.name }}</span>
          <span class="search-entry-path">{{ entry.path }}</span>
        </button>

        <div v-if="searchActive && searchTruncated" class="explorer-notice">
          {{ t('sidebar.explorerTruncated') }}
        </div>

        <div v-else-if="!searchActive && !sessionId" class="explorer-message">
          {{ t('sidebar.explorerNeedsSession') }}
        </div>

        <div v-else-if="!searchActive && rootError" class="explorer-message explorer-error" role="alert">
          <span>{{ t('sidebar.explorerLoadFailed') }}</span>
          <button type="button" data-retry-path="." @click="loadDirectory('.')">
            {{ t('sidebar.retry') }}
          </button>
        </div>

        <div
          v-else-if="!searchActive && rootLoaded && children.get('.')?.length === 0"
          class="explorer-message"
        >
          {{ t('sidebar.explorerEmpty') }}
        </div>

        <button
          v-for="item in searchActive ? [] : visibleEntries"
          :key="item.entry.path"
          class="tree-entry"
          type="button"
          :title="item.entry.path"
          :data-path="item.entry.path"
          data-testid="workspace-tree-entry"
          :aria-expanded="item.entry.kind === 'directory' ? expandedPaths.has(item.entry.path) : undefined"
          @click="activateEntry(item.entry)"
        >
          <span
            v-for="level in item.depth"
            :key="level"
            class="tree-indent"
            aria-hidden="true"
          />
          <Icon
            v-if="item.entry.kind === 'directory'"
            :name="expandedPaths.has(item.entry.path) ? 'chevron-down' : 'chevron-right'"
            size="sm"
          />
          <span v-else class="tree-chevron-space" aria-hidden="true" />
          <Icon
            :name="item.entry.kind === 'directory'
              ? (expandedPaths.has(item.entry.path) ? 'folder' : 'folder-closed')
              : 'file'"
            size="sm"
          />
          <span class="tree-entry-name">{{ item.entry.name }}</span>
          <Spinner
            v-if="loadingPaths.has(item.entry.path)"
            size="sm"
            :label="t('sidebar.loadingWorkspaceFiles')"
          />
          <Icon
            v-else-if="errorPaths.has(item.entry.path)"
            name="alert-triangle"
            size="sm"
            :label="t('sidebar.explorerLoadFailed')"
          />
          <span v-else-if="item.entry.gitStatus" class="tree-git-status" aria-hidden="true" />
        </button>

        <div v-if="!searchActive && hasTruncatedDirectory" class="explorer-notice">
          {{ t('sidebar.explorerTruncated') }}
        </div>
      </template>

      <EmptyState v-else :title="t('workspace.noWorkspace')">
        <template #icon><Icon name="folder-closed" size="lg" /></template>
      </EmptyState>
    </div>
  </section>
</template>

<style scoped>
.workspace-explorer {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
}

.explorer-back {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  width: calc(100% - 2 * var(--sb-inset));
  margin: var(--space-3) var(--sb-inset) var(--space-2);
  padding: var(--space-2) var(--space-3);
  min-height: var(--control-size-md);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-strong);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: var(--weight-regular);
  line-height: var(--leading-tight);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.explorer-back:hover {
  background: var(--sb-hover);
  color: var(--color-text-strong);
}

.explorer-back:focus {
  outline: none;
}

.explorer-back:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.explorer-back-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--color-text-strong);
}

.explorer-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
  margin: 0 var(--sb-inset) var(--space-3);
}

.explorer-search-icon {
  position: absolute;
  left: var(--space-3);
  z-index: 1;
  color: var(--color-text-faint);
  pointer-events: none;
}

.explorer-search :deep(.ui-input) {
  min-width: 0;
  padding-left: calc(var(--space-3) + var(--p-ic-md) + var(--space-2));
  padding-right: calc(var(--space-3) + var(--p-ic-md));
}

.explorer-search :deep(.ui-spinner) {
  position: absolute;
  right: var(--space-3);
}

.explorer-workspace-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  min-width: 0;
  padding: 0 var(--sb-pad-x) var(--space-2);
}

.explorer-workspace-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-workspace-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
}

.explorer-scroll {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--sb-inset) var(--space-4);
}

.tree-entry {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
}

.tree-entry:hover {
  background: var(--sb-hover);
}

.tree-entry:focus-visible,
.explorer-error button:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.tree-entry {
  gap: var(--space-1);
  min-height: var(--space-8);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
}

.search-entry {
  gap: var(--space-2);
}

.search-entry-path {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-indent {
  flex: 0 0 var(--space-4);
}

.tree-chevron-space {
  flex: 0 0 var(--p-ic-sm);
}

.tree-entry-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-git-status {
  flex: none;
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-warning);
}

.explorer-message,
.explorer-notice {
  margin: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}

.explorer-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--color-danger);
}

.explorer-error button {
  border: 0;
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  background: var(--color-hover);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
</style>
