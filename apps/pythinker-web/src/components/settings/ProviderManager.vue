<!-- apps/pythinker-web/src/components/settings/ProviderManager.vue -->
<!-- Modal overlay for managing providers: list, add, refresh, delete. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppCatalogProvider, AppProvider } from '../../api/types';
import { useDialogFocus } from '../../composables/useDialogFocus';
import Dialog from '../ui/Dialog.vue';
import Button from '../ui/Button.vue';
import Badge from '../ui/Badge.vue';
import Spinner from '../ui/Spinner.vue';
import Field from '../ui/Field.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';
import Icon from '../ui/Icon.vue';
import Tooltip from '../ui/Tooltip.vue';

const { t } = useI18n();

const dialogRef = ref<HTMLElement | null>(null);
// Move focus into the dialog on open; restore it to the opener on close.
useDialogFocus(dialogRef);

const props = defineProps<{
  providers: AppProvider[];
  loading?: boolean;
  /** If true, providers could not be fetched (daemon 404 / unsupported) */
  unavailable?: boolean;
}>();

const emit = defineEmits<{
  add: [input: { type: string; apiKey?: string; baseUrl?: string; defaultModel?: string }];
  refresh: [id: string];
  delete: [id: string];
  close: [];
}>();

// -------------------------------------------------------------------------
// Delete confirmation
// -------------------------------------------------------------------------

// Delete — the modal confirm and the async delete live in App.vue
// (confirmDeleteProvider); the manager only emits the intent.
function onDeleteProvider(id: string): void {
  emit('delete', id);
}

// -------------------------------------------------------------------------
// Add-provider form
// -------------------------------------------------------------------------

const showAddForm = ref(false);
const addForm = reactive({
  catalogId: '',
  apiKey: '',
  baseUrl: '',
});
const addError = ref('');
const catalogProviders = ref<AppCatalogProvider[]>([]);
const catalogLoading = ref(false);
const availableCatalogProviders = computed(() =>
  catalogProviders.value.filter((provider) => !provider.rejected && provider.models.length > 0),
);
const selectedCatalogProvider = computed(() =>
  availableCatalogProviders.value.find((provider) => provider.id === addForm.catalogId),
);

watch(
  availableCatalogProviders,
  (providers) => {
    if (!providers.some((provider) => provider.id === addForm.catalogId)) {
      addForm.catalogId = providers[0]?.id ?? '';
    }
  },
  { immediate: true },
);

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
  addForm.catalogId = availableCatalogProviders.value[0]?.id ?? '';
  addForm.apiKey = '';
  addForm.baseUrl = '';
  addError.value = '';
  showAddForm.value = true;
  if (catalogProviders.value.length === 0 && !catalogLoading.value) {
    void loadCatalogProviders();
  }
}
function cancelAdd(): void {
  showAddForm.value = false;
}
function submitAdd(): void {
  if (selectedCatalogProvider.value === undefined) {
    addError.value = t('providers.unavailable');
    return;
  }
  if (selectedCatalogProvider.value.needsBaseUrl && !addForm.baseUrl.trim()) {
    addError.value = `${t('providers.fieldBaseUrl')} is required`;
    return;
  }
  addError.value = '';
  emit('add', {
    type: addForm.catalogId,
    apiKey: addForm.apiKey.trim() || undefined,
    baseUrl: addForm.baseUrl.trim() || undefined,
  });
  showAddForm.value = false;
}

// -------------------------------------------------------------------------
// Keyboard — Esc closes
// -------------------------------------------------------------------------

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (showAddForm.value) { cancelAdd(); return; }
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  void loadCatalogProviders();
});
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

// -------------------------------------------------------------------------
// Status helpers
// -------------------------------------------------------------------------

function statusColor(status: AppProvider['status']): string {
  if (status === 'connected') return 'var(--color-success)';
  if (status === 'error') return 'var(--color-danger)';
  return 'var(--color-text-faint)';
}
function statusLabel(status: AppProvider['status']): string {
  if (status === 'connected') return t('providers.status.connected');
  if (status === 'error') return t('providers.status.error');
  return t('providers.status.unconfigured');
}
</script>

