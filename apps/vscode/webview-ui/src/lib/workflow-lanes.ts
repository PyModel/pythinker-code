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

/** A lane that reported an outcome. Anything else is still owed one. */
export function isLaneSettled(lane: Pick<WorkflowLane, "status">): boolean {
  return lane.status === "done" || lane.status === "failed";
}

/**
 * The lanes a finished workflow never got an outcome from.
 *
 * Empty while the workflow is still going — a lane that has not reported yet is
 * simply still working. Once the tool call has returned nothing is running any
 * more, so a lane still marked `running` was cancelled or cut off with the turn,
 * and showing it as live is the card reporting work that already stopped.
 */
export function abandonedLanes(lanes: readonly WorkflowLane[], workflowEnded: boolean): WorkflowLane[] {
  return workflowEnded ? lanes.filter((lane) => !isLaneSettled(lane)) : [];
}
