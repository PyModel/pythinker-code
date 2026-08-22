<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../../api';
import type { AppConfig, AppProvider, CatalogProviderWireType } from '../../api/types';
import {
  emptyProviderForm,
  emptyProviderModel,
  modelsForProvider,
  providerTypes,
  toProviderCreateInput,
  toProviderUpdateInput,
  validateProviderForm,
  type ProviderFormValue,
} from '../../lib/providerForm';
import Button from '../ui/Button.vue';
import Field from '../ui/Field.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import Input from '../ui/Input.vue';
import Select from '../ui/Select.vue';

const props = defineProps<{
  mode: 'add' | 'edit';
  provider?: AppProvider;
  config?: AppConfig | null;
}>();

const emit = defineEmits<{
  dirtyChange: [dirty: boolean];
  saved: [providerId: string];
  cancel: [];
}>();

const { t } = useI18n();
const initial = emptyProviderForm();
const form = reactive<ProviderFormValue>(initial);
const error = ref('');
const saving = ref(false);
const showApiKey = ref(false);
const apiKeyLoaded = ref(false);
const apiKeyTouched = ref(false);
const managed = computed(() => props.provider?.id.startsWith('managed:') === true);
const typeOptions = computed(() => providerTypes.map((value) => ({
  value,
  label: t(`providers.types.${value}`),
})));

function reset(): void {
  const provider = props.provider;
  if (props.mode === 'edit' && provider !== undefined) {
    form.id = provider.id;
    form.type = provider.type as CatalogProviderWireType;
    form.apiKey = '';
    form.baseUrl = provider.baseUrl ?? '';
    const models = modelsForProvider(provider, props.config?.models);
    form.models = models.length > 0 ? models : [emptyProviderModel()];
  } else {
    Object.assign(form, emptyProviderForm());
  }
  error.value = '';
  emit('dirtyChange', false);
}

async function loadStoredKey(): Promise<void> {
  const provider = props.provider;
  if (props.mode !== 'edit' || provider === undefined || managed.value || !provider.hasApiKey) return;
  try {
    const detail = await getPythinkerWebApi().getProvider(provider.id);
    if (detail.apiKey && !apiKeyTouched.value) {
      form.apiKey = detail.apiKey;
      apiKeyLoaded.value = true;
    }
  } catch {
    apiKeyLoaded.value = false;
  }
}

function markDirty(): void {
  emit('dirtyChange', true);
}

function addModel(): void {
  form.models.push(emptyProviderModel());
  markDirty();
}

function removeModel(index: number): void {
  if (form.models.length <= 1) return;
  form.models.splice(index, 1);
  markDirty();
}

async function save(): Promise<void> {
  if (saving.value || managed.value) return;
  const validation = validateProviderForm(form, {
    apiKey: props.mode === 'add',
    baseUrl: props.mode === 'add',
  });
  if (validation !== null) {
    error.value = t(`providers.error.${validation}`);
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (props.mode === 'add') {
      const created = await getPythinkerWebApi().addProvider(toProviderCreateInput(form));
      emit('dirtyChange', false);
      emit('saved', created.id);
      return;
    }
    const provider = props.provider;
    if (provider === undefined) return;
    const saved = await getPythinkerWebApi().updateProvider(
      provider.id,
      toProviderUpdateInput(
        form,
        provider,
        apiKeyLoaded.value,
        props.config?.providers[provider.id]?.defaultModel,
      ),
    );
    emit('dirtyChange', false);
    emit('saved', saved.provider.id);
  } catch {
    error.value = t('providers.saveFailed');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  reset();
  void loadStoredKey();
});
</script>

