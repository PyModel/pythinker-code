import type { UIStep, UISubagentStatus } from "@/stores/chat.store";

export interface WorkflowLane {
  agentId: string;
  label?: string;
  index?: number;
  steps: UIStep[];
  stepCount: number;
  status: UISubagentStatus["status"];
  startedAt?: number;
  endedAt?: number;
  error?: string;
  resultSummary?: string;
}

/** Groups a DynamicWorkflow tool item's flat `subagent_steps` into per-agent lanes for WorkflowCard. */
export function deriveWorkflowLanes(steps: UIStep[], statuses: Record<string, UISubagentStatus>): WorkflowLane[] {
  const byAgent = new Map<string, UIStep[]>();

  for (const step of steps) {
    const agentId = step.agentId ?? "";
    const agentSteps = byAgent.get(agentId) ?? [];
    agentSteps.push(step);
    byAgent.set(agentId, agentSteps);
  }
  // A queued agent may have a status entry before it has produced a single step.
  for (const agentId of Object.keys(statuses)) {
    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, []);
    }
  }

  const lanes: WorkflowLane[] = [];
  for (const [agentId, agentSteps] of byAgent) {
    const status = statuses[agentId];
    const firstStep = agentSteps[0];
    lanes.push({
      agentId,
      label: status?.label ?? firstStep?.agentLabel,
      index: status?.index ?? firstStep?.agentIndex,
      steps: agentSteps,
      stepCount: agentSteps.length,
      // `subagent.spawned` always precedes every other lifecycle event (see
      // event-adapter.ts), so a lane with steps always has a status entry by
      // the time this runs. This fallback is unreachable in practice; kept
      // only because `statuses[agentId]` is not statically narrowed.
      status: status?.status ?? "running",
      startedAt: status?.startedAt,
      endedAt: status?.endedAt,
      error: status?.error,
      resultSummary: status?.resultSummary,
    });
  }

  lanes.sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER));
  return lanes;
}

/** The comparative-fill denominator: the busiest lane's step count. There is no
 * per-agent step total, so progress bars read relative to each other, not absolute. */
export function maxLaneStepCount(lanes: readonly WorkflowLane[]): number {
  return lanes.reduce((max, lane) => Math.max(max, lane.stepCount), 0);
}
