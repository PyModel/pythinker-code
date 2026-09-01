<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppExpertTalkArtifact, AppExpertTalkRun, AppModel } from '../../api/types';
import { copyTextToClipboard } from '../../lib/clipboard';
import { formatTokens } from '../../lib/formatTokens';
import Badge from '../ui/Badge.vue';
import Button from '../ui/Button.vue';
import Icon from '../ui/Icon.vue';
import StatusDot from '../ui/StatusDot.vue';
import Markdown from './Markdown.vue';

const props = withDefaults(defineProps<{
  run: AppExpertTalkRun;
  models?: AppModel[];
}>(), {
  models: () => [],
});
const emit = defineEmits<{
  build: [answer: string];
}>();
const { t } = useI18n();

const isRunning = computed(() => props.run.state === 'running');
const exchangeSummary = computed(() => isRunning.value
  ? t('expertTalk.flowTitle')
  : t('expertTalk.viewExchange'));
const liveAnnouncement = computed(() => t('expertTalk.liveAnnouncement', {
  state: t(`expertTalk.runState.${props.run.state}`),
  stage: t(`expertTalk.stage.${props.run.stage}`),
}));
const runMetrics = computed(() => [
  {
    label: t('expertTalk.metric.requests'),
    value: props.run.usage.requestCount === undefined
      ? t('expertTalk.unavailable')
      : String(props.run.usage.requestCount),
  },
  {
    label: t('expertTalk.metric.attempts'),
    value: props.run.usage.providerAttemptCount === undefined
      ? t('expertTalk.unavailable')
      : String(props.run.usage.providerAttemptCount),
  },
  { label: t('expertTalk.metric.cost'), value: t('expertTalk.unavailable') },
]);

type PhaseState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

function artifactPhase(artifacts: readonly AppExpertTalkArtifact[]): PhaseState {
  if (artifacts.some((artifact) => artifact.state === 'running')) return 'running';
  if (artifacts.some((artifact) => artifact.state === 'failed' || artifact.state === 'cancelled')) {
    return 'failed';
  }
  if (artifacts.length > 0 && artifacts.every((artifact) => artifact.state === 'unavailable')) {
    return 'skipped';
  }
  if (artifacts.every((artifact) =>
    artifact.state === 'completed' || artifact.state === 'unavailable'
  )) {
    return 'completed';
  }
  return 'pending';
}

const phases = computed(() => [
  {
    id: 'opening',
    label: t('expertTalk.opinions'),
    state: artifactPhase([props.run.opening.lead, props.run.opening.peer]),
  },
  {
    id: 'review',
    label: t('expertTalk.review'),
    state: artifactPhase([props.run.review.lead, props.run.review.peer]),
  },
  {
    id: 'fusion',
    label: t('expertTalk.fusion'),
    state: props.run.fusion === undefined
      ? 'pending' as const
      : artifactPhase([props.run.fusion]),
  },
]);

function modelLabel(modelId: string): string {
  const model = props.models.find((candidate) => candidate.id === modelId);
  return model?.displayName ?? model?.model ?? modelId;
}

interface ExchangeStage {
  key: string;
  label: string;
  artifact: AppExpertTalkArtifact;
}

interface ExchangeColumn {
  key: 'lead' | 'peer';
  role: string;
  model: string;
  symbol: '◆' | '▲';
  stages: ExchangeStage[];
  answer?: string;
}

function latestAnswer(...artifacts: AppExpertTalkArtifact[]): string | undefined {
  return artifacts
    .map((artifact) => artifact.text?.trim())
    .find((text): text is string => text !== undefined && text.length > 0);
}

const exchangeColumns = computed<ExchangeColumn[]>(() => [
  {
    key: 'lead',
    role: t('expertTalk.model1'),
    model: modelLabel(props.run.bindings.fusionLead.effectiveModelId),
    symbol: '◆',
    stages: [
      { key: 'lead-opening', label: t('expertTalk.opening'), artifact: props.run.opening.lead },
      { key: 'lead-review', label: t('expertTalk.reviewPeer'), artifact: props.run.review.lead },
    ],
    answer: latestAnswer(props.run.review.lead, props.run.opening.lead),
  },
  {
    key: 'peer',
    role: t('expertTalk.model2'),
    model: modelLabel(props.run.bindings.peer.effectiveModelId),
    symbol: '▲',
    stages: [
      { key: 'peer-opening', label: t('expertTalk.opening'), artifact: props.run.opening.peer },
      { key: 'peer-review', label: t('expertTalk.reviewLead'), artifact: props.run.review.peer },
    ],
    answer: latestAnswer(props.run.review.peer, props.run.opening.peer),
  },
]);

