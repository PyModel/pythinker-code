<!-- apps/pythinker-web/src/components/settings/ProvidersPanel.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppCatalogProvider, AppProvider } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Icon from '../ui/Icon.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';
import Spinner from '../ui/Spinner.vue';
import Tooltip from '../ui/Tooltip.vue';

const { t } = useI18n();
const { confirm } = useConfirmDialog();

const { discardToken = 0 } = defineProps<{ discardToken?: number }>();
const emit = defineEmits<{ dirtyChange: [dirty: boolean] }>();

const providers = ref<AppProvider[]>([]);
const loading = ref(false);
const unavailable = ref(false);
const expandedProviderIds = ref(new Set<string>());

const showAddForm = ref(false);
const addForm = reactive({ catalogId: '', apiKey: '', baseUrl: '' });
const addError = ref('');
const adding = ref(false);
const catalogProviders = ref<AppCatalogProvider[]>([]);
const catalogLoading = ref(false);
const availableCatalogProviders = computed(() =>
  catalogProviders.value.filter((provider) => !provider.rejected && provider.models.length > 0),
);
const selectedCatalogProvider = computed(() =>
  availableCatalogProviders.value.find((provider) => provider.id === addForm.catalogId),
);
const dirty = computed(
  () => showAddForm.value && (addForm.apiKey.trim() !== '' || addForm.baseUrl.trim() !== ''),
);

watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });
watch(
  availableCatalogProviders,
  (items) => {
    if (!items.some((provider) => provider.id === addForm.catalogId)) {
      addForm.catalogId = items[0]?.id ?? '';
    }
  },
  { immediate: true },
);
watch(() => discardToken, resetAddForm);

