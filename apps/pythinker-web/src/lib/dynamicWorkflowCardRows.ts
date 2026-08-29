// apps/pythinker-web/src/lib/dynamicWorkflowCardRows.ts
// Build the accordion row model for the AgentDynamicWorkflow inline tool card. Pure
// function of live members (AppTask store, real-time phase) and the parsed
// `<agent_dynamic_workflow_result>` payload (terminal result) — kept in plain TS so it can
// be unit-tested without mounting the component.

import type { AppSubagentPhase, AppSubagentRouting } from '../api/types';
import type { DynamicWorkflowMember } from '../composables/dynamicWorkflowGroups';
import type { DynamicWorkflowResult, DynamicWorkflowResultSubagent } from './parseDynamicWorkflowResult';

export interface DynamicWorkflowCardRow {
  id: string;
  name: string;
  activity: string;
  phase: AppSubagentPhase;
  body: string;
  /** True when the row is backed by a live AppTask (id is a task id), so the
   *  card can open the agent detail side panel for it. Result-only rows
   *  (post-refresh / never-spawned items) have no live task to open. */
  live: boolean;
  /** Agent id from the `<agent_dynamic_workflow_result>` payload, when the result
   *  row corresponds to a real subagent — lets a settled row open the agent
   *  detail panel. */
  agentId?: string;
  /** Binding facts: live members carry them from the task; settled rows read
   *  the durable `<subagent>` attributes. Labels are derived by the component. */
  profile?: string;
  model?: string;
  thinkingEffort?: string;
  routing?: AppSubagentRouting;
  currentRoutingEnvRevision?: string;
  startedAt?: string;
  completedAt?: string;
}

function lastNonEmptyLine(text: string | undefined): string {
  if (!text) return '';
  return text.split('\n').map((l) => l.trimEnd()).filter(Boolean).at(-1) ?? '';
}

export function dynamicWorkflowMemberActivity(member: DynamicWorkflowMember): string {
  // Prefer streamed subagent text so a still-composing agent shows its latest
  // line instead of an empty / last-summary row.
  return (
    member.suspendedReason ||
    lastNonEmptyLine(member.text) ||
    lastNonEmptyLine(member.outputLines?.join('\n')) ||
    member.summary ||
    ''
  );
}

function dynamicWorkflowMemberBody(member: DynamicWorkflowMember): string {
  if (member.suspendedReason) return member.suspendedReason;
  if (member.text) return member.text;
  if (member.outputLines && member.outputLines.length > 0) return member.outputLines.join('\n');
  return member.summary ?? '';
}

function outcomeToPhase(outcome: string): AppSubagentPhase {
  if (outcome === 'completed') return 'completed';
  if (outcome === 'failed') return 'failed';
  // Aborted rows are cancelled work, not failures: they map to the neutral
  // `cancelled` phase. Anything else, not_started included, stays `working`.
  if (outcome === 'aborted' || outcome === 'cancelled') return 'cancelled';
  return 'working';
}

function resultRow(sub: DynamicWorkflowResultSubagent, index: number): DynamicWorkflowCardRow {
  return {
    id: sub.agentId ?? sub.item ?? `result-${index}`,
    name: sub.item ?? `subagent ${index + 1}`,
    activity: sub.body.split('\n')[0] ?? '',
    phase: outcomeToPhase(sub.outcome),
    body: sub.body,
    live: false,
    agentId: sub.agentId,
    profile: sub.profile,
    model: sub.model,
    thinkingEffort: sub.thinking,
    routing: sub.routing,
    startedAt: sub.startedAt,
    completedAt: sub.completedAt,
  };
}

/**
 * Whether a live member already accounts for a result subagent. Members may
 * come from the projector (task id / description) while the result references
 * agent_id / item; the two ids don't always match, so also treat item ⊆
 * description as a match.
 */
function memberCoversResult(member: DynamicWorkflowMember, sub: DynamicWorkflowResultSubagent): boolean {
  if (sub.agentId && member.id === sub.agentId) return true;
  if (sub.item && member.name.includes(sub.item)) return true;
  return false;
}

/**
 * Merge the live members with the agent_dynamic_workflow_result payload into one row list.
 *
 * - Members are authoritative while present (real-time phase + streamed text).
 * - When a parsed result is also present, append every result row that no
 *   member covers. This keeps failed starts and interrupted, never-started
 *   items visible while live task rows still exist.
 * - When no members are present (post-refresh), fall back to result-only rows.
 */
