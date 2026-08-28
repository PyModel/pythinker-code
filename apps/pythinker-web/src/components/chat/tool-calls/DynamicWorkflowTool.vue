<!-- apps/pythinker-web/src/components/chat/tool-calls/DynamicWorkflowTool.vue -->
<!-- A single AgentDynamicWorkflow tool call, rendered as one inline "operation card".
     Expanded by default while the dynamic_workflow runs, collapsed once settled; when
     opened the body shows the routing line (MAIN vs SUBAGENTS + provenance), a
     segmented progress strip and the members grouped by phase — each subagent
     is a row (state dot + name + activity + profile · model · effort + elapsed
     + provenance word + phase). While the dynamic_workflow runs the rows come from
     the AppTask store (`resolveDynamicWorkflowMembers`); after the tool result
     lands — and after a refresh drops the live tasks — the same rows come from
     the durable `<agent_dynamic_workflow_result>` payload, which carries the
     same binding facts. The card only renders facts; it never infers a
     routing decision. See §04 tool-calls. -->
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FilePreviewRequest, ToolCall, ToolMedia } from '../../../types';
import type { AppSubagentModelSource, AppSubagentPhase, AppSubagentRouting } from '../../../api/types';
import type { DynamicWorkflowMember } from '../../../composables/dynamicWorkflowGroups';
import { toolLabel } from '../../../lib/toolMeta';
import { parseDynamicWorkflowResult } from '../../../lib/parseDynamicWorkflowResult';
import {
  buildDynamicWorkflowCardRows,
  DYNAMIC_WORKFLOW_SEGMENT_CELL_MAX,
  type DynamicWorkflowCardRow,
  dynamicWorkflowRowElapsedMs,
  formatElapsed,
  groupDynamicWorkflowRows,
} from '../../../lib/dynamicWorkflowCardRows';
import Icon from '../../ui/Icon.vue';
import StatusDot from '../../ui/StatusDot.vue';
import Tooltip from '../../ui/Tooltip.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    tool: ToolCall;
    mobile?: boolean;
    stackPosition?: 'single' | 'first' | 'middle' | 'last';
    toolDiffPanel?: boolean;
  }>(),
  { mobile: false, stackPosition: 'single', toolDiffPanel: false },
);

const emit = defineEmits<{
  openMedia: [media: ToolMedia];
  openFile: [target: FilePreviewRequest];
  openToolDiff: [id: string];
  openAgent: [toolCallId: string];
}>();

interface DynamicWorkflowInput {
  description?: string;
  itemCount?: number;
}

function parseInput(arg: string): DynamicWorkflowInput {
  if (!arg) return {};
  try {
    const obj = JSON.parse(arg) as Record<string, unknown>;
    const items = Array.isArray(obj['items']) ? obj['items'] : undefined;
    return {
      description: typeof obj['description'] === 'string' ? obj['description'] : undefined,
      itemCount: items?.length,
    };
  } catch {
    return {};
  }
}

const resolveDynamicWorkflowMembers =
  inject<(toolCallId: string) => DynamicWorkflowMember[] | undefined>('resolveDynamicWorkflowMembers');
const modelDisplay = inject<(modelId: string | undefined) => string | undefined>('modelDisplay');
const subagentEffort = inject<(effort: string | undefined) => string | undefined>('subagentEffort');
/** The session's own binding, so the routing line can show MAIN next to SUBAGENTS. */
const mainModelBinding = inject<(() => { model?: string; effort?: string } | undefined) | undefined>('mainModelBinding');
/** Opens Settings → Agent (the routing policy lives there). */
const openAgentSettings = inject<(() => void) | undefined>('openAgentSettings');

const input = computed(() => parseInput(props.tool.arg));
const label = computed(() => toolLabel(props.tool.name));
const description = computed(() => input.value.description ?? '');
const members = computed(() => resolveDynamicWorkflowMembers?.(props.tool.id) ?? []);
const result = computed(() => parseDynamicWorkflowResult(props.tool.output));

