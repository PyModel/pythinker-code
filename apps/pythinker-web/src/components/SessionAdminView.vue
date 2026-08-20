<script lang="ts">
export interface AdminSession {
  id: string;
  title: string;
  workspaceId: string;
  workspaceName: string;
  lastPrompt?: string;
  updatedAt: string;
  archived: boolean;
}

export interface AdminFilters {
  workspaceIds: string[];
  status: 'all' | 'open' | 'done';
  updatedDays: number | null;
  query: string;
  now?: Date;
}

export function filterAdminSessions(items: AdminSession[], filters: AdminFilters): AdminSession[] {
  const query = filters.query.trim().toLowerCase();
  const cutoff = filters.updatedDays === null
    ? null
    : (filters.now ?? new Date()).getTime() - filters.updatedDays * 86_400_000;
  return items
    .filter((item) => filters.workspaceIds.length === 0 || filters.workspaceIds.includes(item.workspaceId))
    .filter((item) => filters.status === 'all' || (filters.status === 'done') === item.archived)
    .filter((item) => cutoff === null || new Date(item.updatedAt).getTime() <= cutoff)
    .filter((item) => query === '' || `${item.title}\n${item.lastPrompt ?? ''}`.toLowerCase().includes(query))
    .toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function pageAdminSessions(items: AdminSession[], requestedPage: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 1), pages);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pages };
}

export function togglePageSelection(selected: Set<string>, page: AdminSession[]): Set<string> {
  const next = new Set(selected);
  const allSelected = page.length > 0 && page.every((item) => next.has(item.id));
  for (const item of page) {
    if (allSelected) next.delete(item.id);
    else next.add(item.id);
  }
  return next;
}
</script>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { WorkspaceView } from '../types';
import Button from './ui/Button.vue';
import Checkbox from './ui/Checkbox.vue';
import EmptyState from './ui/EmptyState.vue';
import FilterSelect from './ui/FilterSelect.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';
import Input from './ui/Input.vue';
import MultiSelectMenu from './ui/MultiSelectMenu.vue';
import Spinner from './ui/Spinner.vue';

const props = defineProps<{
  openSessions: AdminSession[];
  workspaces: WorkspaceView[];
  loadArchived: () => Promise<AdminSession[]>;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
}>();

const emit = defineEmits<{ back: [] }>();
const { t } = useI18n();
const archivedSessions = ref<AdminSession[]>([]);
const loading = ref(true);
const running = ref(false);
const workspaceIds = ref<string[]>([]);
const status = ref<'all' | 'open' | 'done'>('all');
const updatedDays = ref('all');
const query = ref('');
const page = ref(1);
const pageSize = ref('20');
const selected = ref(new Set<string>());

const statusOptions = computed(() => [
  { value: 'all', label: t('admin.statusAll') },
  { value: 'open', label: t('admin.statusOpen') },
  { value: 'done', label: t('admin.statusDone') },
]);
const timeOptions = computed(() => [
  { value: 'all', label: t('admin.timeAll') },
  ...[3, 7, 30].map((days) => ({ value: String(days), label: t('admin.timeDaysAgo', { n: days }) })),
]);
const pageSizeOptions = computed(() => [10, 20, 50, 100].map((size) => ({
  value: String(size), label: t('admin.pageSize', { n: size }),
})));
const workspaceOptions = computed(() => props.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })));
const allSessions = computed(() => {
  const byId = new Map<string, AdminSession>();
  for (const item of [...props.openSessions, ...archivedSessions.value]) byId.set(item.id, item);
  return [...byId.values()];
});
const filtered = computed(() => filterAdminSessions(allSessions.value, {
  workspaceIds: workspaceIds.value,
  status: status.value,
  updatedDays: updatedDays.value === 'all' ? null : Number(updatedDays.value),
  query: query.value,
}));
const paged = computed(() => pageAdminSessions(filtered.value, page.value, Number(pageSize.value)));
const pageItems = computed(() => paged.value.items);
const pageAllSelected = computed(() => pageItems.value.length > 0 && pageItems.value.every((item) => selected.value.has(item.id)));
const allMatchingSelected = computed(() => filtered.value.length > 0 && filtered.value.every((item) => selected.value.has(item.id)));
const selectedItems = computed(() => allSessions.value.filter((item) => selected.value.has(item.id)));
const selectedOpen = computed(() => selectedItems.value.filter((item) => !item.archived));
const selectedDone = computed(() => selectedItems.value.filter((item) => item.archived));

