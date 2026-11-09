<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppCatalogProvider, AppConfig } from '../../api/types';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Input from '../ui/Input.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import Spinner from '../ui/Spinner.vue';
import ProviderForm from './ProviderForm.vue';

const props = defineProps<{ config?: AppConfig | null; initialSource?: 'catalog' | 'registry' | 'manual' }>();
const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  added: [providerId: string];
  cancel: [];
}>();
const { t } = useI18n();

const source = ref<'catalog' | 'registry' | 'manual'>(props.initialSource ?? 'catalog');
const sourceOptions = computed(() => [
  { value: 'catalog', label: t('providers.catalog.sourceCatalog') },
  { value: 'registry', label: t('providers.catalog.sourceRegistry') },
  { value: 'manual', label: t('providers.catalog.sourceManual') },
]);
const catalog = ref<AppCatalogProvider[]>([]);
const catalogState = ref<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
const query = ref('');
const selected = ref<AppCatalogProvider | null>(null);
const catalogForm = reactive({ id: '', apiKey: '', baseUrl: '' });
const catalogError = ref('');
const importing = ref(false);
const showCatalogKey = ref(false);
const registryForm = reactive({ url: '', apiKey: '' });
const registryError = ref('');
const importingRegistry = ref(false);
const showRegistryKey = ref(false);

const filteredCatalog = computed(() => {
  const value = query.value.trim().toLowerCase();
  return value === ''
    ? catalog.value
    : catalog.value.filter((provider) =>
        provider.name.toLowerCase().includes(value) || provider.id.toLowerCase().includes(value));
});
const providerExists = computed(() =>
  Object.hasOwn(props.config?.providers ?? {}, catalogForm.id.trim()),
);

async function loadCatalog(): Promise<void> {
  catalogState.value = 'loading';
  try {
    catalog.value = await getPythinkerWebApi().listCatalogProviders();
    catalogState.value = 'ready';
    const available = catalog.value.filter((provider) => !provider.rejected);
    if (available.length === 1 && selected.value === null) selectProvider(available[0]!);
  } catch {
    catalogState.value = 'error';
  }
}

function rejectReason(provider: AppCatalogProvider): string {
  const key = provider.rejectReason === null ? '' : `providers.catalog.rejectReason.${provider.rejectReason}`;
  return key !== '' && t(key) !== key ? t(key) : t('providers.catalog.rejected');
}

function selectProvider(provider: AppCatalogProvider): void {
  if (provider.rejected) return;
  selected.value = provider;
  catalogForm.id = provider.id;
  catalogForm.apiKey = '';
  catalogForm.baseUrl = '';
  catalogError.value = '';
}

function markDirty(): void {
  emit('dirtyChange', true);
}

async function importCatalogProvider(): Promise<void> {
  const provider = selected.value;
  if (provider === null || importing.value) return;
  const id = catalogForm.id.trim();
  if (id === '') {
    catalogError.value = t('providers.error.idRequired');
    return;
  }
  if (catalogForm.apiKey.trim() === '') {
    catalogError.value = t('providers.error.apiKeyRequired');
    return;
  }
  if (provider.needsBaseUrl && catalogForm.baseUrl.trim() === '') {
    catalogError.value = t('providers.error.baseUrlRequired');
    return;
  }
  importing.value = true;
  catalogError.value = '';
  try {
    await getPythinkerWebApi().importCatalogProvider({
      catalogId: provider.id,
      id: id === provider.id ? undefined : id,
      apiKey: catalogForm.apiKey.trim(),
      baseUrl: catalogForm.baseUrl.trim() || undefined,
    });
    emit('dirtyChange', false);
    emit('added', id);
  } catch {
    catalogError.value = t('providers.addFailed');
  } finally {
    importing.value = false;
  }
}

async function importRegistry(): Promise<void> {
  if (importingRegistry.value) return;
  const url = registryForm.url.trim();
  if (url === '') {
    registryError.value = t('providers.error.registryUrlRequired');
    return;
  }
  importingRegistry.value = true;
  registryError.value = '';
  try {
    const result = await getPythinkerWebApi().importCustomRegistry({
      url,
      apiKey: registryForm.apiKey.trim() || undefined,
    });
    emit('dirtyChange', false);
    const first = result.providers[0];
    if (first === undefined) emit('cancel');
    else emit('added', first.id);
  } catch {
    registryError.value = t('providers.addFailed');
  } finally {
    importingRegistry.value = false;
  }
}

onMounted(loadCatalog);
</script>