export function buildDynamicWorkflowCardRows(members: DynamicWorkflowMember[], result: DynamicWorkflowResult | null): DynamicWorkflowCardRow[] {
  const memberRows = members.map((m) => ({
    id: m.id,
    name: m.name,
    activity: dynamicWorkflowMemberActivity(m),
    phase: m.phase,
    body: dynamicWorkflowMemberBody(m),
    live: true,
    profile: m.subagentType,
    model: m.model,
    thinkingEffort: m.thinkingEffort,
    routing: m.routing,
    currentRoutingEnvRevision: m.currentRoutingEnvRevision,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
  }));
  if (!result) return memberRows;

  const resultOnly = result.subagents
    .filter((sub) => !members.some((m) => memberCoversResult(m, sub)))
    .map((sub, i) => resultRow(sub, i));

  return memberRows.length > 0 ? [...memberRows, ...resultOnly] : result.subagents.map((s, i) => resultRow(s, i));
}

// ---------------------------------------------------------------------------
// Grouping + elapsed time (pure, unit-tested; the component only renders).
// ---------------------------------------------------------------------------

export interface DynamicWorkflowRowGroup {
  phase: AppSubagentPhase;
  rows: DynamicWorkflowCardRow[];
  /** Failed and Suspended always start expanded; Completed starts collapsed
   *  while the workflow still runs so the active rows stay in view. */
  expanded: boolean;
}

const RUNNING_WITH_FAILURES: readonly AppSubagentPhase[] = ['failed', 'suspended', 'working', 'queued', 'completed', 'cancelled'];
const RUNNING_HEALTHY: readonly AppSubagentPhase[] = ['working', 'suspended', 'queued', 'completed', 'cancelled'];
const SETTLED: readonly AppSubagentPhase[] = ['failed', 'suspended', 'cancelled', 'completed', 'working', 'queued'];

/**
 * Severity-aware grouping. Nothing is filtered: every phase that has rows is a
 * group, in the order that matters for the card's state. Running with at least
 * one failure puts Failed first; running healthy leads with Working; a settled
 * workflow leads with Failed and keeps any residual Working/Queued rows visible
 * (a malformed restored state must not hide work).
 */
export function groupDynamicWorkflowRows(rows: DynamicWorkflowCardRow[], running: boolean): DynamicWorkflowRowGroup[] {
  const byPhase = new Map<AppSubagentPhase, DynamicWorkflowCardRow[]>();
  for (const row of rows) {
    const list = byPhase.get(row.phase) ?? [];
    list.push(row);
    byPhase.set(row.phase, list);
  }
  const failed = byPhase.get('failed')?.length ?? 0;
  const order = running ? (failed > 0 ? RUNNING_WITH_FAILURES : RUNNING_HEALTHY) : SETTLED;
  const groups: DynamicWorkflowRowGroup[] = [];
  const seen = new Set<AppSubagentPhase>();
  for (const phase of order) {
    const list = byPhase.get(phase);
    seen.add(phase);
    if (!list || list.length === 0) continue;
    groups.push({ phase, rows: list, expanded: phase !== 'completed' || !running });
  }
  for (const [phase, list] of byPhase) {
    if (seen.has(phase) || list.length === 0) continue;
    groups.push({ phase, rows: list, expanded: true });
  }
  return groups;
}

function parseIso(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Elapsed milliseconds for a row: `now - startedAt` while it is active,
 * `completedAt - startedAt` once settled. Undefined when the row never started
 * or the timestamps are unusable — the card then shows nothing rather than a
 * fake duration.
 */
export function dynamicWorkflowRowElapsedMs(row: Pick<DynamicWorkflowCardRow, 'phase' | 'startedAt' | 'completedAt'>, now: number): number | undefined {
  const started = parseIso(row.startedAt);
  if (started === undefined) return undefined;
  const settled = row.phase === 'completed' || row.phase === 'failed' || row.phase === 'cancelled';
  if (settled) {
    const completed = parseIso(row.completedAt);
    if (completed === undefined) return undefined;
    return Math.max(0, completed - started);
  }
  return Math.max(0, now - started);
}

/** `m:ss` under an hour, `h:mm:ss` above. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/** Segmented progress stays one cell per task up to this many rows; larger
 *  workflows fall back to a proportional grouped bar. */
export const DYNAMIC_WORKFLOW_SEGMENT_CELL_MAX = 12;