<template>
  <Dialog :open="true" :close-on-esc="false" :title="t('providers.title')" size="xl" height="fixed" @close="emit('close')">
    <div ref="dialogRef" class="pm">
      <!-- Provider list -->
      <div class="prov-list">
        <!-- Loading state -->
        <div v-if="loading" class="state-row">
          <Spinner size="sm" />
          <span>{{ t('providers.loading') }}</span>
        </div>
        <!-- Unavailable (daemon 404) -->
        <div v-else-if="unavailable" class="state-row unavail">
          <Icon name="alert-triangle" size="md" />
          <span>{{ t('providers.unavailable') }}</span>
        </div>
        <!-- Empty -->
        <div v-else-if="providers.length === 0" class="empty">{{ t('providers.empty') }}</div>
        <!-- Provider rows -->
        <template v-else>
          <div v-for="p in providers" :key="p.id" class="prov-row">
            <!-- Status dot -->
            <Tooltip :text="statusLabel(p.status)">
              <span
                class="status-dot"
                :class="{ 'status-dot--empty': p.status !== 'connected' && p.status !== 'error' }"
                :style="p.status === 'connected' || p.status === 'error' ? { background: statusColor(p.status) } : undefined"
              />
            </Tooltip>
            <div class="prov-info">
              <span class="prov-type">{{ p.type }}</span>
              <span v-if="p.baseUrl" class="prov-url">{{ p.baseUrl }}</span>
              <span class="prov-meta">
                <Badge :variant="p.hasApiKey ? 'success' : 'neutral'" size="sm">
                  {{ p.hasApiKey ? t('providers.keySet') : t('providers.keyNotSet') }}
                </Badge>
                <span v-if="p.models && p.models.length > 0"> · {{ t('providers.modelCount', { count: p.models.length }) }}</span>
              </span>
            </div>
            <!-- Actions -->
            <div class="prov-actions">
              <Tooltip :text="t('providers.refreshTitle', { type: p.type })">
                <Button variant="secondary" size="sm" @click="emit('refresh', p.id)">{{ t('providers.refresh') }}</Button>
              </Tooltip>
              <Tooltip :text="t('providers.deleteTitle', { type: p.type })">
                <Button variant="danger-soft" size="sm" @click="onDeleteProvider(p.id)">{{ t('providers.delete') }}</Button>
              </Tooltip>
            </div>
          </div>
        </template>
      </div>

      <!-- Add provider form / button -->
      <div v-if="!unavailable" class="add-section">
        <template v-if="!showAddForm">
          <div class="add-btns">
            <!-- No managed-account OAuth shortcuts: this distribution has no
                 managed service. Providers are added with API keys. -->
            <Button variant="primary" size="sm" @click="openAdd">
              <Icon name="plus" size="sm" />
              {{ t('providers.enterApiKey') }}
            </Button>
          </div>
        </template>
        <template v-else>
          <div class="add-form">
            <Field :label="t('providers.fieldType')">
              <Select
                v-model="addForm.catalogId"
                :disabled="catalogLoading || availableCatalogProviders.length === 0"
              >
                <option v-if="catalogLoading" value="">{{ t('providers.loading') }}</option>
                <option v-else-if="availableCatalogProviders.length === 0" value="">
                  {{ t('providers.unavailable') }}
                </option>
                <option
                  v-for="provider in availableCatalogProviders"
                  :key="provider.id"
                  :value="provider.id"
                >
                  {{ provider.name }} ({{ provider.id }})
                </option>
              </Select>
            </Field>
            <div v-if="selectedCatalogProvider" class="catalog-meta">
              <span>{{ selectedCatalogProvider.id }}</span>
              <span>· {{ t('providers.modelCount', { count: selectedCatalogProvider.models.length }) }}</span>
            </div>
            <Field :label="t('providers.fieldApiKey')">
              <Input
                v-model="addForm.apiKey"
                type="password"
                placeholder="sk-…"
                autocomplete="off"
                spellcheck="false"
              />
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
            <div class="form-btns">
              <Button variant="primary" size="sm" @click="submitAdd">{{ t('providers.add') }}</Button>
              <Button variant="secondary" size="sm" @click="cancelAdd">{{ t('common.cancel') }}</Button>
            </div>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="footer-hint">{{ t('providers.escClose') }}</div>
    </div>
  </Dialog>
</template>

<style scoped>
.pm { display: flex; flex-direction: column; gap: var(--space-4); }

/* Provider list */
.prov-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.state-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
}
.state-row.unavail { color: var(--color-warning); }
.empty {
  padding: var(--space-4) 0;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-base);
}
.prov-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-line);
  transition: background var(--duration-fast) var(--ease-out);
}
.prov-row:last-child { border-bottom: none; }

.status-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  box-sizing: border-box;
}
.status-dot--empty {
  background: transparent;
  border: 1.5px solid var(--color-text-faint);
}
.prov-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.prov-type {
  font-family: var(--font-ui);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.prov-url {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prov-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.prov-actions {
  display: flex;
  gap: var(--space-2);
  flex: none;
  align-items: center;
  flex-wrap: wrap;
}
/* Add section */
.add-section {
  border-top: 1px solid var(--color-line);
  padding-top: var(--space-4);
}
.add-btns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Form */
.add-form { display: flex; flex-direction: column; gap: var(--space-3); }
.catalog-meta {
  display: flex;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.add-error {
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  color: var(--color-danger);
}
.form-btns {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Footer */
.footer-hint {
  padding-top: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  border-top: 1px solid var(--color-line);
}

@media (max-width: 640px) {
  .prov-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .prov-actions {
    flex: 1 1 100%;
    justify-content: flex-end;
  }
}
</style>
