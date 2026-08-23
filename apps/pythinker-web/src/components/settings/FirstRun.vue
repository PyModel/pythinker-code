<script setup lang="ts">
// The first-run wizard: Connect → Model → Appearance.
//
// Orchestration only — each step delegates to the component that already owns
// that job. It replaces the old setup screen, whose single "add a provider"
// action could not satisfy readiness on its own and left new installs stuck.
//
// Completion is written LAST, by the final step. If the app dies mid-wizard the
// next launch resumes here rather than believing setup succeeded.
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { usePythinkerWebClient } from '../../composables/usePythinkerWebClient';
import type { AppModel } from '../../api/types';
import PythinkerLogo from '../PythinkerLogo.vue';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import AddProviderFlow from './AddProviderFlow.vue';
import CodexSignIn from './CodexSignIn.vue';
import Onboarding from './Onboarding.vue';

const emit = defineEmits<{ complete: [] }>();
const { t } = useI18n();
const client = usePythinkerWebClient();

type Step = 'connect' | 'model' | 'appearance';
type ConnectRoute = 'codex' | 'catalog' | 'manual';

const step = ref<Step>('connect');
const route = ref<ConnectRoute | null>(null);
const selectedModel = ref<string | null>(null);
const showAllModels = ref(false);
const saving = ref(false);

const STEPS: Step[] = ['connect', 'model', 'appearance'];
const stepIndex = computed(() => STEPS.indexOf(step.value));

/** Models that can actually run a conversation. A model advertising
 *  capabilities without tool use is an embedding, rerank or vision-only entry
 *  and would leave the user with a default that cannot serve a turn; one
 *  advertising nothing at all is simply unknown, so it stays offered. */
const usableModels = computed<AppModel[]>(() =>
  (client.models.value ?? []).filter(
    (model) =>
      model.capabilities === undefined ||
      model.capabilities.length === 0 ||
      model.capabilities.some((entry) => entry.trim().toLowerCase() === 'tool_use'),
  ),
);

/** Whatever the daemon adopted as its default. Treating that as the
 *  recommendation keeps the ranking policy in one place — the server — instead
 *  of reimplementing it here and drifting from it. */
const recommendedId = computed(() => client.defaultModel.value ?? undefined);

const orderedModels = computed<AppModel[]>(() => {
  const recommended = recommendedId.value;
  return usableModels.value.toSorted((a, b) => {
    if (a.id === recommended) return -1;
    if (b.id === recommended) return 1;
    return b.maxContextSize - a.maxContextSize || a.id.localeCompare(b.id);
  });
});

const visibleModels = computed(() =>
  showAllModels.value ? orderedModels.value : orderedModels.value.slice(0, 5),
);

const connectedProvider = computed(() => (client.providers.value ?? [])[0]?.id ?? '');

/** Connecting is only finished once a usable model exists — a provider saved
 *  with nothing runnable behind it must not advance the wizard. */
const canLeaveConnect = computed(() => client.authReady.value && usableModels.value.length > 0);
const canLeaveModel = computed(() => selectedModel.value !== null);

watch(
  [recommendedId, usableModels],
  () => {
    if (selectedModel.value !== null) return;
    selectedModel.value = recommendedId.value ?? usableModels.value[0]?.id ?? null;
  },
  { immediate: true },
);

function goToModel(): void {
  if (!canLeaveConnect.value) return;
  step.value = 'model';
}

async function goToAppearance(): Promise<void> {
  const model = selectedModel.value;
  if (model === null || saving.value) return;
  saving.value = true;
  try {
    if (model !== client.defaultModel.value) {
      await client.updateConfig({ defaultModel: model });
    }
    // Re-read rather than trust the write: the step must not advance on a
    // default the daemon did not actually accept.
    await client.refreshRuntimeState();
    if (client.authReady.value) step.value = 'appearance';
  } finally {
    saving.value = false;
  }
}

function finish(): void {
  client.setOnboarded(true);
  emit('complete');
}

function selectRoute(next: ConnectRoute): void {
  route.value = next;
}

async function onProviderAdded(): Promise<void> {
  await client.refreshRuntimeState();
  if (canLeaveConnect.value) goToModel();
}
</script>

