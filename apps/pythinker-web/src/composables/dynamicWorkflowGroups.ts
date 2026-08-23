import type { AppSubagentPhase, AppTask } from '../api/types';

export interface DynamicWorkflowMember {
  id: string;
  name: string;
  subagentType?: string;
  model?: string;
  thinkingEffort?: string;
  phase: AppSubagentPhase;
  summary?: string;
  outputLines?: string[];
  /** Accumulated streaming text (text-kind taskProgress) — preferred over
   *  outputLines/summary when rendering the live dynamic_workflow row activity/body. */
  text?: string;
  suspendedReason?: string;
  dynamicWorkflowIndex: number;
}

export interface DynamicWorkflowGroup {
  id: string;
  members: DynamicWorkflowMember[];
  counts: Record<AppSubagentPhase, number>;
}

const PHASES: readonly AppSubagentPhase[] = ['queued', 'working', 'suspended', 'completed', 'failed', 'cancelled'];

export function phaseForTask(task: AppTask): AppSubagentPhase {
  // Terminal statuses are authoritative over a possibly-stale subagentPhase: a
  // cancelled task keeps whatever phase it last had (e.g. 'working'), which
  // would otherwise keep it "live" and suppress the finished dynamic_workflow card forever.
  if (task.status === 'completed') return 'completed';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.subagentPhase) return task.subagentPhase;
  return 'working';
}

function emptyCounts(): Record<AppSubagentPhase, number> {
  return {
    queued: 0,
    working: 0,
    suspended: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
}

export function buildDynamicWorkflowGroups(tasks: AppTask[]): DynamicWorkflowGroup[] {
  const buckets = new Map<string, DynamicWorkflowMember[]>();

  for (const task of tasks) {
    if (task.kind !== 'subagent' || task.dynamicWorkflowIndex === undefined) continue;
    const key = task.parentToolCallId ?? 'dynamic-workflow';
    const list = buckets.get(key) ?? [];
    list.push({
      id: task.id,
      name: task.description,
      subagentType: task.subagentType,
      model: task.model,
      thinkingEffort: task.thinkingEffort,
      phase: phaseForTask(task),
      summary: task.outputPreview,
      outputLines: task.outputLines,
      text: task.text,
      suspendedReason: task.suspendedReason,
      dynamicWorkflowIndex: task.dynamicWorkflowIndex,
    });
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .map(([id, members]) => {
      const sorted = members.toSorted((a, b) => a.dynamicWorkflowIndex - b.dynamicWorkflowIndex || a.id.localeCompare(b.id));
      const counts = emptyCounts();
      for (const member of sorted) counts[member.phase]++;
      return { id, members: sorted, counts };
    })
    .filter((group) => group.members.length > 1)
    .toSorted((a, b) => {
      const ai = a.members.at(0)?.dynamicWorkflowIndex ?? 0;
      const bi = b.members.at(0)?.dynamicWorkflowIndex ?? 0;
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
}

export function countDynamicWorkflowMembers(groups: DynamicWorkflowGroup[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const group of groups) {
    total += group.members.length;
    for (const phase of PHASES) {
      if (phase === 'completed' || phase === 'failed' || phase === 'cancelled') done += group.counts[phase];
    }
  }
  return { done, total };
}

/**
 * Bucket foreground/background subagent tasks by their spawning tool call and
 * return one member list per AgentDynamicWorkflow call. Unlike buildDynamicWorkflowGroups this keeps
 * single-member "dynamic workflows" (e.g. AgentDynamicWorkflow used with one resume_agent_ids entry),
 * so the inline card can show a resumed subagent's live progress before the
 * structured result arrives. Also includes subagents without a dynamicWorkflowIndex so a
 * late-synced task still appears (sorted last).
 */
export function dynamicWorkflowMembersByToolCall(tasks: AppTask[]): Map<string, DynamicWorkflowMember[]> {
  const buckets = new Map<string, DynamicWorkflowMember[]>();
  for (const task of tasks) {
    if (task.kind !== 'subagent' || !task.parentToolCallId) continue;
    const list = buckets.get(task.parentToolCallId) ?? [];
    list.push({
      id: task.id,
      name: task.description,
      subagentType: task.subagentType,
      model: task.model,
      thinkingEffort: task.thinkingEffort,
      phase: phaseForTask(task),
      summary: task.outputPreview,
      outputLines: task.outputLines,
      text: task.text,
      suspendedReason: task.suspendedReason,
      dynamicWorkflowIndex: task.dynamicWorkflowIndex ?? Number.MAX_SAFE_INTEGER,
    });
    buckets.set(task.parentToolCallId, list);
  }
  for (const [key, members] of buckets) {
    buckets.set(
      key,
      members.toSorted((a, b) => a.dynamicWorkflowIndex - b.dynamicWorkflowIndex || a.id.localeCompare(b.id)),
    );
  }
  return buckets;
}
