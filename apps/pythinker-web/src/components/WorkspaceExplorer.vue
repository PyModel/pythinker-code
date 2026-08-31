<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../api';
import type { FsEntry } from '../api/types';
import type { FilePreviewRequest, WorkspaceView } from '../types';
import EmptyState from './ui/EmptyState.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';
import Spinner from './ui/Spinner.vue';

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
let requestEpoch = 0;

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
</script>

<template>
  <section id="workspace-explorer" class="workspace-explorer" :aria-label="t('sidebar.explorer')">
    <header class="explorer-header">
      <span>{{ t('sidebar.explorer') }}</span>
      <IconButton
        class="explorer-close"
        size="sm"
        :label="t('sidebar.closeExplorer')"
        @click="emit('close')"
      >
        <Icon name="folder-solid" />
      </IconButton>
    </header>

    <div class="explorer-scroll">
      <template v-if="workspace">
        <button
          class="tree-heading tree-workspace"
          type="button"
          :title="workspace.root"
          :aria-expanded="workspaceExpanded"
          @click="workspaceExpanded = !workspaceExpanded"
        >
          <Icon :name="workspaceExpanded ? 'chevron-down' : 'chevron-right'" size="sm" />
          <span>{{ workspace.name }}</span>
          <Spinner v-if="rootLoading" size="sm" :label="t('sidebar.loadingWorkspaceFiles')" />
        </button>

        <div v-if="!sessionId" class="explorer-message">
          {{ t('sidebar.explorerNeedsSession') }}
        </div>

        <div v-else-if="rootError" class="explorer-message explorer-error" role="alert">
          <span>{{ t('sidebar.explorerLoadFailed') }}</span>
          <button type="button" data-retry-path="." @click="loadDirectory('.')">
            {{ t('sidebar.retry') }}
          </button>
        </div>

        <div
          v-else-if="rootLoaded && children.get('.')?.length === 0"
          class="explorer-message"
        >
          {{ t('sidebar.explorerEmpty') }}
        </div>

        <button
          v-for="item in visibleEntries"
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

        <div v-if="hasTruncatedDirectory" class="explorer-notice">
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

.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex: none;
  padding: var(--space-3) var(--sb-pad-x) var(--space-2);
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
}

.explorer-close {
  flex: none;
  background: var(--color-selected);
  color: var(--color-text);
}

.explorer-scroll {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 var(--sb-inset) var(--space-3);
}

.tree-heading,
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

.tree-heading:hover,
.tree-entry:hover {
  background: var(--sb-hover);
}

.tree-heading:focus-visible,
.tree-entry:focus-visible,
.explorer-error button:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.tree-heading {
  gap: var(--space-1);
  min-height: var(--space-8);
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.tree-heading span:not(.ui-spinner) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-heading .ui-spinner {
  margin-left: auto;
}

.tree-workspace {
  margin-top: var(--space-1);
}

.tree-entry {
  gap: var(--space-1);
  min-height: var(--space-8);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  line-height: var(--leading-tight);
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
