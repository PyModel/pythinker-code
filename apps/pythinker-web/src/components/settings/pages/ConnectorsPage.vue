<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppConnector, AppMcpServerInput } from '../../../api/types';
import McpServerForm from '../McpServerForm.vue';
import ListingRow from '../ListingRow.vue';

const props = defineProps<{
  connectors?: AppConnector[];
  connectorsLoading?: boolean;
  connectorsError?: string;
}>();

const emit = defineEmits<{
  restartConnector: [connectorId: string];
  createConnector: [input: AppMcpServerInput];
  updateConnector: [payload: { connectorId: string; input: AppMcpServerInput }];
  removeConnector: [connectorId: string];
}>();

const { t } = useI18n();
const formOpen = shallowRef(false);
const editingId = shallowRef<string>();
const editingConnector = computed(() =>
  props.connectors?.find((connector) => connector.id === editingId.value),
);

function openCreateForm(): void {
  editingId.value = undefined;
  formOpen.value = true;
}

function openEditForm(connector: AppConnector): void {
  editingId.value = connector.id;
  formOpen.value = true;
}

function closeForm(): void {
  editingId.value = undefined;
  formOpen.value = false;
}

function submitForm(input: AppMcpServerInput): void {
  if (editingId.value === undefined) {
    emit('createConnector', input);
    return;
  }
  emit('updateConnector', { connectorId: editingId.value, input });
}
</script>

<template>
  <section id="settings-panel-connectors" class="panel" role="tabpanel" aria-labelledby="settings-tab-connectors">
    <section class="sec">
      <h2 class="page-title">{{ t('settings.connectors.title') }}</h2>
      <p class="sec-note">{{ t('settings.connectors.note') }}</p>
      <p class="sec-note">{{ t('settings.connectors.nextSession') }}</p>
      <button type="button" class="act" @click="formOpen ? closeForm() : openCreateForm()">
        {{ formOpen ? t('settings.connectors.form.cancel') : t('settings.connectors.add') }}
      </button>
      <McpServerForm
        v-if="formOpen"
        :key="editingId ?? 'new'"
        :connector="editingConnector"
        @submit="submitForm"
        @cancel="closeForm"
      />
      <p v-if="props.connectorsError" class="listing-error" role="alert">{{ props.connectorsError }}</p>
      <p v-if="props.connectorsLoading" class="sec-empty">{{ t('settings.connectors.loading') }}</p>
      <p v-else-if="(props.connectors?.length ?? 0) === 0" class="sec-empty">{{ t('settings.connectors.empty') }}</p>
      <div v-else class="listing">
        <ListingRow v-for="connector in props.connectors" :key="connector.id" :name="connector.name">
          <template #glyph>
            <svg class="listing-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" stroke-linecap="round" /></svg>
          </template>
          <span class="tag">{{ connector.transport }}</span>
          <span class="listing-desc">{{ t(`settings.connectors.status.${connector.status}`) }}</span>
          <span class="listing-meta">{{ t('settings.connectors.tools', { count: connector.toolCount }) }}</span>
          <template #actions>
            <span class="dot" :class="`s-${connector.status}`" aria-hidden="true" />
            <button type="button" class="icon-btn connector-restart" :title="t('settings.connectors.restart')" :aria-label="t('settings.connectors.restart')" @click="emit('restartConnector', connector.id)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <template v-if="connector.editable">
              <button type="button" class="icon-btn connector-edit" :title="t('settings.connectors.edit')" :aria-label="t('settings.connectors.edit')" @click="openEditForm(connector)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11.8-11.8a2.8 2.8 0 0 0-4-4L4 16zM14.5 5.5l4 4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <button type="button" class="icon-btn connector-remove" :title="t('settings.connectors.remove')" :aria-label="t('settings.connectors.remove')" @click="emit('removeConnector', connector.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3m-9 0 1 14h8l1-14" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </template>
          </template>
          <template #detail>
            <p class="listing-indent connector-source">{{ connector.editable ? t('settings.connectors.userGlobal') : t('settings.connectors.managed') }}</p>
            <p v-if="connector.lastError" class="listing-error">{{ connector.lastError }}</p>
          </template>
        </ListingRow>
      </div>
    </section>
  </section>
</template>

<style scoped src="../settings.css"></style>

<style scoped>
.connector-source {
  color: var(--faint);
  font-size: calc(var(--ui-font-size) - 2px);
}
</style>