const fusionExchange = computed(() => {
  if (props.run.fusion === undefined && props.run.stage !== 'fusion') return undefined;
  return {
    model: modelLabel(props.run.bindings.fusionLead.effectiveModelId),
    artifact: props.run.fusion,
    state: props.run.fusion?.state ?? 'running' as const,
    answer: props.run.result?.answer.trim() || props.run.fusion?.text?.trim(),
  };
});

type CopyTarget = 'lead' | 'peer' | 'fusion';
const copiedTarget = ref<CopyTarget>();
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function takeAnswer(target: CopyTarget, answer: string): Promise<void> {
  if (!await copyTextToClipboard(answer)) return;
  copiedTarget.value = target;
  if (copiedTimer !== undefined) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTarget.value = undefined;
    copiedTimer = undefined;
  }, 1500);
}

onUnmounted(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer);
});

interface ArtifactMetric {
  label: string;
  value: string;
}

function elapsedSeconds(artifact: AppExpertTalkArtifact): number | undefined {
  if (artifact.startedAt === undefined || artifact.endedAt === undefined) return undefined;
  const startedAt = Date.parse(artifact.startedAt);
  const endedAt = Date.parse(artifact.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return undefined;
  }
  return (endedAt - startedAt) / 1000;
}

function artifactMetrics(artifact: AppExpertTalkArtifact | undefined): ArtifactMetric[] {
  if (artifact === undefined) return [];
  const metrics: ArtifactMetric[] = [];
  const seconds = elapsedSeconds(artifact);
  if (seconds !== undefined) {
    metrics.push({
      label: t('expertTalk.metric.time'),
      value: `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`,
    });
  }
  if (artifact.usage !== undefined) {
    const input = artifact.usage.inputOther
      + artifact.usage.inputCacheRead
      + artifact.usage.inputCacheCreation;
    metrics.push(
      { label: t('expertTalk.metric.input'), value: formatTokens(input) },
      { label: t('expertTalk.metric.output'), value: formatTokens(artifact.usage.output) },
    );
    if (seconds !== undefined && seconds > 0 && artifact.usage.output > 0) {
      metrics.push({
        label: t('expertTalk.metric.tps'),
        value: String(Math.round(artifact.usage.output / seconds)),
      });
    }
  }
  if (artifact.toolCallCount !== undefined) {
    metrics.push({ label: t('expertTalk.metric.tools'), value: String(artifact.toolCallCount) });
  }
  return metrics;
}

function artifactVariant(
  state: AppExpertTalkArtifact['state'],
): 'success' | 'danger' | 'info' | 'neutral' {
  if (state === 'completed') return 'success';
  if (state === 'failed' || state === 'cancelled') return 'danger';
  if (state === 'running') return 'info';
  return 'neutral';
}

function statusVariant(state: AppExpertTalkRun['state']): 'success' | 'danger' | 'info' | 'neutral' {
  if (state === 'completed') return 'success';
  if (state === 'failed' || state === 'cancelled' || state === 'interrupted') return 'danger';
  if (state === 'running') return 'info';
  return 'neutral';
}
</script>