<template>
  <form class="provider-form" @submit.prevent="save" @input="markDirty">
    <div v-if="managed" class="provider-form__managed">{{ t('providers.managedHint') }}</div>

    <div class="provider-form__fields">
      <Field :label="t('providers.fieldId')">
        <Input v-model="form.id" :disabled="managed" autocomplete="off" spellcheck="false" />
      </Field>
      <Field :label="t('providers.fieldType')">
        <Select v-model="form.type" :disabled="managed">
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </Select>
      </Field>
      <Field :label="t('providers.fieldApiKey')">
        <div class="provider-form__key">
          <Input
            v-model="form.apiKey"
            :type="showApiKey ? 'text' : 'password'"
            :disabled="managed"
            :placeholder="provider?.hasApiKey ? t('providers.apiKeySet') : 'sk-…'"
            autocomplete="off"
            spellcheck="false"
            @update:model-value="apiKeyTouched = true"
          />
          <IconButton
            class="provider-form__eye"
            size="sm"
            :disabled="managed"
            :label="showApiKey ? t('providers.hideApiKey') : t('providers.showApiKey')"
            @click="showApiKey = !showApiKey"
          >
            <Icon :name="showApiKey ? 'eye-off' : 'eye'" size="sm" />
          </IconButton>
        </div>
      </Field>
      <Field :label="t('providers.fieldBaseUrl')">
        <Input
          v-model="form.baseUrl"
          :disabled="managed"
          :placeholder="t('providers.baseUrlPlaceholder')"
          autocomplete="off"
          spellcheck="false"
        />
      </Field>
    </div>

    <div class="provider-form__models-head">
      <strong>{{ t('providers.fieldModels') }}</strong>
      <Button type="button" size="sm" variant="secondary" :disabled="managed" @click="addModel">
        <Icon name="plus" size="sm" />{{ t('providers.addModel') }}
      </Button>
    </div>
    <div class="provider-form__models">
      <div class="provider-form__model provider-form__model--head">
        <span>{{ t('providers.colModelId') }}</span>
        <span>{{ t('providers.colContext') }}</span>
        <span>{{ t('providers.colDisplayName') }}</span>
        <span />
      </div>
      <div v-for="(model, index) in form.models" :key="index" class="provider-form__model">
        <Input v-model="model.model" :disabled="managed" :placeholder="t('providers.modelIdPlaceholder')" />
        <Input v-model="model.maxContextSize" :disabled="managed" inputmode="numeric" :placeholder="t('providers.modelContextPlaceholder')" />
        <Input v-model="model.displayName" :disabled="managed" :placeholder="t('providers.modelNamePlaceholder')" />
        <IconButton
          size="sm"
          :disabled="managed || form.models.length <= 1"
          :label="t('providers.removeModel')"
          @click="removeModel(index)"
        ><Icon name="trash" size="sm" /></IconButton>
      </div>
    </div>

    <div v-if="error" class="provider-form__error" role="alert">{{ error }}</div>
    <div class="provider-form__actions">
      <Button type="button" variant="secondary" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button v-if="!managed" type="submit" variant="primary" :loading="saving">{{ t('providers.save') }}</Button>
    </div>
  </form>
</template>

<style scoped>
.provider-form { display: flex; flex-direction: column; gap: var(--space-4); }
.provider-form__managed { color: var(--color-text-muted); font-size: var(--text-sm); }
.provider-form__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.provider-form__key { position: relative; }
.provider-form__key :deep(.ui-input) { padding-right: calc(var(--p-ic-sm) + var(--space-3)); }
.provider-form__eye { position: absolute; top: 50%; right: var(--space-1); transform: translateY(-50%); }
.provider-form__models-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.provider-form__models { overflow-x: auto; border: 1px solid var(--color-line); border-radius: var(--radius-md); }
.provider-form__model { display: grid; grid-template-columns: minmax(180px, 1.2fr) minmax(120px, 0.7fr) minmax(160px, 1fr) 32px; gap: var(--space-2); align-items: center; padding: var(--space-2); border-top: 1px solid var(--color-line); }
.provider-form__model--head { border-top: 0; background: var(--color-surface-sunken); color: var(--color-text-muted); font-size: var(--text-xs); font-weight: var(--weight-medium); }
.provider-form__error { color: var(--color-danger); font-size: var(--text-sm); }
.provider-form__actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
@media (max-width: 640px) { .provider-form__fields { grid-template-columns: 1fr; } }
</style>