<template>
  <div class="add-provider-flow">
    <SegmentedControl v-model="source" size="sm" :options="sourceOptions" />

    <section v-if="source === 'catalog'" class="add-provider-flow__section">
      <div v-if="catalogState === 'loading'" class="add-provider-flow__state"><Spinner size="sm" />{{ t('providers.catalog.loading') }}</div>
      <div v-else-if="catalogState === 'error'" class="add-provider-flow__state">
        <span>{{ t('providers.catalog.loadError') }}</span>
        <Button size="sm" variant="secondary" @click="loadCatalog">{{ t('providers.catalog.retry') }}</Button>
      </div>
      <template v-else-if="selected === null">
        <Input v-model="query" :placeholder="t('providers.catalog.searchPlaceholder')" autocomplete="off" />
        <div class="add-provider-flow__catalog">
          <button
            v-for="provider in filteredCatalog"
            :key="provider.id"
            type="button"
            class="add-provider-flow__entry"
            :disabled="provider.rejected"
            @click="selectProvider(provider)"
          >
            <span class="add-provider-flow__name">{{ provider.name }}</span>
            <Badge v-if="provider.wireType" size="sm" variant="neutral">{{ provider.wireType }}</Badge>
            <span class="add-provider-flow__grow" />
            <span>{{ provider.rejected ? rejectReason(provider) : t('providers.modelCount', { count: provider.models.length }) }}</span>
          </button>
          <div v-if="filteredCatalog.length === 0" class="add-provider-flow__empty">{{ t('providers.catalog.empty') }}</div>
        </div>
      </template>
      <form v-else class="add-provider-flow__form" @submit.prevent="importCatalogProvider" @input="markDirty">
        <button type="button" class="add-provider-flow__back" @click="selected = null">
          <Icon class="add-provider-flow__back-icon" name="chevron-right" size="sm" />{{ t('providers.catalog.backToList') }}
        </button>
        <Field :label="t('providers.fieldId')"><Input v-model="catalogForm.id" autocomplete="off" /></Field>
        <Field :label="t('providers.fieldApiKey')">
          <div class="add-provider-flow__key">
            <Input v-model="catalogForm.apiKey" :type="showCatalogKey ? 'text' : 'password'" autocomplete="off" />
            <IconButton class="add-provider-flow__eye" size="sm" :label="showCatalogKey ? t('providers.hideApiKey') : t('providers.showApiKey')" @click="showCatalogKey = !showCatalogKey"><Icon :name="showCatalogKey ? 'eye-off' : 'eye'" size="sm" /></IconButton>
          </div>
        </Field>
        <Field v-if="selected.needsBaseUrl" :label="t('providers.fieldBaseUrl')"><Input v-model="catalogForm.baseUrl" :placeholder="t('providers.baseUrlPlaceholder')" /></Field>
        <div v-if="providerExists" class="add-provider-flow__warning">{{ t('providers.catalog.overwriteWarning') }}</div>
        <div class="add-provider-flow__note">{{ t('providers.catalog.willImport', { count: selected.models.length }) }}</div>
        <div v-if="catalogError" class="add-provider-flow__error" role="alert">{{ catalogError }}</div>
        <div class="add-provider-flow__actions">
          <Button type="button" variant="secondary" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
          <Button type="submit" variant="primary" :loading="importing">{{ t('providers.catalog.importAction') }}</Button>
        </div>
      </form>
    </section>

    <form v-else-if="source === 'registry'" class="add-provider-flow__section add-provider-flow__form" @submit.prevent="importRegistry" @input="markDirty">
      <p class="add-provider-flow__note">{{ t('providers.catalog.registryHint') }}</p>
      <Field :label="t('providers.catalog.registryUrlLabel')"><Input v-model="registryForm.url" placeholder="https://example.com/api.json" autocomplete="off" /></Field>
      <Field :label="t('providers.fieldApiKey')">
        <div class="add-provider-flow__key">
          <Input v-model="registryForm.apiKey" :type="showRegistryKey ? 'text' : 'password'" autocomplete="off" />
          <IconButton class="add-provider-flow__eye" size="sm" :label="showRegistryKey ? t('providers.hideApiKey') : t('providers.showApiKey')" @click="showRegistryKey = !showRegistryKey"><Icon :name="showRegistryKey ? 'eye-off' : 'eye'" size="sm" /></IconButton>
        </div>
      </Field>
      <div v-if="registryError" class="add-provider-flow__error" role="alert">{{ registryError }}</div>
      <div class="add-provider-flow__actions">
        <Button type="button" variant="secondary" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button type="submit" variant="primary" :loading="importingRegistry">{{ t('providers.catalog.importAction') }}</Button>
      </div>
    </form>

    <div v-else class="add-provider-flow__section">
      <ProviderForm mode="add" :config="config" @dirty-change="emit('dirtyChange', $event)" @saved="emit('added', $event)" @cancel="emit('cancel')" />
    </div>
  </div>
</template>

<style scoped>
.add-provider-flow { display: flex; flex-direction: column; gap: var(--space-4); }
.add-provider-flow__section, .add-provider-flow__form { display: flex; flex-direction: column; gap: var(--space-3); }
.add-provider-flow__state { display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-muted); }
.add-provider-flow__catalog { max-height: 320px; overflow-y: auto; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
.add-provider-flow__entry { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 36px; padding: var(--space-2) var(--space-3); border: 0; border-top: 1px solid var(--color-line); background: transparent; color: var(--color-text); text-align: left; cursor: pointer; }
.add-provider-flow__entry:first-child { border-top: 0; }
.add-provider-flow__entry:hover:not(:disabled) { background: var(--color-hover); }
.add-provider-flow__entry:disabled { opacity: 0.55; cursor: not-allowed; }
.add-provider-flow__entry > span:last-child { color: var(--color-text-faint); font-size: var(--text-xs); }
.add-provider-flow__name { font-weight: var(--weight-medium); }
.add-provider-flow__grow { flex: 1; }
.add-provider-flow__empty { padding: var(--space-4); color: var(--color-text-muted); text-align: center; }
.add-provider-flow__back { align-self: flex-start; display: inline-flex; align-items: center; gap: var(--space-1); padding: 0; border: 0; background: transparent; color: var(--color-text-muted); cursor: pointer; }
.add-provider-flow__back-icon { transform: rotate(180deg); }
.add-provider-flow__key { position: relative; }
.add-provider-flow__key :deep(.ui-input) { padding-right: calc(var(--p-ic-sm) + var(--space-3)); }
.add-provider-flow__eye { position: absolute; top: 50%; right: var(--space-1); transform: translateY(-50%); }
.add-provider-flow__note { margin: 0; color: var(--color-text-muted); font-size: var(--text-sm); }
.add-provider-flow__warning { color: var(--color-warning); font-size: var(--text-sm); }
.add-provider-flow__error { color: var(--color-danger); font-size: var(--text-sm); }
.add-provider-flow__actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
</style>
