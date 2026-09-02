<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppModel } from '../../api/types';
import { expertTalkContextKey } from '../../composables/expertTalkContext';
import Button from '../ui/Button.vue';
import Dialog from '../ui/Dialog.vue';
import Field from '../ui/Field.vue';
import Icon from '../ui/Icon.vue';
import Pill from '../ui/Pill.vue';
import SecondaryModelPicker from '../settings/SecondaryModelPicker.vue';

const ExpertTalkExchange = defineAsyncComponent(() => import('./ExpertTalkExchange.vue'));

const props = withDefaults(defineProps<{
  models: AppModel[];
  trigger?: 'pill' | 'launcher' | 'widget';
}>(), {
  trigger: 'pill',
});
const emit = defineEmits<{
  take: [answer: string];
  build: [answer: string];
}>();
const expertTalk = inject(expertTalkContextKey);
const { t } = useI18n();
const open = ref(false);
const leadModelId = ref('');
const peerModelId = ref('');
const leadThinkingEffort = ref('');
const peerThinkingEffort = ref('');

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
const modelPickerGroups = computed(() => modelGroups.value.map((group) => ({
  provider: group.provider,
  options: group.models.map((model) => ({ id: model.id, label: modelLabel(model.id) })),
})));
const modelInfoById = computed<Record<string, AppModel>>(() =>
  Object.fromEntries(props.models.map((model) => [model.id, model])),
);
const status = computed(() => expertTalk?.status.value);
const run = computed(() => expertTalk?.run.value);
const available = computed(() => expertTalk?.available.value === true);
const active = computed(() => run.value?.state === 'running');
const armed = computed(() => status.value?.activation.state === 'armed');
const configuredPair = computed(() => status.value?.config);
const preferredPair = computed(() => expertTalk?.preferredPair.value ?? configuredPair.value);
const armedLead = computed(() => configuredPair.value === null || configuredPair.value === undefined
  ? ''
  : modelLabel(configuredPair.value.fusionLeadModelId));
const armedPeer = computed(() => configuredPair.value === null || configuredPair.value === undefined
  ? ''
  : modelLabel(configuredPair.value.peerModelId));
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
  if (active.value) return t(`expertTalk.stage.${run.value?.stage ?? 'opening'}`);
  return t('expertTalk.title');
});

function modelLabel(modelId: string): string {
  const model = props.models.find((candidate) => candidate.id === modelId);
  return model?.displayName ?? model?.model ?? modelId;
}

function initializePair(): void {
  const configured = preferredPair.value;
  leadModelId.value = configured?.fusionLeadModelId ?? '';
  peerModelId.value = configured?.peerModelId ?? '';
  leadThinkingEffort.value = configured?.fusionLeadThinkingEffort ?? '';
  peerThinkingEffort.value = configured?.peerThinkingEffort ?? '';
}

watch(open, (next) => {
  if (next) initializePair();
});

function openDialog(): void {
  if (available.value) open.value = true;
}

async function activate(): Promise<void> {
  const pair = preferredPair.value;
  if (!expertTalk || pair === null || pair === undefined || active.value || armed.value) {
    openDialog();
    return;
  }
  await expertTalk.useForNextMessage(pair);
}

function cancelActive(): boolean {
  if (!expertTalk || !active.value) return false;
  void expertTalk.cancel();
  return true;
}

defineExpose({ available, openDialog, activate, cancelActive });

async function useNext(): Promise<void> {
  if (!expertTalk || !pairValid.value) return;
  await expertTalk.useForNextMessage({
    fusionLeadModelId: leadModelId.value,
    peerModelId: peerModelId.value,
    fusionLeadThinkingEffort: leadThinkingEffort.value || undefined,
    peerThinkingEffort: peerThinkingEffort.value || undefined,
  });
  if (expertTalk.error.value === undefined) open.value = false;
}

function setLead(selection: { model: string; effort?: string }): void {
  leadModelId.value = selection.model;
  leadThinkingEffort.value = selection.effort ?? '';
}

function setPeer(selection: { model: string; effort?: string }): void {
  peerModelId.value = selection.model;
  peerThinkingEffort.value = selection.effort ?? '';
}

async function handOff(kind: 'take' | 'build', answer: string): Promise<void> {
  if (!expertTalk) return;
  if (armed.value) {
    await expertTalk.disarm();
    if (armed.value || expertTalk.error.value !== undefined) return;
  }
  if (kind === 'take') emit('take', answer);
  else emit('build', answer);
  open.value = false;
}
</script>

