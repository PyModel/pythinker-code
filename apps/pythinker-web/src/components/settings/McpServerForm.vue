<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppConnector, AppMcpServerInput } from '../../api/types';

type McpTransport = AppMcpServerInput['transport'];

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const props = defineProps<{
  connector?: AppConnector;
}>();

const emit = defineEmits<{
  submit: [input: AppMcpServerInput];
  cancel: [];
}>();

const { t } = useI18n();
const isEditing = computed(() => props.connector !== undefined);
const formError = ref<string>();
const definition = props.connector?.definition;
const form = reactive<FormState>({
  name: props.connector?.name ?? '',
  transport: definition?.transport ?? props.connector?.transport ?? 'stdio',
  command: definition?.command ?? '',
  args: definition?.args?.join('\n') ?? '',
  env: stringifyRecord(definition?.env),
  url: definition?.url ?? '',
  headers: stringifyRecord(definition?.headers),
});

function stringifyRecord(value: Record<string, string> | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function parseRecord(value: string, field: string): Record<string, string> | undefined {
  if (value.trim() === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    formError.value = t('settings.connectors.form.invalidJson', { field });
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    formError.value = t('settings.connectors.form.objectRequired', { field });
    return undefined;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, entry]) => typeof entry !== 'string')) {
    formError.value = t('settings.connectors.form.stringValuesRequired', { field });
    return undefined;
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function submit(): void {
  formError.value = undefined;
  const env = form.transport === 'stdio' ? parseRecord(form.env, 'env') : undefined;
  if (form.transport === 'stdio' && form.env.trim() !== '' && env === undefined) return;
  const headers = form.transport !== 'stdio' ? parseRecord(form.headers, 'headers') : undefined;
  if (form.transport !== 'stdio' && form.headers.trim() !== '' && headers === undefined) return;
  emit('submit', {
    name: form.name,
    transport: form.transport,
    command: form.transport === 'stdio' ? form.command : undefined,
    args: form.transport === 'stdio' && form.args.trim() !== ''
      ? form.args.split('\n').map((arg) => arg.trim()).filter((arg) => arg.length > 0)
      : undefined,
    env,
    url: form.transport === 'stdio' ? undefined : form.url,
    headers,
  });
}
</script>

<template>
  <form class="connector-form" @submit.prevent="submit">
    <div class="connector-fields">
      <label class="connector-field">
        <span class="rlabel">{{ t('settings.connectors.form.name') }}</span>
        <input v-model="form.name" class="page-search" :readonly="isEditing" required />
      </label>
      <label class="connector-field">
        <span class="rlabel">{{ t('settings.connectors.form.transport') }}</span>
        <select v-model="form.transport" class="page-search">
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </label>
      <label v-if="form.transport === 'stdio'" class="connector-field connector-field-wide">
        <span class="rlabel">{{ t('settings.connectors.form.command') }}</span>
        <input v-model="form.command" class="page-search" required />
      </label>
      <label v-if="form.transport === 'stdio'" class="connector-field connector-field-wide">
        <span class="rlabel">{{ t('settings.connectors.form.args') }}</span>
        <textarea v-model="form.args" class="page-search connector-textarea" :placeholder="t('settings.connectors.form.argsHint')" />
      </label>
      <label v-if="form.transport === 'stdio'" class="connector-field connector-field-wide">
        <span class="rlabel">{{ t('settings.connectors.form.env') }}</span>
        <textarea v-model="form.env" class="page-search connector-textarea" :placeholder="t('settings.connectors.form.objectHint')" />
      </label>
      <label v-else class="connector-field connector-field-wide">
        <span class="rlabel">{{ t('settings.connectors.form.url') }}</span>
        <input v-model="form.url" class="page-search" type="url" required />
      </label>
      <label v-if="form.transport !== 'stdio'" class="connector-field connector-field-wide">
        <span class="rlabel">{{ t('settings.connectors.form.headers') }}</span>
        <textarea v-model="form.headers" class="page-search connector-textarea" :placeholder="t('settings.connectors.form.objectHint')" />
      </label>
    </div>
    <p v-if="formError" class="listing-error">{{ formError }}</p>
    <div class="connector-form-actions">
      <button type="submit" class="act">{{ isEditing ? t('settings.connectors.form.save') : t('settings.connectors.form.add') }}</button>
      <button v-if="isEditing" type="button" class="act" @click="emit('cancel')">{{ t('settings.connectors.form.cancel') }}</button>
    </div>
  </form>
</template>

<style scoped src="./settings.css"></style>

<style scoped>
.connector-form {
  margin: 12px 0 16px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--panel);
}
.connector-fields {
  /* Two fixed columns, not auto-fit: a pane-wide grid stretches the short
     fields and leaves a ragged tail row. Name and Transport share the first
     row; every longer field spans both columns so no row ends half empty. */
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  max-width: 640px;
}
.connector-field { min-width: 0; }
.connector-field-wide { grid-column: 1 / -1; }
.connector-field .page-search { margin: 4px 0 0; }
.connector-textarea {
  min-height: 64px;
  resize: vertical;
  font-family: var(--mono);
}
.connector-form-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
@media (max-width: 640px) {
  .connector-fields { grid-template-columns: 1fr; }
}
</style>
