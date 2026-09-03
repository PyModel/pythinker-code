<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import type { AppConfig, AppModel, AppProvider } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Badge from '../ui/Badge.vue';
import Banner from '../ui/Banner.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Skeleton from '../ui/Skeleton.vue';
import Tooltip from '../ui/Tooltip.vue';
import AddProviderFlow from './AddProviderFlow.vue';
import ProviderForm from './ProviderForm.vue';

const { discardToken = 0 } = defineProps<{ discardToken?: number }>();
const emit = defineEmits<{ dirtyChange: [dirty: boolean] }>();
const { t } = useI18n();
const { confirm } = useConfirmDialog();
const client = usePythinkerWebClient();

const providers = ref<AppProvider[]>([]);
const config = ref<AppConfig | null>(null);
const catalogModels = ref<AppModel[]>([]);
// The config section only holds user-written model rows; the catalog knows
// every model (imported ones included) with its real context size, so the
// edit form merges both and user rows win.
const formConfig = computed<AppConfig | null>(() => {
  if (config.value === null) return null;
  const models: NonNullable<AppConfig['models']> = {};
  for (const model of catalogModels.value) models[model.id] = model;
  Object.assign(models, config.value.models ?? {});
  return { ...config.value, models };
});
const loading = ref(false);
const unavailable = ref(false);
const selectedId = ref<string | null>(null);
const dirty = ref(false);

const ADD_ID = '$add';

const sortedProviders = computed(() => providers.value.toSorted((a, b) => a.id.localeCompare(b.id)));
const adding = computed(() => selectedId.value === ADD_ID);
const selected = computed(() => sortedProviders.value.find((p) => p.id === selectedId.value) ?? null);

function statusKind(status: AppProvider['status']): 'ok' | 'error' | 'idle' {
  if (status === 'connected') return 'ok';
  if (status === 'error') return 'error';
  return 'idle';
}

function typeInitial(type: string): string {
  return (type.trim()[0] ?? '?').toUpperCase();
}

watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });
watch(() => discardToken, () => {
  dirty.value = false;
  selectedId.value = sortedProviders.value[0]?.id ?? null;
});

// Every provider mutation reconciles the app's own runtime state before this
// panel refreshes its local view. Without it a fresh install stays on the setup
// screen after adding a working provider: the daemon is ready, but nothing told
// the app to re-read /auth, so the gate never clears until a reload.
async function reconcileAndLoad(): Promise<void> {
  await client.refreshRuntimeState();
  await load();
}

async function load(): Promise<void> {
  loading.value = true;
  unavailable.value = false;
  try {
    providers.value = await getPythinkerWebApi().listProviders();
    if (!sortedProviders.value.some((p) => p.id === selectedId.value)) {
      selectedId.value = sortedProviders.value[0]?.id ?? null;
    }
  } catch {
    providers.value = [];
    unavailable.value = true;
  }
  try {
    const [nextConfig, nextModels] = await Promise.all([
      getPythinkerWebApi().getConfig(),
      getPythinkerWebApi().listModels().catch((): AppModel[] => []),
    ]);
    config.value = nextConfig;
    catalogModels.value = nextModels;
  } catch {
    config.value = null;
    catalogModels.value = [];
  } finally {
    loading.value = false;
  }
}

function select(id: string): void {
  if (dirty.value) return;
  selectedId.value = id;
}

async function saved(id: string): Promise<void> {
  dirty.value = false;
  await reconcileAndLoad();
  selectedId.value = id;
}

async function deleteProvider(provider: AppProvider): Promise<void> {
  await confirm({
    title: t('providers.deleteProvider'),
    message: t('providers.deleteConfirm', { id: provider.id, count: provider.models?.length ?? 0 }),
    confirmLabel: t('providers.deleteConfirmYes'),
    cancelLabel: t('common.cancel'),
    variant: 'danger',
    action: async () => {
      await getPythinkerWebApi().deleteProvider(provider.id);
      selectedId.value = null;
      dirty.value = false;
      await reconcileAndLoad();
    },
  });
}

onMounted(load);
</script>