<template>
  <div class="first-run" role="dialog" aria-modal="true" :aria-label="t('firstRun.connect.title')">
    <div class="first-run__panel">
      <ol class="first-run__steps">
        <li
          v-for="(name, index) in STEPS"
          :key="name"
          class="first-run__step"
          :class="{ 'is-current': index === stepIndex, 'is-done': index < stepIndex }"
        >
          <span class="first-run__dot">{{ index < stepIndex ? '✓' : index + 1 }}</span>
          <span>{{ t(`firstRun.steps.${name}`) }}</span>
        </li>
      </ol>

      <!-- Step 1 — Connect -->
      <section v-if="step === 'connect'" class="first-run__body">
        <PythinkerLogo class="first-run__mark" size="lg" :animated="false" label="Pythinker Code" />
        <h1>{{ t('firstRun.connect.title') }}</h1>
        <p class="first-run__sub">{{ t('firstRun.connect.subtitle') }}</p>

        <div v-if="route === null" class="first-run__options">
          <button
            type="button"
            class="first-run__option is-primary"
            data-testid="first-run-route-codex"
            @click="selectRoute('codex')"
          >
            <span class="first-run__option-main">
              <span class="first-run__option-name">{{ t('firstRun.connect.codexName') }}</span>
              <span class="first-run__option-desc">{{ t('firstRun.connect.codexDesc') }}</span>
            </span>
            <span class="first-run__badge">{{ t('firstRun.connect.codexBadge') }}</span>
          </button>
          <button
            type="button"
            class="first-run__option"
            data-testid="first-run-route-catalog"
            @click="selectRoute('catalog')"
          >
            <span class="first-run__option-main">
              <span class="first-run__option-name">{{ t('firstRun.connect.catalogName') }}</span>
              <span class="first-run__option-desc">{{ t('firstRun.connect.catalogDesc') }}</span>
            </span>
            <Icon name="chevron-right" size="sm" />
          </button>
          <button
            type="button"
            class="first-run__option"
            data-testid="first-run-route-manual"
            @click="selectRoute('manual')"
          >
            <span class="first-run__option-main">
              <span class="first-run__option-name">{{ t('firstRun.connect.manualName') }}</span>
              <span class="first-run__option-desc">{{ t('firstRun.connect.manualDesc') }}</span>
            </span>
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>

        <div v-else class="first-run__route">
          <CodexSignIn v-if="route === 'codex'" @connected="onProviderAdded" />
          <AddProviderFlow
            v-else
            :config="client.config.value"
            :initial-source="route === 'manual' ? 'manual' : 'catalog'"
            @added="onProviderAdded"
            @cancel="route = null"
          />
          <Button variant="ghost" size="sm" @click="route = null">
            {{ t('firstRun.connect.back') }}
          </Button>
        </div>

        <div v-if="canLeaveConnect" class="first-run__actions">
          <span class="first-run__spacer" />
          <Button variant="primary" data-testid="first-run-connect-continue" @click="goToModel">
            {{ t('firstRun.continue') }}
          </Button>
        </div>
      </section>

      <!-- Step 2 — Model -->
      <section v-else-if="step === 'model'" class="first-run__body">
        <h1>{{ t('firstRun.model.title') }}</h1>
        <p class="first-run__sub">
          {{ t('firstRun.model.connected', { provider: connectedProvider, count: usableModels.length }) }}
          {{ t('firstRun.model.subtitle') }}
        </p>

        <p v-if="usableModels.length === 0" class="first-run__empty">{{ t('firstRun.model.none') }}</p>
        <ul v-else class="first-run__models">
          <li v-for="model in visibleModels" :key="model.id">
            <button
              type="button"
              class="first-run__model"
              :class="{ 'is-selected': selectedModel === model.id }"
              :data-testid="`first-run-model-${model.id}`"
              @click="selectedModel = model.id"
            >
              <span class="first-run__radio" aria-hidden="true" />
              <span class="first-run__model-id">{{ model.id }}</span>
              <span v-if="model.id === recommendedId" class="first-run__badge">
                {{ t('firstRun.model.recommended') }}
              </span>
              <span class="first-run__model-ctx">{{ Math.round(model.maxContextSize / 1000) }}K</span>
            </button>
          </li>
        </ul>
        <Button
          v-if="orderedModels.length > 5"
          variant="ghost"
          size="sm"
          @click="showAllModels = !showAllModels"
        >
          {{ showAllModels ? t('firstRun.model.showFewer') : t('firstRun.model.showAll', { count: orderedModels.length }) }}
        </Button>

        <div class="first-run__actions">
          <Button variant="secondary" @click="step = 'connect'">{{ t('firstRun.back') }}</Button>
          <span class="first-run__spacer" />
          <Button
            variant="primary"
            :loading="saving"
            :disabled="!canLeaveModel"
            data-testid="first-run-model-continue"
            @click="goToAppearance"
          >
            {{ t('firstRun.continue') }}
          </Button>
        </div>
      </section>

      <!-- Step 3 — Appearance -->
      <section v-else class="first-run__body">
        <h1>{{ t('firstRun.appearance.title') }}</h1>
        <p class="first-run__sub">{{ t('firstRun.appearance.subtitle') }}</p>

        <Onboarding embedded @complete="finish" @skip="finish" />

        <p class="first-run__ready">
          <Icon name="circle-check" size="sm" />
          <span>{{ t('firstRun.appearance.ready', { model: selectedModel ?? '' }) }}</span>
        </p>

        <div class="first-run__actions">
          <Button variant="secondary" @click="step = 'model'">{{ t('firstRun.back') }}</Button>
          <span class="first-run__spacer" />
          <Button variant="primary" data-testid="first-run-finish" @click="finish">
            {{ t('firstRun.appearance.finish') }}
          </Button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.first-run {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--bg);
  color: var(--color-text);
  overflow-y: auto;
}
.first-run__panel { width: min(560px, 100%); display: flex; flex-direction: column; gap: 22px; }
.first-run__steps { display: flex; align-items: center; gap: 14px; list-style: none; margin: 0; padding: 0; }
.first-run__step { display: flex; align-items: center; gap: 7px; font-size: var(--ui-font-size-sm); color: var(--faint); }
.first-run__step.is-current { color: var(--color-text); }
.first-run__step.is-done { color: var(--ok); }
.first-run__dot {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: var(--radius-full);
  border: 1.5px solid currentColor;
  font-size: 10px;
  font-weight: var(--weight-medium);
}
.first-run__step.is-current .first-run__dot { background: var(--blue); border-color: var(--blue); color: #fff; }
.first-run__step.is-done .first-run__dot { background: var(--ok); border-color: var(--ok); color: #fff; }
.first-run__body { display: flex; flex-direction: column; gap: 14px; align-items: flex-start; }
.first-run__body h1 { margin: 0; font-size: 24px; font-weight: 500; line-height: 1.2; }
.first-run__mark { margin-bottom: 4px; }
.first-run__sub { margin: 0; color: var(--dim); font-size: var(--ui-font-size); line-height: 1.55; }
.first-run__options { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.first-run__option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 13px 15px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg);
  cursor: pointer;
}
.first-run__option:hover { background: var(--hover); }
.first-run__option.is-primary { border-color: var(--bd); background: var(--bluebg); }
.first-run__option-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.first-run__option-name { font-size: var(--ui-font-size); font-weight: var(--weight-medium); }
.first-run__option-desc { font-size: var(--ui-font-size-sm); color: var(--muted); }
.first-run__badge {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--blue);
  color: #fff;
  font-size: var(--ui-font-size-xs);
  font-weight: var(--weight-medium);
}
.first-run__route { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.first-run__models { list-style: none; margin: 0; padding: 0; width: 100%; border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
.first-run__models li + li .first-run__model { border-top: 1px solid var(--line2); }
.first-run__model {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  cursor: pointer;
  font-family: var(--mono);
  font-size: var(--ui-font-size-sm);
  text-align: left;
}
.first-run__model:hover { background: var(--hover); }
.first-run__model.is-selected { background: var(--bluebg); }
.first-run__radio { width: 14px; height: 14px; flex: none; border-radius: var(--radius-full); border: 1.5px solid var(--line); }
.first-run__model.is-selected .first-run__radio { border-color: var(--blue); border-width: 4.5px; }
.first-run__model-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.first-run__model-ctx { margin-left: auto; flex: none; font-family: var(--sans); font-size: var(--ui-font-size-xs); color: var(--muted); }
.first-run__empty { margin: 0; color: var(--warn); font-size: var(--ui-font-size); }
.first-run__ready { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--ok); font-size: var(--ui-font-size-sm); }
.first-run__actions { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px; }
.first-run__spacer { flex: 1; }
</style>
