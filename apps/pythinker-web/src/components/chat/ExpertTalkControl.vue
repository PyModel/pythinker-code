<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppModel } from '../../api/types';
import { expertTalkContextKey } from '../../composables/expertTalkContext';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import FilterSelect from '../ui/FilterSelect.vue';
import Icon from '../ui/Icon.vue';
import Pill from '../ui/Pill.vue';

const ExpertTalkExchange = defineAsyncComponent(() => import('./ExpertTalkExchange.vue'));

const props = withDefaults(defineProps<{
  models: AppModel[];
  trigger?: 'pill' | 'launcher';
}>(), {
  trigger: 'pill',
});
const emit = defineEmits<{
  build: [prompt: string];
}>();
const expertTalk = inject(expertTalkContextKey);
const { t } = useI18n();
const open = ref(false);
const leadModelId = ref('');
const peerModelId = ref('');

const models = computed(() => props.models.filter((model) =>
  model.maxContextSize > 0 &&
  (model.capabilities ?? []).some((capability) =>
    capability.trim().toLowerCase().replaceAll('-', '_') === 'tool_use'
  ),
));
const modelGroups = computed(() => {
  const groups = new Map<string, AppModel[]>();
  for (const model of models.value) {
    const group = groups.get(model.provider) ?? [];
    group.push(model);
    groups.set(model.provider, group);
  }
  return Array.from(groups.entries())
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([provider, providerModels]) => ({
      provider,
      models: providerModels.toSorted((a, b) => modelLabel(a.id).localeCompare(modelLabel(b.id))),
    }));
});
const modelOptions = computed(() => modelGroups.value.flatMap((group) =>
  group.models.map((model) => ({
    value: model.id,
    label: modelLabel(model.id),
    group: group.provider,
  })),
));
const status = computed(() => expertTalk?.status.value);
const run = computed(() => expertTalk?.run.value);
const available = computed(() => expertTalk?.available.value === true);
const active = computed(() =>
  run.value?.state === 'preparing' ||
  run.value?.state === 'running' ||
  run.value?.state === 'waiting'
);
const armed = computed(() => status.value?.activation.state === 'armed');
const pairValid = computed(() =>
  leadModelId.value.length > 0 &&
  peerModelId.value.length > 0 &&
  leadModelId.value !== peerModelId.value,
);
const terminalFailure = computed(() => {
  const state = run.value?.state;
  return state === 'failed' || state === 'cancelled' || state === 'interrupted';
});
const triggerLabel = computed(() => {
  if (armed.value) return t('expertTalk.next');
  if (active.value) return t(`expertTalk.stage.${run.value?.stage ?? 'preparing'}`);
  return t('expertTalk.title');
});

function modelLabel(modelId: string): string {
  const model = props.models.find((candidate) => candidate.id === modelId);
  return model?.displayName ?? model?.model ?? modelId;
}

function initializePair(): void {
  const configured = status.value?.config;
  const first = models.value[0]?.id ?? '';
  leadModelId.value = configured?.fusionLeadModelId ?? first;
  peerModelId.value = configured?.peerModelId
    ?? models.value.find((model) => model.id !== leadModelId.value)?.id
    ?? '';
}

watch(open, (next) => {
  if (next) initializePair();
});

function openDialog(): void {
  if (available.value) open.value = true;
}

defineExpose({ available, openDialog });

async function useNext(): Promise<void> {
  if (!expertTalk || !pairValid.value) return;
  await expertTalk.useForNextMessage(leadModelId.value, peerModelId.value);
  if (expertTalk.error.value === undefined) open.value = false;
}

async function buildFromFusion(answer: string): Promise<void> {
  if (!expertTalk) return;
  if (armed.value) {
    await expertTalk.disarm();
    if (armed.value || expertTalk.error.value !== undefined) return;
  }
  emit('build', answer);
  open.value = false;
}
</script>