async function refreshArchived(): Promise<void> {
  loading.value = true;
  try {
    archivedSessions.value = await props.loadArchived();
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  workspaceIds.value = [];
  status.value = 'all';
  updatedDays.value = 'all';
  query.value = '';
}

function togglePage(): void {
  selected.value = togglePageSelection(selected.value, pageItems.value);
}

function toggleRow(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectAllMatching(): void {
  selected.value = new Set(filtered.value.map((item) => item.id));
}

async function runAction(items: AdminSession[], action: 'archive' | 'restore'): Promise<void> {
  if (running.value || items.length === 0) return;
  running.value = true;
  try {
    for (const item of items) {
      if (action === 'archive') await props.archiveSession(item.id);
      else await props.restoreSession(item.id);
    }
    selected.value = new Set();
    await refreshArchived();
  } finally {
    running.value = false;
  }
}

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

watch([workspaceIds, status, updatedDays, query, pageSize], () => { page.value = 1; }, { deep: true });
watch(() => paged.value.page, (value) => { page.value = value; });
onMounted(refreshArchived);
</script>

<template>
  <section class="session-admin">
    <header class="session-admin__header">
      <IconButton size="sm" :label="t('admin.back')" @click="emit('back')"><Icon class="session-admin__back-icon" name="chevron-right" /></IconButton>
      <div>
        <h1>{{ t('admin.title') }}</h1>
        <p>{{ t('admin.subtitle') }}</p>
      </div>
    </header>

    <main class="session-admin__body">
      <div class="session-admin__filters">
        <MultiSelectMenu
          v-model="workspaceIds"
          :label="t('admin.filterWorkspace')"
          :options="workspaceOptions"
          :all-label="t('admin.allWorkspaces')"
          :search-placeholder="t('admin.searchWorkspace')"
          :select-all-label="t('admin.selectAll')"
          :empty-label="t('admin.noWorkspaceMatch')"
        />
        <FilterSelect v-model="status" :label="t('admin.filterStatus')" :options="statusOptions" />
        <FilterSelect v-model="updatedDays" :label="t('admin.filterTime')" :options="timeOptions" />
        <Input v-model="query" size="sm" class="session-admin__query" :placeholder="t('admin.queryPlaceholder')" />
        <Button size="sm" variant="ghost" @click="reset">{{ t('admin.reset') }}</Button>
      </div>

      <div v-if="selected.size > 0" class="session-admin__batch">
        <strong>{{ t('admin.batchSelected', { n: selected.size }) }}</strong>
        <Button v-if="!allMatchingSelected" size="sm" variant="ghost" @click="selectAllMatching">
          {{ t('admin.selectAllMatching', { total: filtered.length }) }}
        </Button>
        <span v-else>{{ t('admin.allMatchingSelected', { n: selected.size }) }}</span>
        <Button size="sm" variant="secondary" :disabled="running || selectedOpen.length === 0" @click="runAction(selectedOpen, 'archive')">{{ t('admin.markDoneCount', { n: selectedOpen.length }) }}</Button>
        <Button size="sm" variant="secondary" :disabled="running || selectedDone.length === 0" @click="runAction(selectedDone, 'restore')">{{ t('admin.reopenCount', { n: selectedDone.length }) }}</Button>
        <Button size="sm" variant="ghost" :disabled="running" @click="selected = new Set()">{{ t('admin.clearSelection') }}</Button>
      </div>

      <div class="session-admin__table-wrap">
        <table v-if="pageItems.length > 0" class="session-admin__table">
          <thead>
            <tr>
              <th class="session-admin__check"><Checkbox :model-value="pageAllSelected" :disabled="running" @update:model-value="togglePage"><span class="session-admin__sr-only">{{ t('admin.selectPageAll') }}</span></Checkbox></th>
              <th>{{ t('admin.colStatus') }}</th><th>{{ t('admin.colTitle') }}</th><th>{{ t('admin.colWorkspace') }}</th>
              <th>{{ t('admin.colPrompt') }}</th><th>{{ t('admin.colUpdated') }}</th><th>{{ t('admin.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in pageItems" :key="item.id">
              <td><Checkbox :model-value="selected.has(item.id)" :disabled="running" @update:model-value="toggleRow(item.id)" /></td>
              <td><span class="session-admin__status" :class="{ done: item.archived }"><Icon :name="item.archived ? 'archive' : 'message'" size="sm" />{{ item.archived ? t('admin.statusDone') : t('admin.statusOpen') }}</span></td>
              <td class="session-admin__title" :title="item.title">{{ item.title }}</td>
              <td>{{ item.workspaceName }}</td>
              <td class="session-admin__prompt" :title="item.lastPrompt">{{ item.lastPrompt ?? '—' }}</td>
              <td class="session-admin__updated">{{ formatUpdated(item.updatedAt) }}</td>
              <td><Button size="sm" variant="ghost" :disabled="running" @click="runAction([item], item.archived ? 'restore' : 'archive')">{{ item.archived ? t('admin.reopen') : t('admin.markDone') }}</Button></td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="loading" class="session-admin__state"><Spinner size="lg" :label="t('admin.loading')" /></div>
        <EmptyState v-else :title="t('admin.empty')"><template #icon><Icon name="message" /></template></EmptyState>
      </div>

      <footer class="session-admin__pager">
        <span>{{ t('admin.total', { n: filtered.length }) }}</span>
        <div>
          <FilterSelect v-model="pageSize" :label="''" :aria-label="t('admin.pageSize', { n: pageSize })" :options="pageSizeOptions" />
          <IconButton size="sm" :label="t('admin.prevPage')" :disabled="page === 1" @click="page--"><Icon class="session-admin__back-icon" name="chevron-right" /></IconButton>
          <span>{{ page }} / {{ paged.pages }}</span>
          <IconButton size="sm" :label="t('admin.nextPage')" :disabled="page === paged.pages" @click="page++"><Icon name="chevron-right" /></IconButton>
        </div>
      </footer>
    </main>
  </section>
</template>

<style scoped>
.session-admin { grid-column: 3 / -1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--color-bg); color: var(--color-text); }
.session-admin__header { min-height: var(--panel-head-h); display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); border-bottom: 1px solid var(--color-line); }
.session-admin__header h1 { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-medium); }
.session-admin__header p { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--text-sm); }
.session-admin__body { width: min(100%, var(--p-table-max)); min-height: 0; margin: 0 auto; padding: var(--space-5); overflow: auto; }
.session-admin__filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); }
.session-admin__query { width: min(260px, 100%); }
.session-admin__batch { min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-line); border-bottom: 0; border-radius: var(--radius-md) var(--radius-md) 0 0; background: var(--color-surface); font-size: var(--text-sm); }
.session-admin__table-wrap { min-width: 0; overflow-x: auto; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
.session-admin__batch + .session-admin__table-wrap { border-radius: 0 0 var(--radius-md) var(--radius-md); }
.session-admin__table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.session-admin__table th, .session-admin__table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-line); text-align: left; vertical-align: middle; }
.session-admin__table th { background: var(--color-surface); color: var(--color-text-muted); font-weight: var(--weight-medium); white-space: nowrap; }
.session-admin__table tbody tr:hover { background: var(--color-hover); }
.session-admin__table tbody tr:last-child td { border-bottom: 0; }
.session-admin__check { width: 32px; }
.session-admin__back-icon { transform: rotate(180deg); }
.session-admin__status { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
.session-admin__status.done { color: var(--color-success); }
.session-admin__title, .session-admin__prompt { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.session-admin__updated { white-space: nowrap; color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--text-xs); }
.session-admin__state { min-height: 220px; display: grid; place-items: center; }
.session-admin__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.session-admin__pager { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding-top: var(--space-3); color: var(--color-text-muted); font-size: var(--text-sm); }
.session-admin__pager > div { display: flex; align-items: center; gap: var(--space-2); }
@media (max-width: 640px) { .session-admin { grid-column: 1; } .session-admin__body { padding: var(--space-3); } .session-admin__header { padding: var(--space-3); } }
</style>