<template>
  <section class="expert-opinion-exchange" :aria-label="t('expertTalk.flowLabel')">
    <p class="expert-talk__sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ liveAnnouncement }}
    </p>
    <details :open="isRunning">
      <summary class="expert-opinion-exchange__top">
        <span class="expert-opinion-exchange__title">
          <span aria-hidden="true">◆</span>
          <span>{{ exchangeSummary }}</span>
        </span>
        <Badge :variant="statusVariant(run.state)" dot>{{ t(`expertTalk.runState.${run.state}`) }}</Badge>
      </summary>

    <ol class="expert-opinion-exchange__phases">
      <li v-for="phase in phases" :key="phase.id" :data-state="phase.state">
        <StatusDot :status="phase.state" />
        <span>{{ phase.label }}</span>
      </li>
    </ol>

    <dl class="expert-talk__run-metrics">
      <div v-for="metric in runMetrics" :key="metric.label">
        <dt>{{ metric.label }}</dt>
        <dd>{{ metric.value }}</dd>
      </div>
    </dl>

    <p v-if="run.resultUnsupported" class="expert-opinion-exchange__error" role="status">
      {{ t('expertTalk.unsupportedResult', { version: run.resultVersion }) }}
    </p>

    <p v-if="run.error" class="expert-opinion-exchange__error" role="alert">
      {{ run.error.message }} {{ run.error.action }}
    </p>

    <div class="expert-talk__agent-grid">
      <article
        v-for="column in exchangeColumns"
        :key="column.key"
        class="expert-talk__agent-column"
        :class="`expert-talk__agent-column--${column.key}`"
        :aria-label="`${column.role}: ${column.model}`"
      >
        <header class="expert-talk__agent-head">
          <span class="expert-talk__agent-symbol" aria-hidden="true">{{ column.symbol }}</span>
          <span class="expert-talk__agent-role">{{ column.role }}</span>
          <span class="expert-talk__agent-model">{{ column.model }}</span>
        </header>
        <section v-for="stageEntry in column.stages" :key="stageEntry.key" class="expert-talk__stage">
          <header class="expert-talk__stage-head">
            <span>{{ stageEntry.label }}</span>
            <Badge size="sm" :variant="artifactVariant(stageEntry.artifact.state)" dot>
              {{ t(`expertTalk.artifactState.${stageEntry.artifact.state}`) }}
            </Badge>
          </header>
          <dl v-if="artifactMetrics(stageEntry.artifact).length > 0" class="expert-talk__metrics">
            <div v-for="metric in artifactMetrics(stageEntry.artifact)" :key="metric.label">
              <dt>{{ metric.label }}</dt>
              <dd>{{ metric.value }}</dd>
            </div>
          </dl>
          <div class="expert-talk__artifact-body">
            <div
              v-if="stageEntry.artifact.thinking || stageEntry.artifact.state === 'running'"
              class="expert-talk__thinking"
            >
              <strong>▹ {{ t('expertTalk.thinking') }}</strong>
              <Markdown
                v-if="stageEntry.artifact.thinking"
                :text="stageEntry.artifact.thinking"
                :streaming="stageEntry.artifact.state === 'running'"
              />
              <span v-else>{{ t('expertTalk.thinkingPending') }}</span>
            </div>
            <ul v-if="stageEntry.artifact.tools?.length" class="expert-talk__tools">
              <li v-for="tool in stageEntry.artifact.tools" :key="tool.id">
                <span aria-hidden="true">▸</span>
                {{ tool.name ?? t('expertTalk.tool') }}
              </li>
            </ul>
            <div v-if="stageEntry.artifact.text" class="expert-talk__artifact-text">
              <Markdown
                :text="stageEntry.artifact.text"
                :streaming="stageEntry.artifact.state === 'running'"
              />
            </div>
            <p v-else-if="stageEntry.artifact.state !== 'running'">
              {{ stageEntry.artifact.error ?? t(`expertTalk.artifactState.${stageEntry.artifact.state}`) }}
            </p>
          </div>
        </section>
        <footer v-if="column.answer" class="expert-talk__agent-actions">
          <Button size="sm" variant="secondary" @click="takeAnswer(column.key, column.answer)">
            <Icon :name="copiedTarget === column.key ? 'check' : 'copy'" size="sm" />
            {{ copiedTarget === column.key
              ? t('expertTalk.copied')
              : t(column.key === 'lead' ? 'expertTalk.takeModel1' : 'expertTalk.takeModel2') }}
          </Button>
        </footer>
      </article>
    </div>

    <article
      v-if="fusionExchange"
      class="expert-talk__fusion"
      :aria-label="`${t('expertTalk.fusion')}: ${fusionExchange.model}`"
    >
      <header class="expert-talk__agent-head">
        <span class="expert-talk__agent-symbol" aria-hidden="true">⧉</span>
        <span class="expert-talk__agent-role">{{ t('expertTalk.fusion') }}</span>
        <span class="expert-talk__agent-model">
          {{ fusionExchange.model }} · {{ t('expertTalk.freshFusion') }}
        </span>
        <Badge size="sm" :variant="artifactVariant(fusionExchange.state)" dot>
          {{ t(`expertTalk.artifactState.${fusionExchange.state}`) }}
        </Badge>
      </header>
      <dl v-if="artifactMetrics(fusionExchange.artifact).length > 0" class="expert-talk__metrics">
        <div v-for="metric in artifactMetrics(fusionExchange.artifact)" :key="metric.label">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
        </div>
      </dl>
      <div class="expert-talk__artifact-body">
        <div
          v-if="fusionExchange.artifact?.thinking || fusionExchange.state === 'running'"
          class="expert-talk__thinking"
        >
          <strong>▹ {{ t('expertTalk.thinking') }}</strong>
          <Markdown
            v-if="fusionExchange.artifact?.thinking"
            :text="fusionExchange.artifact.thinking"
            :streaming="fusionExchange.state === 'running'"
          />
          <span v-else>{{ t('expertTalk.thinkingPending') }}</span>
        </div>
        <ul v-if="fusionExchange.artifact?.tools?.length" class="expert-talk__tools">
          <li v-for="tool in fusionExchange.artifact.tools" :key="tool.id">
            <span aria-hidden="true">▸</span>
            {{ tool.name ?? t('expertTalk.tool') }}
          </li>
        </ul>
        <div v-if="fusionExchange.answer" class="expert-talk__artifact-text">
          <Markdown
            :text="fusionExchange.answer"
            :streaming="fusionExchange.state === 'running'"
          />
        </div>
        <p v-else-if="fusionExchange.state !== 'running'">
          {{ fusionExchange.artifact?.error ?? t(`expertTalk.artifactState.${fusionExchange.state}`) }}
        </p>
      </div>
      <section
        v-if="run.result && (
          run.result.notes.consensus.length > 0 ||
          run.result.notes.divergence.length > 0 ||
          run.result.notes.uncertainty.length > 0
        )"
        class="expert-talk__comparison"
        data-testid="discussion-comparison"
        :aria-label="t('expertTalk.finalComparison')"
      >
        <h3>{{ t('expertTalk.finalComparison') }}</h3>
        <div class="expert-talk__comparison-grid">
          <section
            v-if="run.result.notes.consensus.length > 0"
            class="expert-talk__comparison-card expert-talk__comparison-card--agreement"
          >
            <h4><span aria-hidden="true">✓</span>{{ t('expertTalk.agreement') }}</h4>
            <ul>
              <li v-for="item in run.result.notes.consensus" :key="item">
                <Markdown :text="item" />
              </li>
            </ul>
          </section>
          <section
            v-if="run.result.notes.divergence.length > 0"
            class="expert-talk__comparison-card expert-talk__comparison-card--difference"
          >
            <h4><span aria-hidden="true">↔</span>{{ t('expertTalk.differences') }}</h4>
            <ul>
              <li v-for="item in run.result.notes.divergence" :key="item">
                <Markdown :text="item" />
              </li>
            </ul>
          </section>
          <section
            v-if="run.result.notes.uncertainty.length > 0"
            class="expert-talk__comparison-card expert-talk__comparison-card--uncertainty"
          >
            <h4><span aria-hidden="true">?</span>{{ t('expertTalk.uncertainty') }}</h4>
            <ul>
              <li v-for="item in run.result.notes.uncertainty" :key="item">
                <Markdown :text="item" />
              </li>
            </ul>
          </section>
        </div>
      </section>
      <footer v-if="fusionExchange.answer" class="expert-talk__fusion-actions">
        <Button size="sm" variant="secondary" @click="takeAnswer('fusion', fusionExchange.answer)">
          <Icon :name="copiedTarget === 'fusion' ? 'check' : 'copy'" size="sm" />
          {{ copiedTarget === 'fusion' ? t('expertTalk.copied') : t('expertTalk.takeFusion') }}
        </Button>
        <Button size="sm" data-testid="expert-opinion-build" @click="emit('build', fusionExchange.answer)">
          <Icon name="play" size="sm" />
          {{ t('expertTalk.buildFusion') }}
        </Button>
      </footer>
    </article>
    </details>
  </section>