const status = computed<'running' | 'ok' | 'error'>(() => props.tool.status as 'running' | 'ok' | 'error');
const aggregateStatus = computed<'running' | 'ok' | 'error'>(() => {
  if (status.value === 'running') return 'running';
  // Only real failures turn the card red — aborted/cancelled work is a neutral
  // `cancelled` phase.
  if (status.value === 'error' || (result.value?.failed ?? 0) > 0) return 'error';
  return 'ok';
});

interface PhaseCounts {
  completed: number;
  working: number;
  suspended: number;
  queued: number;
  failed: number;
  cancelled: number;
}

// Rows are the single source of truth: phase counts and totals derive from the
// live members and any not-yet-spawned result entries merged together (see
// buildDynamicWorkflowCardRows).
const rows = computed<DynamicWorkflowCardRow[]>(() => buildDynamicWorkflowCardRows(members.value, result.value));

const counts = computed<PhaseCounts>(() => {
  const c: PhaseCounts = { completed: 0, working: 0, suspended: 0, queued: 0, failed: 0, cancelled: 0 };
  for (const r of rows.value) c[r.phase]++;
  return c;
});

const total = computed(() => (rows.value.length > 0 ? rows.value.length : (input.value.itemCount ?? 0)));
const done = computed(() => counts.value.completed + counts.value.failed + counts.value.cancelled);
const inProgress = computed(() => counts.value.working + counts.value.suspended + counts.value.queued);
const running = computed(() => status.value === 'running' || inProgress.value > 0);

const PHASE_CLASS: Record<AppSubagentPhase, string> = {
  completed: 's-ok',
  working: 's-run',
  suspended: 's-warn',
  failed: 's-fail',
  cancelled: 's-queue',
  queued: 's-queue',
};
const PHASE_ORDER: readonly AppSubagentPhase[] = ['completed', 'working', 'suspended', 'failed', 'cancelled', 'queued'];

interface Segment {
  phase: AppSubagentPhase;
  count: number;
  cls: string;
}

/** 1–12 rows: one cell per task (in row order); more: proportional grouped bar. */
const cellMode = computed(() => rows.value.length > 0 && rows.value.length <= DYNAMIC_WORKFLOW_SEGMENT_CELL_MAX);
const segments = computed<Segment[]>(() =>
  PHASE_ORDER.map((phase) => ({ phase, count: counts.value[phase], cls: PHASE_CLASS[phase] })).filter(
    (s) => s.count > 0,
  ),
);

