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
 * - When a parsed result is also present, append result rows that no member
 *   covers — e.g. interrupted dynamic workflows emit `state="not_started"` /
 *   `outcome="aborted"` entries for items that never spawned a task, which
 *   would otherwise be invisible until a refresh dropped the live tasks.
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
    .filter(
      (sub) =>
        (sub.outcome === 'aborted' || sub.state === 'not_started') &&
        !members.some((m) => memberCoversResult(m, sub)),
    )
    .map((sub, i) => resultRow(sub, i));

  return memberRows.length > 0 ? [...memberRows, ...resultOnly] : result.subagents.map((s, i) => resultRow(s, i));
}