</template>

<style scoped>
.expert-opinion-exchange {
  min-width: 0;
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-sunken);
  overflow: hidden;
}

.expert-opinion-exchange__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--p-hairline) solid var(--color-line);
  background: var(--color-surface-raised);
}

summary.expert-opinion-exchange__top {
  cursor: pointer;
  list-style: none;
}

summary.expert-opinion-exchange__top::-webkit-details-marker {
  display: none;
}

.expert-opinion-exchange__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: color-mix(in srgb, var(--color-accent) 75%, var(--color-text-strong));
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.expert-opinion-exchange :deep(.ui-badge--danger) {
  color: color-mix(in srgb, var(--color-danger) 70%, var(--color-text-strong));
}

.expert-opinion-exchange__phases {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  margin: 0;
  border-bottom: var(--p-hairline) solid var(--color-line);
  list-style: none;
}

.expert-opinion-exchange__phases li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.expert-opinion-exchange__error {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--p-hairline) solid var(--color-line);
  color: var(--color-danger);
  font-size: var(--text-sm);
}

.expert-talk__run-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) var(--space-4);
  margin: 0;
  border-bottom: var(--p-hairline) solid var(--color-line);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.expert-talk__run-metrics div {
  display: flex;
  gap: var(--space-1);
}

.expert-talk__run-metrics dt {
  color: var(--color-text-faint);
}