// ---------------------------------------------------------------------------
// Routing line: MAIN vs SUBAGENTS, derived from the rows' binding facts only.
// ---------------------------------------------------------------------------
function bindingLabel(model: string | undefined, effort: string | undefined): string | undefined {
  const parts = [modelDisplay?.(model), subagentEffort?.(effort)].filter(
    (part): part is string => part !== undefined && part !== '',
  );
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const mainBinding = computed(() => mainModelBinding?.());
const mainLabel = computed(() => bindingLabel(mainBinding.value?.model, mainBinding.value?.effort));

const INHERITING_SOURCES: ReadonlySet<AppSubagentModelSource> = new Set(['caller', 'fork-inherit']);

interface BindingBreakdown {
  label: string;
  count: number;
}

const bindingBreakdown = computed<BindingBreakdown[]>(() => {
  const byLabel = new Map<string, number>();
  for (const row of rows.value) {
    const label = bindingLabel(row.model, row.thinkingEffort);
    if (label === undefined) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }
  return [...byLabel.entries()]
    .map(([label, count]) => ({ label, count }))
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

type SubagentsState =
  | { kind: 'inherit'; label?: string }
  | { kind: 'override'; label: string }
  | { kind: 'mixed'; breakdown: BindingBreakdown[] }
  | undefined;

const subagentsState = computed<SubagentsState>(() => {
  const breakdown = bindingBreakdown.value;
  if (breakdown.length === 0) return undefined;
  if (breakdown.length > 1) return { kind: 'mixed', breakdown };
  const withRouting = rows.value.filter((row) => row.routing !== undefined);
  const allInherit =
    withRouting.length > 0 && withRouting.every((row) => INHERITING_SOURCES.has(row.routing!.modelSource));
  if (allInherit) return { kind: 'inherit', label: breakdown[0]!.label };
  const sameAsMain = mainLabel.value !== undefined && breakdown[0]!.label === mainLabel.value && withRouting.length === 0;
  if (sameAsMain) return { kind: 'inherit', label: breakdown[0]!.label };
  return { kind: 'override', label: breakdown[0]!.label };
});

const firstRouting = computed<AppSubagentRouting | undefined>(() => rows.value.find((row) => row.routing !== undefined)?.routing);

const policyLine = computed(() => {
  const routing = firstRouting.value;
  if (routing === undefined) return undefined;
  return t('tools.dynamic_workflow.policyLine', {
    source: routing.policySource === 'config' ? t('tools.dynamic_workflow.sourceSaved') : t('tools.dynamic_workflow.sourceDefault'),
  });
});

const featureLine = computed(() => {
  const routing = firstRouting.value;
  if (routing === undefined) return undefined;
  const source =
    routing.featureSource === 'env' || routing.featureSource === 'master-env'
      ? t('tools.dynamic_workflow.sourceEnvironment')
      : routing.featureSource === 'config'
        ? t('tools.dynamic_workflow.sourceSaved')
        : t('tools.dynamic_workflow.sourceDefault');
  return t('tools.dynamic_workflow.featureLine', { source });
});

const forced = computed(() => rows.value.some((row) => row.routing?.modelSource === 'policy-force'));

// ---------------------------------------------------------------------------
// Policy-revision notice (E3): only the ambient routingEnvironmentRevision
// decides staleness — never model ids or decision fingerprints.
// ---------------------------------------------------------------------------
const currentRevision = computed<string | undefined>(() => {
  for (let i = rows.value.length - 1; i >= 0; i--) {
    const rev = rows.value[i]!.currentRoutingEnvRevision;
    if (rev !== undefined) return rev;
  }
  return undefined;
});

function createdUnderEarlierRouting(row: DynamicWorkflowCardRow): boolean {
  const current = currentRevision.value;
  return current !== undefined && row.routing !== undefined && row.routing.routingEnvRevision !== current;
}

const staleCount = computed(() => rows.value.filter((row) => createdUnderEarlierRouting(row)).length);

// ---------------------------------------------------------------------------
// Grouping + per-group collapse + elapsed ticker.
// ---------------------------------------------------------------------------
const groups = computed(() => groupDynamicWorkflowRows(rows.value, running.value));
const groupOverrides = ref<Map<AppSubagentPhase, boolean>>(new Map());
function groupExpanded(phase: AppSubagentPhase, fallback: boolean): boolean {
  return groupOverrides.value.get(phase) ?? fallback;
}
function toggleGroup(phase: AppSubagentPhase, fallback: boolean): void {
  groupOverrides.value = new Map([...groupOverrides.value, [phase, !groupExpanded(phase, fallback)]]);
}

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
function syncTicker(): void {
  if (running.value && ticker === undefined) {
    ticker = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  } else if (!running.value && ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
}
watch(running, syncTicker, { immediate: true });
onBeforeUnmount(() => {
  if (ticker !== undefined) clearInterval(ticker);
});

function elapsedLabel(row: DynamicWorkflowCardRow): string | undefined {
  const ms = dynamicWorkflowRowElapsedMs(row, now.value);
  return ms === undefined ? undefined : formatElapsed(ms);
}

function rowMeta(row: DynamicWorkflowCardRow): string | undefined {
  const parts = [row.profile, bindingLabel(row.model, row.thinkingEffort)].filter(
    (part): part is string => part !== undefined && part !== '',
  );
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const PROVENANCE_KEY: Record<AppSubagentModelSource, string> = {
  caller: 'inherited',
  'policy-default': 'policyDefault',
  'policy-pool': 'policyPool',
  'policy-force': 'forced',
  'fork-inherit': 'forked',
  'resume-existing': 'resumeExisting',
};

function provenanceWord(row: DynamicWorkflowCardRow): string | undefined {
  const source = row.routing?.modelSource;
  return source === undefined ? undefined : t(`tools.dynamic_workflow.provenance.${PROVENANCE_KEY[source]}`);
}

// Running dynamic workflows start expanded so live progress is visible without a click;
// settled cards (history, finished runs) stay collapsed — §04 tool rows
// expand on demand. The default applies only at mount; manual toggles stick.
const open = ref(status.value === 'running' || inProgress.value > 0);
function toggle(): void {
  open.value = !open.value;
}

// When AgentDynamicWorkflow produces no structured result but the tool is no longer
// running — e.g. argument validation bailing before renderDynamicWorkflowResults, or an
// unrecognized legacy output — show the raw tool output instead of the
// "waiting" placeholder so the user sees the final text / failure cause.
const fallbackOutput = computed(() => {
  if (rows.value.length > 0 || result.value) return '';
  if (status.value === 'running') return '';
  return (props.tool.output ?? []).join('\n').trim();
});

// Per-row accordion: each member expands on its own, leaving the rest folded.
const openRows = ref<Set<string>>(new Set());
function toggleRow(id: string): void {
  const next = new Set(openRows.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openRows.value = next;
}
function isRowOpen(id: string): boolean {
  return openRows.value.has(id);
}

function phaseLabel(phase: AppSubagentPhase): string {
  return t(`tools.dynamic_workflow.phase${phase[0]!.toUpperCase()}${phase.slice(1)}`);
}

/** Result-based done summary: cancelled (aborted) entries get their own count
 *  in the header's overview label (the `.lbl` span, not the phase legend). */
const doneSummary = computed(() => {
  if (!result.value) return '';
  const aborted = result.value.aborted ?? 0;
  if (aborted > 0) {
    return t('tools.dynamic_workflow.doneSubWithCancelled', {
      completed: result.value.completed,
      failed: result.value.failed,
      cancelled: aborted,
    });
  }
  return t('tools.dynamic_workflow.doneSub', {
    completed: result.value.completed,
    failed: result.value.failed,
  });
});

// A live member row opens its agent detail in the right side panel (same panel
// AgentTool's "Open" uses — openAgentPanel resolves the task id directly); a
// settled row with a result `agentId` does the same, falling back to the
// inline accordion when there is nothing to open.
function openMember(row: DynamicWorkflowCardRow): void {
  if (row.agentId) {
    emit('openAgent', row.agentId);
    return;
  }
  if (row.live) {
    emit('openAgent', row.id);
    return;
  }
  if (row.body) toggleRow(row.id);
}

/** Settled rows that carry a result agentId keep their saved body reachable via
 *  a dedicated toggle (the head click opens the agent detail instead). */
function rowHasSavedResult(row: DynamicWorkflowCardRow): boolean {
  return row.agentId !== undefined && row.body.length > 0 &&
    (row.phase === 'completed' || row.phase === 'failed' || row.phase === 'cancelled');
}
</script>

<template>
  <div class="dynamic-workflow-card" :class="{ open, err: aggregateStatus === 'error', stacked: stackPosition !== 'single' }">
    <button class="head" type="button" :aria-expanded="open" @click="toggle">
      <Icon class="ic" name="git-pull-request" size="sm" />
      <span class="title">{{ label }}</span>
      <span v-if="description" class="meta">·</span>
      <span v-if="description" class="sum-txt">{{ description }}</span>
      <span class="rt">
        <span v-if="done > 0 || total > 0" class="chip">{{ done }} / {{ total }}</span>
        <span class="status" :class="`status-${aggregateStatus}`">
          <Icon v-if="aggregateStatus === 'ok'" name="check" size="sm" />
          <Icon v-else-if="aggregateStatus === 'error'" name="close" size="sm" />
          <StatusDot v-else status="running" />
          <span class="status-txt">
            {{ aggregateStatus === 'running' ? t('tools.dynamic_workflow.runningSub', { count: inProgress }) : aggregateStatus === 'ok' ? t('tools.dynamic_workflow.phaseCompleted') : t('tools.dynamic_workflow.phaseFailed') }}
          </span>
        </span>
        <span v-if="tool.timing" class="tm">{{ tool.timing }}</span>
      </span>
      <Icon class="car" :name="open ? 'chevron-down' : 'chevron-right'" size="sm" />
    </button>

    <div v-show="open" class="body">
      <div class="overview">
        <div v-if="mainLabel || subagentsState" class="routing" data-testid="routing-line">
          <span v-if="mainLabel" class="routing-seg routing-main">
            <span class="routing-key">{{ t('tools.dynamic_workflow.main') }}</span>
            <span class="routing-val">{{ mainLabel }}</span>
          </span>
          <span v-if="subagentsState" class="routing-seg routing-sub" :data-state="subagentsState.kind">
            <span class="routing-key">{{ t('tools.dynamic_workflow.subagents') }}</span>
            <template v-if="subagentsState.kind === 'inherit'">
              <span class="routing-val">{{ t('tools.dynamic_workflow.inherit') }}<template v-if="subagentsState.label"> → {{ subagentsState.label }}</template></span>
            </template>
            <template v-else-if="subagentsState.kind === 'override'">
              <span class="routing-val">{{ subagentsState.label }} · {{ t('tools.dynamic_workflow.override') }}</span>
            </template>
            <template v-else>
              <span class="routing-val">{{ t('tools.dynamic_workflow.mixed', { count: subagentsState.breakdown.length }) }}</span>
              <span class="routing-breakdown">
                <span v-for="entry in subagentsState.breakdown" :key="entry.label" class="routing-bd">{{ entry.count }} {{ entry.label }}</span>
              </span>
            </template>
            <button
              v-if="forced && openAgentSettings"
              class="override-chip"
              type="button"
              @click.stop="openAgentSettings()"
            >{{ t('tools.dynamic_workflow.changeInSettings') }}</button>
          </span>
        </div>
        <div v-if="policyLine || featureLine" class="provenance" data-testid="provenance-lines">
          <span v-if="policyLine" class="prov-line" data-testid="policy-line">{{ policyLine }}</span>
          <span v-if="featureLine" class="prov-line" data-testid="feature-line">{{ featureLine }}</span>
        </div>
        <div v-if="running && staleCount > 0" class="notice" data-testid="revision-notice">
          {{ t('tools.dynamic_workflow.revisionNotice', { count: staleCount }) }}
        </div>
        <div class="overview-line">
          <span v-if="aggregateStatus === 'running' && total > 0" class="lbl">
            {{ t('tools.dynamic_workflow.runningSub', { count: inProgress }) }}
          </span>
          <span v-else-if="result" class="lbl">
            {{ doneSummary }}
          </span>
          <span v-else class="lbl">{{ t('tools.dynamic_workflow.waiting') }}</span>
        </div>
        <div v-if="cellMode" class="seg cells" aria-hidden="true" data-testid="segments-cells">
          <span v-for="row in rows" :key="row.id" class="cell" :class="PHASE_CLASS[row.phase]" />
        </div>
        <div v-else-if="total > 0 && segments.length > 0" class="seg grouped" aria-hidden="true" data-testid="segments-grouped">
          <span v-for="s in segments" :key="s.phase" :class="s.cls" :style="{ flex: s.count }" />
        </div>
        <div v-if="segments.length > 1" class="legend">
          <span v-for="s in segments" :key="s.phase">
            <i class="lg-dot" :class="s.cls" />{{ phaseLabel(s.phase) }} {{ s.count }}
          </span>
        </div>
      </div>

      <template v-if="rows.length > 0">
        <section v-for="group in groups" :key="group.phase" class="group" :class="`group-${group.phase}`" :data-phase="group.phase">
          <button
            class="group-head"
            type="button"
            :aria-expanded="groupExpanded(group.phase, group.expanded)"
            @click="toggleGroup(group.phase, group.expanded)"
          >
            <i class="lg-dot" :class="PHASE_CLASS[group.phase]" />
            <span class="group-title">{{ phaseLabel(group.phase) }}</span>
            <span class="group-count">{{ group.rows.length }}</span>
            <span class="group-toggle">{{ groupExpanded(group.phase, group.expanded) ? t('tools.dynamic_workflow.hideGroup') : t('tools.dynamic_workflow.showGroup') }}</span>
          </button>
          <div v-show="groupExpanded(group.phase, group.expanded)" class="group-body">
            <div
              v-for="row in group.rows"
              :key="row.id"
              class="member"
              :class="[`phase-${row.phase}`, { open: isRowOpen(row.id) }]"
            >
              <!-- A row with a resolvable agent (live task or result agentId) opens
                   the agent detail panel; other rows expand inline. -->
              <button
                class="member-head"
                type="button"
                :disabled="!row.live && !row.agentId && !row.body"
                :aria-label="row.live || row.agentId ? t('tasks.openDetail') : undefined"
                :aria-expanded="row.live || row.agentId ? undefined : isRowOpen(row.id)"
                @click="openMember(row)"
              >
                <StatusDot class="row-dot" :class="{ pulse: row.phase === 'working' }" :status="row.phase" />
                <span class="member-main">
                  <span class="member-line">
                    <Tooltip :text="row.name">
                      <span class="mname">{{ row.name }}</span>
                    </Tooltip>
                    <Tooltip v-if="row.activity" :text="row.activity">
                      <span class="mact">{{ row.activity }}</span>
                    </Tooltip>
                  </span>
                  <span v-if="rowMeta(row) || provenanceWord(row) || createdUnderEarlierRouting(row)" class="member-meta">
                    <span v-if="rowMeta(row)" class="mmeta">{{ rowMeta(row) }}</span>
                    <span v-if="provenanceWord(row)" class="mprov" :data-source="row.routing?.modelSource">{{ provenanceWord(row) }}</span>
                    <span v-if="createdUnderEarlierRouting(row)" class="mearlier" data-testid="earlier-routing">
                      {{ t('tools.dynamic_workflow.earlierRouting', { model: mainLabel ?? '—' }) }}
                    </span>
                  </span>
                </span>
                <span v-if="elapsedLabel(row)" class="melapsed">{{ elapsedLabel(row) }}</span>
                <span class="mphase">{{ phaseLabel(row.phase) }}</span>
                <Icon
                  v-if="row.live || row.agentId"
                  class="mcar"
                  name="arrow-right"
                  size="sm"
                />
                <Icon v-else-if="row.body" class="mcar" :name="isRowOpen(row.id) ? 'chevron-down' : 'chevron-right'" size="sm" />
              </button>
              <button
                v-if="rowHasSavedResult(row)"
                class="member-saved"
                type="button"
                :aria-expanded="isRowOpen(row.id)"
                @click="toggleRow(row.id)"
              >
                <Icon class="member-saved-car" :name="isRowOpen(row.id) ? 'chevron-down' : 'chevron-right'" size="sm" />
                <span>{{ t('tools.output.saved') }}</span>
              </button>
              <div v-show="isRowOpen(row.id) && (!row.live && !row.agentId || rowHasSavedResult(row))" class="member-body">{{ row.body }}</div>
            </div>
          </div>
        </section>
      </template>

      <div v-else-if="fallbackOutput" class="fallback-output">{{ fallbackOutput }}</div>

      <div v-else class="waiting">{{ t('tools.dynamic_workflow.waiting') }}</div>
    </div>
  </div>
</template>

<style scoped>
.dynamic-workflow-card {
  margin: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--duration-base) var(--ease-out);
}
.dynamic-workflow-card.err {
  border-color: color-mix(in srgb, var(--color-danger) 25%, var(--bg));
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 0 11px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.head:hover,
.dynamic-workflow-card.open > .head {
  background: var(--color-surface-sunken);
  color: var(--color-text);
}
.dynamic-workflow-card.err > .head {
  background: color-mix(in srgb, var(--color-danger) 4%, var(--bg));
}
.dynamic-workflow-card.err > .head:hover {
  background: color-mix(in srgb, var(--color-danger) 7%, var(--bg));
}
.head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent-soft);
}
.ic {
  color: var(--color-text-faint);
  flex: none;
}
.title {
  font-weight: var(--weight-medium);
  color: var(--color-text);
  flex: none;
}
.meta {
  color: var(--color-text-faint);
  flex: none;
}
.sum-txt {
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.rt {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-line);
}
.status-ok { color: var(--color-success); }
.status-error { color: var(--color-danger); }
.status-running { color: var(--color-accent); }
.status-txt {
  font-size: var(--text-xs);
}
.chip {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}
.tm {
  color: var(--color-text-faint);
  font-family: var(--font-mono);
}
.car {
  margin-left: 2px;
  color: var(--color-text-faint);
  flex: none;
}

.body {
  border-top: 1px solid var(--color-line);
  background: var(--color-surface-sunken);
}

/* Overview strip: routing line + provenance + segmented progress + legend. */
.overview {
  padding: 9px 11px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-line) 70%, transparent);
}
.routing {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-bottom: 6px;
}
.routing-seg {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.routing-key {
  font: var(--text-xs) var(--font-mono);
  letter-spacing: 0.06em;
  color: var(--color-text-faint);
}
.routing-val {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.routing-breakdown {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.routing-bd {
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-muted);
}
.override-chip {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-warning-bd);
  background: var(--color-warning-soft);
  color: var(--color-warning);
  font: var(--text-xs) var(--font-ui);
  cursor: pointer;
}
.override-chip:hover {
  filter: brightness(0.97);
}
.override-chip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-accent-soft);
}
.provenance {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  margin-bottom: 6px;
}
.prov-line {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.notice {
  margin-bottom: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--color-warning-soft);
  border: 1px solid var(--color-warning-bd);
  color: var(--color-warning);
  font-size: var(--text-xs);
}
.overview-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.lbl {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.seg {
  display: flex;
  height: 5px;
  border-radius: var(--radius-full);
  overflow: hidden;
  margin: 8px 0 4px;
  gap: 2px;
}
.seg > span {
  height: 100%;
  border-radius: var(--radius-full);
  min-width: 3px;
}
.seg.cells > .cell {
  flex: 1;
}
.s-ok { background: var(--color-success); }
.s-run { background: var(--color-accent); }
.s-warn { background: var(--color-warning); }
.s-fail { background: var(--color-danger); }
.s-queue { background: var(--color-line); }
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-muted);
}
.lg-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
}

