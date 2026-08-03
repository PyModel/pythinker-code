import type { AppSubagentPhase, AppTask } from '../api/types';

export interface DynamicWorkflowMember {
  id: string;
  name: string;
  subagentType?: string;
  phase: AppSubagentPhase;
  summary?: string;
  outputLines?: string[];
  suspendedReason?: string;
  dynamicWorkflowIndex: number;
}

export interface DynamicWorkflowGroup {
  id: string;
  members: DynamicWorkflowMember[];
  counts: Record<AppSubagentPhase, number>;
}

const PHASES: readonly AppSubagentPhase[] = ['queued', 'working', 'suspended', 'completed', 'failed'];

function phaseForTask(task: AppTask): AppSubagentPhase {
  if (task.subagentPhase) return task.subagentPhase;
  if (task.status === 'completed') return 'completed';
  if (task.status === 'failed') return 'failed';
  return 'working';
}

function emptyCounts(): Record<AppSubagentPhase, number> {
  return {
    queued: 0,
    working: 0,
    suspended: 0,
    completed: 0,
    failed: 0,
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
      phase: phaseForTask(task),
      summary: task.outputPreview,
      outputLines: task.outputLines,
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
      if (phase === 'completed' || phase === 'failed') done += group.counts[phase];
    }
  }
  return { done, total };
}
