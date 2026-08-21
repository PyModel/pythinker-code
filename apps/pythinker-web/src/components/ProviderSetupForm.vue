<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppProviderSetup } from '../api/types';

const props = withDefaults(defineProps<{
  catalog: AppProviderSetup[];
  loading?: boolean;
  unavailable?: boolean;
  saving?: boolean;
  submitLabel?: string;
}>(), {
  loading: false,
  unavailable: false,
  saving: false,
  submitLabel: undefined,
});

const emit = defineEmits<{
  add: [input: { providerId: string; apiKey: string; defaultModel: string }];
}>();

const { t } = useI18n();
const availableCatalog = computed(() => props.catalog.filter((provider) => {
  const id = provider.id.toLowerCase();
  return id !== 'pythinker' && id !== 'pythoughts';
}));
const providerId = ref('');
const modelId = ref('');
const apiKey = ref('');
const error = ref('');
const provider = computed(() =>
  availableCatalog.value.find((item) => item.id === providerId.value),
);

watch(availableCatalog, (catalog) => {
  if (catalog.some((item) => item.id === providerId.value)) return;
  providerId.value = catalog[0]?.id ?? '';
}, { immediate: true });

watch(provider, (next) => {
  if (next?.models.some((model) => model.id === modelId.value)) return;
  modelId.value = next?.models[0]?.id ?? '';
}, { immediate: true });

function submit(): void {
  const key = apiKey.value.trim();
  if (providerId.value.length === 0 || modelId.value.length === 0) {
    error.value = t('providers.catalogUnavailable');
    return;
  }
  if (key.length === 0) {
    error.value = t('providers.apiKeyRequired');
    return;
  }
  error.value = '';
  emit('add', {
    providerId: providerId.value,
    apiKey: key,
    defaultModel: modelId.value,
  });
}
</script>

<template>
  <form class="provider-setup" @submit.prevent="submit">
    <p class="setup-copy">{{ t('providers.byoDescription') }}</p>
    <div v-if="loading" class="setup-state">{{ t('providers.catalogLoading') }}</div>
    <div v-else-if="unavailable || availableCatalog.length === 0" class="setup-state error">
      {{ t('providers.catalogUnavailable') }}
    </div>
    <template v-else>
      <label class="setup-field">
        <span>{{ t('providers.fieldProvider') }}</span>
        <select v-model="providerId" class="setup-input" data-provider-select>
          <option
            v-for="item in availableCatalog"
            :key="item.id"
            :value="item.id"
            data-provider-option
          >
            {{ item.name }}
          </option>
        </select>
      </label>
      <label class="setup-field">
        <span>{{ t('providers.fieldDefaultModel') }}</span>
        <select v-model="modelId" class="setup-input" data-model-select>
          <option v-for="model in provider?.models ?? []" :key="model.id" :value="model.id">
            {{ model.name ?? model.id }}
          </option>
        </select>
      </label>
      <label class="setup-field">
        <span>{{ t('providers.fieldApiKey') }}</span>
        <input
          v-model="apiKey"
          class="setup-input"
          data-api-key
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="sk-…"
        />
      </label>
      <p v-if="error" class="setup-error" role="alert">{{ error }}</p>
      <button class="setup-submit" type="submit" :disabled="saving">
        {{ saving ? t('providers.saving') : (submitLabel ?? t('providers.add')) }}
      </button>
    </template>
  </form>
</template>

<style scoped>
.provider-setup { display: flex; flex-direction: column; gap: 10px; }
.setup-copy { margin: 0; color: var(--muted); font-size: var(--ui-font-size-sm); line-height: 1.45; }
.setup-field { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 10px; color: var(--dim); font-size: var(--ui-font-size-sm); }
.setup-input { min-width: 0; width: 100%; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--panel); color: var(--ink); font: inherit; outline: none; }
.setup-input:focus-visible { border-color: var(--blue); box-shadow: 0 0 0 2px color-mix(in srgb, var(--blue) 25%, transparent); }
.setup-state { padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm); color: var(--muted); }
.setup-state.error, .setup-error { color: var(--err); }
.setup-error { margin: 0; font-size: var(--ui-font-size-sm); }
.setup-submit { min-height: 38px; padding: 0 16px; border: 1px solid var(--blue); border-radius: var(--r-sm); background: var(--blue); color: white; font: inherit; font-weight: 600; cursor: pointer; }
.setup-submit:hover { background: var(--blue2); }
.setup-submit:disabled { cursor: wait; opacity: 0.6; }
@media (max-width: 480px) {
  .setup-field { grid-template-columns: 1fr; gap: 5px; }
}
</style>