<template>
  <template v-if="available">
    <button
      v-if="trigger === 'launcher'"
      type="button"
      class="expert-talk__launcher"
      aria-haspopup="dialog"
      @click="openDialog"
    >
      <Icon name="sparkles" size="md" />
      <span>{{ triggerLabel }}</span>
    </button>
    <Pill v-else :active="armed || active" :aria-pressed="armed" @click="openDialog">
      <Icon name="sparkles" size="sm" />
      <span>{{ triggerLabel }}</span>
    </Pill>

    <Dialog
      v-model:open="open"
      :title="t('expertTalk.title')"
      :description="t('expertTalk.description')"
      size="xl"
    >
      <div class="expert-talk">
        <section class="expert-talk__pair" aria-labelledby="expert-talk-pair-title">
          <div id="expert-talk-pair-title" class="expert-talk__section-title">
            {{ t('expertTalk.pair') }}
          </div>
          <div class="expert-talk__fields">
            <Field :label="t('expertTalk.lead')" :hint="t('expertTalk.leadHint')">
              <FilterSelect
                v-model="leadModelId"
                class="expert-talk__model-select"
                :label="''"
                :aria-label="t('expertTalk.lead')"
                :options="modelOptions"
                :disabled="active || armed || expertTalk?.busy.value"
              />
            </Field>
            <span class="expert-talk__exchange" aria-hidden="true">
              <Icon name="chevron-right" size="md" />
            </span>
            <Field :label="t('expertTalk.peer')" :hint="t('expertTalk.peerHint')">
              <FilterSelect
                v-model="peerModelId"
                class="expert-talk__model-select"
                :label="''"
                :aria-label="t('expertTalk.peer')"
                :options="modelOptions"
                :disabled="active || armed || expertTalk?.busy.value"
              />
            </Field>
          </div>
          <p v-if="models.length < 2" class="expert-talk__error" role="alert">
            {{ t('expertTalk.modelsRequired') }}
          </p>
          <p v-else-if="!pairValid" class="expert-talk__error" role="alert">
            {{ t('expertTalk.distinctRequired') }}
          </p>
          <p
            v-if="status?.pairValidation.state !== 'valid' && status?.pairValidation.reason"
            class="expert-talk__error"
            role="alert"
          >
            {{ status.pairValidation.reason }}
          </p>
        </section>

        <section class="expert-talk__disclosure">
          <Icon name="info" size="md" />
          <span>{{ t('expertTalk.disclosure') }}</span>
        </section>

        <ExpertTalkExchange
          v-if="run"
          :run="run"
          :models="models"
          @build="buildFromFusion"
        />

        <p v-if="expertTalk?.error.value" class="expert-talk__error" role="alert">
          {{ expertTalk.error.value }}
        </p>
      </div>

      <template #foot>
        <Button
          v-if="status?.config && !active && !armed"
          variant="ghost"
          :disabled="expertTalk?.busy.value"
          @click="expertTalk?.clear()"
        >
          {{ t('expertTalk.clear') }}
        </Button>
        <Button
          v-if="armed"
          variant="secondary"
          :loading="expertTalk?.busy.value"
          @click="expertTalk?.disarm()"
        >
          {{ t('expertTalk.disarm') }}
        </Button>
        <Button
          v-else-if="active"
          variant="danger-soft"
          :loading="expertTalk?.busy.value"
          @click="expertTalk?.cancel()"
        >
          {{ t('expertTalk.stop') }}
        </Button>
        <Button
          v-else-if="terminalFailure && run?.error?.retryable"
          variant="secondary"
          :loading="expertTalk?.busy.value"
          @click="expertTalk?.retry()"
        >
          {{ t('expertTalk.retry') }}
        </Button>
        <Button
          v-if="!active && !armed"
          :disabled="!pairValid || models.length < 2"
          :loading="expertTalk?.busy.value"
          @click="useNext"
        >
          <Icon name="sparkles" size="sm" />
          {{ t('expertTalk.useNext') }}
        </Button>
      </template>
    </Dialog>
  </template>
</template>

<style scoped>
.expert-talk {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.expert-talk__pair {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.expert-talk__section-title {
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.expert-talk__fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
}

.expert-talk__model-select {
  width: 100%;
}

.expert-talk__model-select :deep(.filter-select__trigger) {
  width: 100%;
  height: 38px;
  justify-content: space-between;
}

.expert-talk__model-select :deep(.filter-select__menu) {
  right: auto;
  left: 0;
  width: 100%;
  min-width: 100%;
  max-height: min(280px, calc(100vh - 64px));
}

.expert-talk__model-select :deep(.ui-menu-item) {
  min-width: 0;
}

.expert-talk__exchange {
  color: var(--color-text-faint);
  padding-top: var(--space-2);
}

.expert-talk__disclosure {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-sunken);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}

.expert-talk__disclosure :deep(svg) {
  flex: none;
  margin-top: var(--space-05);
}

.expert-talk__error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}

@media (max-width: 640px) {
  .expert-talk__fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__exchange {
    display: none;
  }

}
</style>