<template>
  <template v-if="available">
    <button
      v-if="trigger === 'widget' && armed"
      type="button"
      class="expert-talk__one-shot"
      :aria-label="t('expertTalk.armedLabel', { lead: armedLead, peer: armedPeer })"
      @click="openDialog"
    >
      <span class="expert-talk__one-shot-title">
        <Icon name="sparkles" size="sm" />
        {{ t('expertTalk.oneShot') }}
      </span>
      <span class="expert-talk__one-shot-pair">
        <span class="expert-talk__one-shot-lead">◆ {{ armedLead }}</span>
        <span aria-hidden="true">⊕</span>
        <span class="expert-talk__one-shot-peer">▲ {{ armedPeer }}</span>
      </span>
      <span class="expert-talk__one-shot-scope">{{ t('expertTalk.oneShotScope') }}</span>
    </button>
    <button
      v-else-if="trigger === 'launcher'"
      type="button"
      class="expert-talk__launcher"
      aria-haspopup="dialog"
      @click="openDialog"
    >
      <Icon name="sparkles" size="md" />
      <span>{{ triggerLabel }}</span>
    </button>
    <Pill v-else-if="trigger === 'pill' && active" active @click="openDialog">
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
        <section v-if="!status?.config && !run" class="expert-talk__boot" :aria-label="t('expertTalk.bootTitle')">
          <strong>{{ t('expertTalk.bootTitle') }}</strong>
          <span>{{ t('expertTalk.bootSubtitle') }}</span>
          <span class="expert-talk__boot-pair" aria-hidden="true">●&nbsp; + &nbsp;●</span>
        </section>
        <section class="expert-talk__pair" aria-labelledby="expert-talk-pair-title">
          <div id="expert-talk-pair-title" class="expert-talk__section-title">
            {{ t('expertTalk.pair') }}
          </div>
          <div class="expert-talk__fields">
            <Field :label="t('expertTalk.lead')" :hint="t('expertTalk.leadHint')">
              <SecondaryModelPicker
                class="expert-talk__model-select"
                :model-value="leadModelId"
                :effort="leadThinkingEffort"
                :groups="modelPickerGroups"
                :model-info-by-id="modelInfoById"
                :allow-empty="false"
                :empty-label="t('expertTalk.selectModel')"
                :aria-label="t('expertTalk.lead')"
                :disabled="active || armed || expertTalk?.busy.value"
                @select="setLead"
              />
            </Field>
            <span class="expert-talk__exchange" aria-hidden="true">
              <Icon name="chevron-right" size="md" />
            </span>
            <Field :label="t('expertTalk.peer')" :hint="t('expertTalk.peerHint')">
              <SecondaryModelPicker
                class="expert-talk__model-select"
                :model-value="peerModelId"
                :effort="peerThinkingEffort"
                :groups="modelPickerGroups"
                :model-info-by-id="modelInfoById"
                :allow-empty="false"
                :empty-label="t('expertTalk.selectModel')"
                :aria-label="t('expertTalk.peer')"
                :disabled="active || armed || expertTalk?.busy.value"
                @select="setPeer"
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
          @take="handOff('take', $event)"
          @build="handOff('build', $event)"
        />

        <p v-if="expertTalk?.error.value" class="expert-talk__error" role="alert">
          {{ expertTalk.error.value }}
        </p>
      </div>

      <template #foot>
        <div class="expert-talk__actions">
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
        </div>
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

.expert-talk__one-shot {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--p-hairline) solid #a78bfa;
  border-radius: var(--radius-lg);
  background: var(--color-surface-sunken);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}

.expert-talk__one-shot-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: #a78bfa;
  font-weight: var(--weight-semibold);
}

.expert-talk__one-shot-pair {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.expert-talk__one-shot-lead,
.expert-talk__one-shot-peer {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.expert-talk__one-shot-lead {
  color: #a78bfa;
}

.expert-talk__one-shot-peer {
  color: #f59e0b;
}

.expert-talk__one-shot-scope {
  color: var(--color-text-faint);
}

.expert-talk__boot {
  display: grid;
  justify-items: center;
  gap: var(--space-1);
  padding: var(--space-4);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-sunken);
  font-family: var(--font-mono);
  text-align: center;
}

.expert-talk__boot strong {
  color: #a78bfa;
  letter-spacing: 0.08em;
}

.expert-talk__boot span {
  color: var(--color-text-muted);
}

.expert-talk__boot-pair {
  color: #22d3ee !important;
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

.expert-talk__model-select :deep(.sm-picker__trigger) {
  width: 100%;
  height: 38px;
  justify-content: space-between;
}

.expert-talk__pair :deep(.ui-field__hint) {
  color: var(--color-text-muted);
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

.expert-talk__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}

.expert-talk__actions :deep(.ui-button--primary) {
  border-color: color-mix(in srgb, var(--color-accent) 72%, black);
  background: color-mix(in srgb, var(--color-accent) 72%, black);
}

.expert-talk__actions :deep(.ui-button--primary:not(:disabled):hover) {
  border-color: color-mix(in srgb, var(--color-accent) 78%, black);
  background: color-mix(in srgb, var(--color-accent) 78%, black);
}

@media (max-width: 640px) {
  .expert-talk__one-shot {
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__one-shot-title,
  .expert-talk__one-shot-scope {
    text-align: center;
  }

  .expert-talk__fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__exchange {
    display: none;
  }

  .expert-talk__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__actions > * {
    width: 100%;
    min-width: 0;
  }
}
</style>
