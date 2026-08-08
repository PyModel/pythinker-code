import { useMemo, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { abandonedLanes, deriveWorkflowLanes, isLaneSettled, type WorkflowLane } from "@/lib/workflow-lanes";
import { getToolLabel, parseArgs } from "@/lib/tool-args";
import { SilverSpinner } from "./SilverSpinner";
import type { UIToolCall, UIStep, UIStepItem, UISubagentStatus, UIWorkflowWarning } from "@/stores/chat.store";
import type { ToolResult } from "shared/legacy-sdk";

interface WorkflowCardProps {
  call: UIToolCall;
  result?: ToolResult["return_value"];
  subagentSteps: UIStep[];
  subagentStatus: Record<string, UISubagentStatus>;
  workflowWarning?: UIWorkflowWarning;
  /** Injected by ToolRenderers: tool rendering is mutually recursive, and importing
   * it here would close an import cycle that oxlint rejects. */
  renderStepItem: (item: UIStepItem) => ReactNode;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}` : `${seconds}s`;
}

function laneLabel(lane: WorkflowLane): string {
  if (lane.label) return lane.index !== undefined ? `${lane.label}/${lane.index}` : lane.label;
  return lane.agentId.slice(0, 8);
}

function laneMostRecentToolLabel(lane: WorkflowLane): string | null {
  for (let i = lane.steps.length - 1; i >= 0; i--) {
    const items = lane.steps[i].items;
    for (let j = items.length - 1; j >= 0; j--) {
      const item = items[j];
      if (item.type === "tool_use") return getToolLabel(item.call);
    }
  }
  return null;
}

/**
 * A running lane spins; every other state is a dot.
 *
 * There used to be a per-lane bar here, filled by `stepCount / busiest lane`.
 * That is a comparison between agents, not progress through anything: agents
 * doing similar amounts of work all sat near full and never visibly moved, so
 * the bar read as stuck while the work was fine — and it needed a caption under
 * the card to explain what it even meant. A spinner claims only what is true,
 * that the lane is still going.
 */
function LaneStatus({ status, spin }: { status: WorkflowLane["status"]; spin: boolean }) {
  if (spin) return <SilverSpinner className="size-3" />;
  const color = status === "done" ? "bg-success" : status === "failed" ? "bg-destructive" : "bg-muted-foreground/50";
  return <span aria-hidden className={cn("size-2 rounded-full", color)} />;
}

function LaneRow({ lane, workflowEnded, renderStepItem }: { lane: WorkflowLane; workflowEnded: boolean; renderStepItem: (item: UIStepItem) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  // The workflow returned without this lane ever reporting an outcome — it was
  // cancelled, or the turn ended under it. It is not running, whatever its last
  // status said, and spinning here is the card claiming work that stopped.
  const abandoned = workflowEnded && !isLaneSettled(lane);
  const queued = !workflowEnded && lane.status === "spawned" && lane.stepCount === 0;
  const runningToolLabel = lane.status === "running" ? laneMostRecentToolLabel(lane) : null;
  const duration = lane.startedAt !== undefined && lane.endedAt !== undefined ? formatDuration(lane.endedAt - lane.startedAt) : null;

  return (
    <div className="text-xs">
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="w-full flex items-center gap-2 py-1 rounded hover:bg-muted/50 transition-colors text-left" disabled={lane.stepCount === 0}>
        {/* Fixed box so the labels line up whichever indicator the lane is showing. */}
        <span className="grid size-3 place-items-center shrink-0">
          <LaneStatus status={lane.status} spin={lane.status === "running" && !abandoned} />
        </span>
        <span className="font-mono text-[11px] shrink-0">{laneLabel(lane)}</span>
        {/* What the lane is doing now takes the slack, so the counts stay in a
            column instead of drifting with the width of each label. */}
        <span className="flex-1 min-w-0 truncate text-muted-foreground">{abandoned ? "" : (runningToolLabel ?? "")}</span>
        <span className={cn("tabular-nums shrink-0", abandoned ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
          {queued ? "queued" : `${abandoned ? "no result · " : lane.status === "done" ? "done · " : ""}${lane.stepCount} step${lane.stepCount === 1 ? "" : "s"}`}
          {duration && ` · ${duration}`}
        </span>
        {lane.stepCount > 0 && (expanded ? <IconChevronDown className="size-3 text-muted-foreground shrink-0" /> : <IconChevronRight className="size-3 text-muted-foreground shrink-0" />)}
      </button>
      {lane.error && <div className="pl-5 pb-1 text-[11px] text-destructive">{lane.error}</div>}
      {expanded && (
        <div className="pl-5 pb-2 space-y-3">
          {lane.steps.map((step) => (
            <div key={`${lane.agentId}-${step.n}`} className="space-y-2">
              <div className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">Step {step.n}</div>
              <div className="space-y-2">
                {step.items.map((item, idx) => (
                  <div key={`${lane.agentId}-${step.n}-${idx}`}>{renderStepItem(item)}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkflowCard({ call, result, subagentSteps, subagentStatus, workflowWarning, renderStepItem }: WorkflowCardProps) {
  const description = (parseArgs(call.arguments).description as string) || "Dynamic workflow";
  const lanes = useMemo(
    () => deriveWorkflowLanes(subagentSteps, subagentStatus),
    [subagentSteps, subagentStatus],
  );
  const doneCount = lanes.filter((lane) => lane.status === "done").length;
  const totalSteps = lanes.reduce((sum, lane) => sum + lane.stepCount, 0);
  const showBatchBar = lanes.length > 1;
  // The tool call returned, so no lane can still be doing work — whatever the
  // last status event said about one that never reported an outcome.
  const workflowEnded = result !== undefined;
  const abandonedCount = abandonedLanes(lanes, workflowEnded).length;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2">
        <div className="text-xs font-medium truncate">{description}</div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span>
            {lanes.length} agent{lanes.length !== 1 ? "s" : ""} · {doneCount} done · {totalSteps} steps
          </span>
          {/* The one honest bar on the card: agents finished over agents started.
              It only moves when a lane actually completes. */}
          {showBatchBar && (
            <>
              <div className="h-[3px] flex-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${Math.round((doneCount / lanes.length) * 100)}%` }} />
              </div>
              <span>
                {doneCount}/{lanes.length}
              </span>
            </>
          )}
        </div>
      </div>
      {workflowWarning && (
        <div className="px-3 pb-2 text-[11px] text-amber-600 dark:text-amber-400 break-words">
          {workflowWarning.message}
        </div>
      )}
      <div className="px-3 py-1 border-t border-border max-h-96 overflow-y-auto">
        {lanes.map((lane) => (
          <LaneRow key={lane.agentId} lane={lane} workflowEnded={workflowEnded} renderStepItem={renderStepItem} />
        ))}
      </div>
      {abandonedCount > 0 && (
        <div className="px-3 pb-2 text-[11px] text-amber-600 dark:text-amber-400">
          {abandonedCount} agent{abandonedCount === 1 ? "" : "s"} stopped without reporting a result.
        </div>
      )}
      {result?.is_error && <div className="px-3 pb-2 text-[11px] text-destructive">{typeof result.output === "string" ? result.output : "Workflow failed"}</div>}
    </div>
  );
}