/* Phase groups. */
.group {
  border-bottom: 1px solid color-mix(in srgb, var(--color-line) 70%, transparent);
}
.group:last-child {
  border-bottom: none;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 26px;
  padding: 0 11px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font: var(--text-xs) var(--font-ui);
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.group-head:hover {
  color: var(--color-text);
}
.group-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent-soft);
}
.group-title {
  font-weight: var(--weight-medium);
}
.group-failed .group-title { color: var(--color-danger); }
.group-suspended .group-title { color: var(--color-warning); }
.group-count {
  font-family: var(--font-mono);
  color: var(--color-text-faint);
}
.group-toggle {
  margin-left: auto;
  color: var(--color-text-faint);
}

/* Per-member accordion. */
.member {
  position: relative;
  border-top: 1px solid color-mix(in srgb, var(--color-line) 70%, transparent);
}
.member-saved {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1) var(--space-3);
  border: none;
  border-top: 0.5px solid var(--color-line);
  background: transparent;
  color: var(--color-text-faint);
  font: var(--text-xs) var(--font-ui);
  cursor: pointer;
}
.member-saved:hover {
  background: var(--color-hover);
  color: var(--color-text-muted);
}
.member-saved:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent-soft);
}
.member-saved-car {
  color: var(--color-text-faint);
}
.member-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding: 4px 11px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.member-head:hover,
.member.open .member-head {
  background: color-mix(in srgb, var(--color-surface) 55%, var(--bg));
}
.member-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-accent-soft);
}
.row-dot {
  flex: none;
}
.row-dot.pulse {
  animation: dw-pulse 1.6s ease-in-out infinite;
}
@keyframes dw-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.member-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.member-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.member-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
}
.mname {
  flex: none;
  min-width: 0;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.mact {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.mmeta {
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mprov {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  padding: 0 6px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-line);
}
.mprov[data-source='policy-force'] {
  color: var(--color-warning);
  border-color: var(--color-warning-bd);
}
.mearlier {
  font-size: var(--text-xs);
  color: var(--color-warning);
}
.melapsed {
  flex: none;
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-faint);
}
.mphase {
  flex: none;
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-faint);
}
.phase-completed .mphase { color: var(--color-success); }
.phase-failed .mphase { color: var(--color-danger); }
.phase-working .mphase { color: var(--color-accent); }
.phase-suspended .mphase { color: var(--color-warning); }
.mcar {
  margin-left: 4px;
  color: var(--color-text-faint);
  flex: none;
}
.member-body {
  padding: 4px 11px 10px 31px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.waiting {
  padding: 6px 11px 10px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.fallback-output {
  padding: 9px 11px 10px;
  color: var(--color-text);
  font: var(--text-xs)/1.6 var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