.expert-talk__run-metrics dd {
  margin: 0;
  color: var(--color-text);
}

.expert-talk__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.expert-talk__agent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}

.expert-talk__agent-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.expert-talk__agent-column + .expert-talk__agent-column {
  border-left: var(--p-hairline) solid var(--color-line);
}

.expert-talk__agent-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--p-hairline) solid var(--color-line);
  background: var(--color-surface-raised);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.expert-talk__agent-symbol,
.expert-talk__agent-role {
  flex: none;
}

.expert-talk__agent-role {
  color: var(--color-text);
  font-weight: var(--weight-semibold);
}

.expert-talk__agent-model {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expert-talk__agent-column--lead .expert-talk__agent-symbol {
  color: #a78bfa;
}

.expert-talk__agent-column--peer .expert-talk__agent-symbol {
  color: #f59e0b;
}

.expert-talk__stage {
  min-width: 0;
  padding: var(--space-4);
}

.expert-talk__stage + .expert-talk__stage {
  border-top: var(--p-hairline) solid var(--color-line);
}

.expert-talk__stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.expert-talk__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding: 0;
  margin: var(--space-3) 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.expert-talk__metrics div {
  display: inline-flex;
  gap: var(--space-1);
}

.expert-talk__metrics dt {
  color: var(--color-text-faint);
}

.expert-talk__metrics dd {
  margin: 0;
  color: var(--color-text);
}

.expert-talk__artifact-body {
  min-width: 0;
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}

.expert-talk__artifact-body p {
  margin: 0;
  white-space: pre-wrap;
}

.expert-talk__artifact-text {
  min-width: 0;
}

.expert-talk__thinking {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  border-left: 2px solid var(--color-accent);
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
}

.expert-talk__thinking strong {
  color: var(--color-accent);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.expert-talk__tools {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0 0 var(--space-3);
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  list-style: none;
}

.expert-talk__tools li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.expert-talk__tools li span {
  color: var(--color-warning);
}

.expert-talk__agent-actions,
.expert-talk__fusion-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: var(--p-hairline) solid var(--color-line);
}

.expert-talk__agent-actions {
  margin-top: auto;
}

.expert-talk__fusion {
  min-width: 0;
  border-top: var(--p-hairline) solid var(--color-line);
  background: var(--color-surface-raised);
}

.expert-talk__fusion > .expert-talk__agent-head {
  border-bottom: 0;
  background: transparent;
}

.expert-talk__fusion .expert-talk__agent-symbol {
  color: #22d3ee;
}

.expert-talk__fusion .ui-badge {
  margin-left: auto;
}

.expert-talk__fusion > .expert-talk__metrics,
.expert-talk__fusion > .expert-talk__artifact-body {
  margin-right: var(--space-4);
  margin-left: var(--space-4);
}

.expert-talk__fusion > .expert-talk__artifact-body {
  padding-bottom: var(--space-4);
}

.expert-talk__comparison {
  display: grid;
  gap: var(--space-3);
  padding: 0 var(--space-4) var(--space-4);
}

.expert-talk__comparison > h3 {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.expert-talk__comparison-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

.expert-talk__comparison-card {
  min-width: 0;
  padding: var(--space-3);
  border: var(--p-hairline) solid;
  border-left-width: 3px;
  border-radius: var(--radius-md);
}

.expert-talk__comparison-card h4 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.expert-talk__comparison-card ul {
  display: grid;
  gap: var(--space-2);
  padding-left: var(--space-4);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.expert-talk__comparison-card :deep(p) {
  margin: 0;
}

.expert-talk__comparison-card--agreement {
  border-color: var(--color-success-bd);
  border-left-color: var(--color-success);
  background: var(--color-success-soft);
}

.expert-talk__comparison-card--difference {
  border-color: var(--color-warning-bd);
  border-left-color: var(--color-warning);
  background: var(--color-warning-soft);
}

.expert-talk__comparison-card--uncertainty {
  grid-column: 1 / -1;
  border-color: var(--color-accent-bd);
  border-left-color: var(--color-accent);
  background: var(--color-accent-soft);
}

@media (max-width: 720px) {
  .expert-opinion-exchange__phases,
  .expert-talk__agent-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__agent-column + .expert-talk__agent-column {
    border-top: var(--p-hairline) solid var(--color-line);
    border-left: 0;
  }

  .expert-talk__comparison-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .expert-talk__comparison-card--uncertainty {
    grid-column: auto;
  }

}
</style>