<template>
  <section class="providers-panel">
    <div class="providers-panel__heading">
      <div>
        <h3>{{ t('providers.title') }}</h3>
        <p>{{ t('providers.description') }}</p>
      </div>
      <IconButton v-if="!loading && !unavailable" size="sm" :label="t('providers.refresh')" data-testid="providers-refresh" @click="reconcileAndLoad()">
        <Icon name="undo" size="sm" />
      </IconButton>
    </div>

    <Banner v-if="unavailable" variant="warning">{{ t('providers.unavailable') }}</Banner>

    <div v-else class="providers-panel__split">
      <nav class="providers-panel__list" :aria-label="t('providers.title')">
        <div class="providers-pane-label">{{ t('settings.tabs.providers') }}</div>
        <template v-if="loading">
          <div v-for="i in 3" :key="i" class="providers-panel__row providers-panel__row--skeleton" role="status" :aria-label="t('providers.loading')">
            <Skeleton width="26px" height="26px" circle />
            <Skeleton :width="`${52 - i * 6}%`" height="11px" />
          </div>
        </template>
        <template v-else>
          <div
            v-for="provider in sortedProviders"
            :key="provider.id"
            class="providers-panel__item"
            :class="{ 'is-selected': selectedId === provider.id }"
          >
            <button
              type="button"
              class="providers-panel__row"
              :data-testid="`provider-${provider.id}-toggle`"
              :aria-current="selectedId === provider.id"
              @click="select(provider.id)"
            >
              <Tooltip :text="t(`providers.status.${provider.status}`)">
                <span class="providers-panel__tile" :class="`is-${statusKind(provider.status)}`" role="img" :aria-label="t(`providers.status.${provider.status}`)">
                  <span aria-hidden="true">{{ typeInitial(provider.type) }}</span>
                </span>
              </Tooltip>
              <span class="providers-panel__row-name">{{ provider.id }}</span>
              <span class="providers-panel__row-dot" :class="`is-${statusKind(provider.status)}`" aria-hidden="true" />
            </button>
            <IconButton
              class="providers-panel__row-delete"
              size="sm"
              :label="t('providers.deleteTitle', { type: provider.id })"
              :data-testid="`provider-${provider.id}-delete`"
              @click.stop="deleteProvider(provider)"
            >
              <Icon name="trash" size="sm" />
            </IconButton>
          </div>

          <div class="providers-pane-label">{{ t('providers.customProviders') }}</div>
          <button
            type="button"
            class="providers-panel__row providers-panel__row--add"
            :class="{ 'is-selected': adding }"
            :aria-current="adding"
            @click="select(ADD_ID)"
          >
            <span class="providers-panel__add-icon"><Icon name="plus" size="sm" /></span>
            <span class="providers-panel__row-name">{{ t('providers.addProvider') }}</span>
          </button>
        </template>
      </nav>

      <div class="providers-panel__detail">
        <template v-if="adding">
          <AddProviderFlow :config="config" @dirty-change="dirty = $event" @added="saved" @cancel="selectedId = sortedProviders[0]?.id ?? null; dirty = false" />
        </template>

        <template v-else-if="selected">
          <header class="providers-detail__head">
            <span class="providers-detail__tile" aria-hidden="true">{{ typeInitial(selected.type) }}</span>
            <div class="providers-detail__identity">
              <div class="providers-detail__name-row">
                <h4>{{ selected.id }}</h4>
                <Badge :variant="selected.status === 'connected' ? 'success' : selected.status === 'error' ? 'danger' : 'neutral'" size="md">
                  {{ t(`providers.status.${selected.status}`) }}
                </Badge>
              </div>
              <p class="providers-detail__meta">
                <span>{{ selected.type }}</span>
                <template v-if="selected.baseUrl"><span aria-hidden="true">·</span><span class="mono">{{ selected.baseUrl }}</span></template>
              </p>
            </div>
          </header>

          <ProviderForm :key="selected.id" mode="edit" :provider="selected" :config="formConfig" @dirty-change="dirty = $event" @saved="saved" @cancel="selectedId = sortedProviders[0]?.id ?? null; dirty = false" />
        </template>

        <EmptyState v-else-if="providers.length === 0 && !loading" :title="t('providers.empty')" :hint="t('providers.emptyHint')">
          <template #icon><Icon name="bolt" /></template>
        </EmptyState>
      </div>
    </div>
  </section>
