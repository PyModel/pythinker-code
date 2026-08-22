<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppConfig, AppProvider } from '../../api/types';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import Spinner from '../ui/Spinner.vue';
import Tooltip from '../ui/Tooltip.vue';
import AddProviderFlow from './AddProviderFlow.vue';
import ProviderForm from './ProviderForm.vue';

const { discardToken = 0 } = defineProps<{ discardToken?: number }>();
const emit = defineEmits<{ dirtyChange: [dirty: boolean] }>();
const { t } = useI18n();
const { confirm } = useConfirmDialog();

const providers = ref<AppProvider[]>([]);
const config = ref<AppConfig | null>(null);
const loading = ref(false);
const unavailable = ref(false);
const expandedId = ref<string | null>(null);
const dirty = ref(false);

const sortedProviders = computed(() => providers.value.toSorted((a, b) => a.id.localeCompare(b.id)));
const adding = computed(() => expandedId.value === '$add');

watch(dirty, (value) => emit('dirtyChange', value), { immediate: true });
watch(() => discardToken, () => {
  dirty.value = false;
  expandedId.value = null;
});

async function load(): Promise<void> {
  loading.value = true;
  unavailable.value = false;
  try {
    providers.value = await getPythinkerWebApi().listProviders();
  } catch {
    providers.value = [];
    unavailable.value = true;
  }
  try {
    config.value = await getPythinkerWebApi().getConfig();
  } catch {
    config.value = null;
  } finally {
    loading.value = false;
  }
}

function toggle(id: string): void {
  if (dirty.value) return;
  expandedId.value = expandedId.value === id ? null : id;
}

async function saved(id: string): Promise<void> {
  dirty.value = false;
  await load();
  expandedId.value = id;
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
      expandedId.value = null;
      dirty.value = false;
      await load();
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
    </div>

    <div v-if="loading" class="providers-panel__state"><Spinner size="sm" />{{ t('providers.loading') }}</div>
    <div v-else-if="unavailable" class="providers-panel__state providers-panel__state--warning"><Icon name="alert-triangle" size="md" />{{ t('providers.unavailable') }}</div>
    <template v-else>
      <section class="providers-panel__card providers-panel__add" :class="{ 'is-open': adding }">
        <button type="button" class="providers-panel__summary" @click="toggle('$add')">
          <span class="providers-panel__add-icon"><Icon name="plus" size="sm" /></span>
          <strong>{{ t('providers.addProvider') }}</strong>
          <span class="providers-panel__grow" />
          <Icon name="chevron-right" size="sm" :class="{ 'is-rotated': adding }" />
        </button>
        <div v-if="adding" class="providers-panel__details">
          <AddProviderFlow :config="config" @dirty-change="dirty = $event" @added="saved" @cancel="expandedId = null; dirty = false" />
        </div>
      </section>

      <div v-if="providers.length === 0" class="providers-panel__state">{{ t('providers.empty') }}</div>
      <section v-for="provider in sortedProviders" :key="provider.id" class="providers-panel__card">
        <button
          type="button"
          class="providers-panel__summary"
          :data-testid="`provider-${provider.id}-toggle`"
          :aria-expanded="expandedId === provider.id"
          @click="toggle(provider.id)"
        >
          <Tooltip :text="t(`providers.status.${provider.status}`)"><span class="providers-panel__status" :class="`is-${provider.status}`" /></Tooltip>
          <span class="providers-panel__identity">
            <strong>{{ provider.id }}</strong>
            <span>{{ provider.type }}<template v-if="provider.baseUrl"> · {{ provider.baseUrl }}</template></span>
          </span>
          <span class="providers-panel__grow" />
          <Badge :variant="provider.hasApiKey ? 'success' : 'neutral'" size="sm">{{ provider.hasApiKey ? t('providers.keySet') : t('providers.keyNotSet') }}</Badge>
          <span class="providers-panel__count">{{ t('providers.modelCount', { count: provider.models?.length ?? 0 }) }}</span>
          <Icon name="chevron-right" size="sm" :class="{ 'is-rotated': expandedId === provider.id }" />
        </button>
        <div v-if="expandedId === provider.id" class="providers-panel__details">
          <div v-if="provider.models?.length" class="providers-panel__model-list">
            <code v-for="model in provider.models" :key="model">{{ model }}</code>
          </div>
          <ProviderForm mode="edit" :provider="provider" :config="config" @dirty-change="dirty = $event" @saved="saved" @cancel="expandedId = null; dirty = false" />
          <div class="providers-panel__delete">
            <Button variant="danger-soft" size="sm" :data-testid="`provider-${provider.id}-delete`" @click="deleteProvider(provider)">{{ t('providers.deleteProvider') }}</Button>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.providers-panel { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) 0; }
.providers-panel__heading h3 { margin: 0; color: var(--color-text); font-size: var(--text-xl); font-weight: var(--weight-medium); }
.providers-panel__heading p { margin: var(--space-1) 0 0; color: var(--color-text-muted); font-size: var(--text-sm); }
.providers-panel__state { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-5) 0; color: var(--color-text-muted); }
.providers-panel__state--warning { color: var(--color-warning); }
.providers-panel__card { overflow: hidden; border: 1px solid var(--color-line); border-radius: var(--radius-lg); background: var(--color-bg); }
.providers-panel__add { border-style: dashed; }
.providers-panel__summary { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 54px; padding: var(--space-3) var(--space-4); border: 0; background: transparent; color: var(--color-text); text-align: left; cursor: pointer; }
.providers-panel__summary:hover { background: var(--color-hover); }
.providers-panel__summary:focus-visible { outline: none; box-shadow: inset var(--p-focus-ring); }
.providers-panel__add-icon { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--radius-md); background: var(--color-accent-soft); color: var(--color-accent); }
.providers-panel__grow { flex: 1; }
.providers-panel__identity { display: flex; min-width: 0; flex-direction: column; gap: var(--space-1); }
.providers-panel__identity strong, .providers-panel__identity span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.providers-panel__identity span, .providers-panel__count { color: var(--color-text-muted); font-size: var(--text-xs); }
.providers-panel__status { display: block; width: 8px; height: 8px; border: 1px solid var(--color-text-faint); border-radius: var(--radius-full); }
.providers-panel__status.is-connected { border-color: var(--color-success); background: var(--color-success); }
.providers-panel__status.is-error { border-color: var(--color-danger); background: var(--color-danger); }
.providers-panel__summary :deep(.ui-icon).is-rotated { transform: rotate(90deg); }
.providers-panel__details { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4); border-top: 1px solid var(--color-line); background: var(--color-surface-sunken); }
.providers-panel__model-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.providers-panel__model-list code { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-raised); color: var(--color-text-muted); font-size: var(--text-xs); }
.providers-panel__delete { display: flex; justify-content: flex-start; padding-top: var(--space-3); border-top: 1px solid var(--color-line); }
@media (max-width: 640px) { .providers-panel__count { display: none; } .providers-panel__summary { gap: var(--space-2); padding: var(--space-3); } }
</style>