async function loadProviders(): Promise<void> {
  loading.value = true;
  unavailable.value = false;
  try {
    providers.value = await getPythinkerWebApi().listProviders();
  } catch {
    providers.value = [];
    unavailable.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadCatalogProviders(): Promise<void> {
  catalogLoading.value = true;
  try {
    catalogProviders.value = await getPythinkerWebApi().listCatalogProviders();
  } catch {
    catalogProviders.value = [];
  } finally {
    catalogLoading.value = false;
  }
}

function openAdd(): void {
  resetAddForm();
  showAddForm.value = true;
}

function resetAddForm(): void {
  showAddForm.value = false;
  addForm.catalogId = availableCatalogProviders.value[0]?.id ?? '';
  addForm.apiKey = '';
  addForm.baseUrl = '';
  addError.value = '';
}

async function submitAdd(): Promise<void> {
  const selected = selectedCatalogProvider.value;
  if (selected === undefined) {
    addError.value = t('providers.unavailable');
    return;
  }
  if (selected.needsBaseUrl && !addForm.baseUrl.trim()) {
    addError.value = t('providers.baseUrlRequired');
    return;
  }
  adding.value = true;
  addError.value = '';
  try {
    await getPythinkerWebApi().addProvider({
      type: addForm.catalogId,
      apiKey: addForm.apiKey.trim() || undefined,
      baseUrl: addForm.baseUrl.trim() || undefined,
    });
    resetAddForm();
    await loadProviders();
  } catch {
    addError.value = t('providers.addFailed');
  } finally {
    adding.value = false;
  }
}

function toggleModels(id: string): void {
  const next = new Set(expandedProviderIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedProviderIds.value = next;
}

async function deleteProvider(provider: AppProvider): Promise<void> {
  await confirm({
    title: t('providers.deleteProvider'),
    message: t('providers.deleteConfirm', {
      id: provider.id,
      count: provider.models?.length ?? 0,
    }),
    confirmLabel: t('providers.deleteConfirmYes'),
    cancelLabel: t('common.cancel'),
    variant: 'danger',
    action: async () => {
      await getPythinkerWebApi().deleteProvider(provider.id);
      await loadProviders();
    },
  });
}

function statusLabel(status: AppProvider['status']): string {
  return t(`providers.status.${status}`);
}

onMounted(() => {
  void Promise.all([loadProviders(), loadCatalogProviders()]);
});
</script>

<template>
  <section class="providers-panel">
    <div class="panel-heading">
      <div>
        <h3 class="panel-title">{{ t('providers.title') }}</h3>
        <p class="panel-description">{{ t('providers.description') }}</p>
      </div>
      <Button v-if="!unavailable && !showAddForm" variant="primary" size="sm" @click="openAdd">
        <Icon name="plus" size="sm" />
        {{ t('providers.addProvider') }}
      </Button>
    </div>

    <div v-if="loading" class="state-row">
      <Spinner size="sm" />
      <span>{{ t('providers.loading') }}</span>
    </div>
    <div v-else-if="unavailable" class="state-row state-row--warning">
      <Icon name="alert-triangle" size="md" />
      <span>{{ t('providers.unavailable') }}</span>
    </div>
    <div v-else-if="providers.length === 0" class="state-row">{{ t('providers.empty') }}</div>
    <div v-else class="provider-list">
      <section v-for="provider in providers" :key="provider.id" class="provider-card">
        <div class="provider-row">
          <Tooltip :text="statusLabel(provider.status)">
            <span class="status-dot" :class="`status-dot--${provider.status}`" />
          </Tooltip>
          <button
            type="button"
            class="provider-summary"
            :data-testid="`provider-${provider.id}-toggle`"
            :aria-expanded="expandedProviderIds.has(provider.id)"
            @click="toggleModels(provider.id)"
          >
            <span class="provider-name">{{ provider.type }}</span>
            <span class="provider-detail">{{ provider.baseUrl || provider.id }}</span>
            <span class="provider-meta">
              <Badge :variant="provider.hasApiKey ? 'success' : 'neutral'" size="sm">
                {{ provider.hasApiKey ? t('providers.keySet') : t('providers.keyNotSet') }}
              </Badge>
              {{ t('providers.modelCount', { count: provider.models?.length ?? 0 }) }}
            </span>
          </button>
          <Button
            variant="danger-soft"
            size="sm"
            :data-testid="`provider-${provider.id}-delete`"
            @click="deleteProvider(provider)"
          >
            {{ t('providers.delete') }}
          </Button>
        </div>

        <div v-if="expandedProviderIds.has(provider.id)" class="models-table">
          <div class="models-head">
            <span>{{ t('providers.colModelId') }}</span>
            <span>{{ t('providers.colDisplayName') }}</span>
          </div>
          <div v-if="!provider.models?.length" class="model-empty">{{ t('providers.noModels') }}</div>
          <div v-for="model in provider.models ?? []" :key="model" class="model-row">
            <span>{{ model }}</span>
            <span>{{ model }}</span>
          </div>
        </div>
      </section>
    </div>

    <div v-if="showAddForm" class="add-form">
      <Field :label="t('providers.fieldType')">
        <Select v-model="addForm.catalogId" :disabled="catalogLoading || availableCatalogProviders.length === 0">
          <option v-if="catalogLoading" value="">{{ t('providers.catalogLoading') }}</option>
          <option v-else-if="availableCatalogProviders.length === 0" value="">{{ t('providers.unavailable') }}</option>
          <option v-for="provider in availableCatalogProviders" :key="provider.id" :value="provider.id">
            {{ provider.name }} ({{ provider.id }})
          </option>
        </Select>
      </Field>
      <Field :label="t('providers.fieldApiKey')">
        <Input v-model="addForm.apiKey" type="password" autocomplete="off" spellcheck="false" />
      </Field>
      <Field :label="t('providers.fieldBaseUrl')">
        <Input
          v-model="addForm.baseUrl"
          :placeholder="t('providers.baseUrlPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
      </Field>
      <div v-if="addError" class="add-error">{{ addError }}</div>
      <div class="form-actions">
        <Button variant="primary" size="sm" :loading="adding" @click="submitAdd">{{ t('providers.add') }}</Button>
        <Button variant="secondary" size="sm" @click="resetAddForm">{{ t('common.cancel') }}</Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.providers-panel { padding: var(--space-4) 0; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); }
.panel-title { margin: 0; font-family: var(--font-ui); font-size: var(--text-xl); font-weight: var(--weight-medium); color: var(--color-text); }
.panel-description { margin: var(--space-1) 0 0; font-family: var(--font-ui); font-size: var(--text-sm); color: var(--color-text-muted); }
.state-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-5) 0; color: var(--color-text-muted); font-size: var(--text-base); }
.state-row--warning { color: var(--color-warning); }
.provider-list { display: flex; flex-direction: column; gap: var(--space-3); }
.provider-card { border: 1px solid var(--color-line); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-bg); }
.provider-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.status-dot { width: 8px; height: 8px; flex: none; border-radius: var(--radius-full); border: 1px solid var(--color-text-faint); }
.status-dot--connected { border-color: var(--color-success); background: var(--color-success); }
.status-dot--error { border-color: var(--color-danger); background: var(--color-danger); }
.provider-summary { display: flex; flex: 1; min-width: 0; flex-direction: column; align-items: flex-start; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.provider-summary:focus-visible { outline: none; box-shadow: var(--p-focus-ring); border-radius: var(--radius-sm); }
.provider-name { font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--color-text); }
.provider-detail { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-muted); }
.provider-meta { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--color-text-muted); }
.models-table { border-top: 1px solid var(--color-line); background: var(--color-surface-sunken); }
.models-head, .model-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); padding: var(--space-2) var(--space-4); }
.models-head { font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--color-text-muted); }
.model-row { border-top: 1px solid var(--color-line); font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text); }
.model-row span { min-width: 0; overflow-wrap: anywhere; }
.model-empty { padding: var(--space-3) var(--space-4); color: var(--color-text-muted); font-size: var(--text-sm); }
.add-form { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-line); }
.add-error { color: var(--color-danger); font-size: var(--text-sm); }
.form-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 640px) {
  .panel-heading, .provider-row { align-items: stretch; flex-direction: column; }
  .status-dot { display: none; }
}
</style>