</template>

<style scoped>
.providers-panel { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) 0; }
.providers-panel__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.providers-panel__heading h3 { margin: 0; color: var(--color-text); font-size: var(--text-xl); font-weight: var(--weight-medium); }
.providers-panel__heading p { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--text-sm); }

.providers-pane-label {
  padding: 0 var(--space-2);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.providers-panel__split {
  display: grid;
  grid-template-columns: minmax(170px, 216px) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.providers-panel__list { display: flex; flex-direction: column; gap: var(--space-1); }
.providers-panel__list .providers-pane-label:not(:first-child) { margin-top: var(--space-3); }

.providers-panel__item { display: flex; align-items: center; gap: var(--space-1); border-radius: var(--radius-md); }
.providers-panel__item:hover { background: var(--color-hover); }
.providers-panel__item.is-selected { background: var(--color-selected); }
.providers-panel__item .providers-panel__row { min-width: 0; flex: 1; }
.providers-panel__item .providers-panel__row:hover,
.providers-panel__item.is-selected .providers-panel__row { background: transparent; }
.providers-panel__row-delete { margin-right: var(--space-1); color: var(--color-danger); opacity: 0.55; }
.providers-panel__item:hover .providers-panel__row-delete,
.providers-panel__item.is-selected .providers-panel__row-delete,
.providers-panel__row-delete:focus-visible { opacity: 1; }
.providers-panel__row-delete:hover:not(:disabled) { background: color-mix(in srgb, var(--color-danger) 14%, transparent); color: var(--color-danger); }

.providers-panel__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px;
  padding: var(--space-1-5) var(--space-2);
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}
.providers-panel__row:hover { background: var(--color-hover); }
.providers-panel__row:focus-visible { outline: none; box-shadow: inset var(--p-focus-ring); }
.providers-panel__row.is-selected { background: var(--color-selected); }
.providers-panel__row-name { overflow: hidden; flex: 1; font-size: var(--text-base); font-weight: var(--weight-medium); text-overflow: ellipsis; white-space: nowrap; }
.providers-panel__row-dot { width: 7px; height: 7px; flex: none; border-radius: var(--radius-full); background: var(--color-text-faint); }
.providers-panel__row-dot.is-ok { background: var(--color-success); }
.providers-panel__row-dot.is-error { background: var(--color-danger); }

.providers-panel__tile {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: var(--radius-md);
  background: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  line-height: 1;
}
.providers-panel__tile.is-ok { color: var(--color-success); }
.providers-panel__tile.is-error { color: var(--color-danger); }

.providers-panel__add-icon { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border: 1px dashed var(--color-line-strong); border-radius: var(--radius-md); color: var(--color-text-muted); }
.providers-panel__row--add .providers-panel__row-name { color: var(--color-text-muted); font-weight: var(--weight-regular); }
.providers-panel__row--add:hover .providers-panel__row-name,
.providers-panel__row--add.is-selected .providers-panel__row-name { color: var(--color-text); }
.providers-panel__row--add.is-selected .providers-panel__add-icon { border-style: solid; border-color: var(--color-accent-bd); color: var(--color-accent); }

.providers-panel__row--skeleton { gap: var(--space-2); }

.providers-panel__detail { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; padding-top: var(--space-1); }

.providers-detail__head { display: flex; align-items: center; gap: var(--space-3); }
.providers-detail__tile {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: none;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: 1;
}
.providers-detail__identity { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.providers-detail__name-row { display: flex; align-items: center; gap: var(--space-2); }
.providers-detail__name-row h4 { margin: 0; overflow: hidden; color: var(--color-text); font-size: var(--text-lg); font-weight: var(--weight-medium); text-overflow: ellipsis; white-space: nowrap; }
.providers-detail__meta { display: flex; align-items: center; gap: var(--space-1-5); overflow: hidden; margin: 0; color: var(--color-text-muted); font-size: var(--text-xs); white-space: nowrap; }
.providers-detail__meta .mono { overflow: hidden; font-family: var(--font-mono); text-overflow: ellipsis; }

@media (max-width: 640px) {
  .providers-panel__split { grid-template-columns: 1fr; gap: var(--space-4); }
  .providers-panel__detail { padding-top: 0; }
}
</style>
