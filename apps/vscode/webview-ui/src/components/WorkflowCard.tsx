import { useMemo, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { deriveWorkflowLanes, maxLaneStepCount, type WorkflowLane } from "@/lib/workflow-lanes";
import { getToolLabel, parseArgs } from "@/lib/tool-args";
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

function StatusDot({ status }: { status: WorkflowLane["status"] }) {
  const color =
    status === "running" ? "bg-brand" : status === "done" ? "bg-success" : status === "failed" ? "bg-destructive" : "bg-muted-foreground";
  return <span className={cn("inline-block size-2 rounded-full shrink-0", color)} />;
}

function LaneBar({ fraction, done }: { fraction: number; done: boolean }) {
  return (
    <div className="h-[3px] w-24 rounded-full bg-muted overflow-hidden shrink-0">
      <div className={cn("h-full rounded-full", done ? "bg-success" : "bg-brand")} style={{ width: `${Math.round(fraction * 100)}%` }} />
    </div>
  );
}

function LaneRow({ lane, maxSteps, renderStepItem }: { lane: WorkflowLane; maxSteps: number; renderStepItem: (item: UIStepItem) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const done = lane.status === "done";
  // A finished lane always reads full: the bar is relative to the busiest agent,
  // so a lane that did fewer steps than the busiest one would otherwise show a
  // gap after it completed.
  const fraction = done ? 1 : maxSteps > 0 ? lane.stepCount / maxSteps : 0;
  const queued = lane.status === "spawned" && lane.stepCount === 0;
  const runningToolLabel = lane.status === "running" ? laneMostRecentToolLabel(lane) : null;
  const duration = lane.startedAt !== undefined && lane.endedAt !== undefined ? formatDuration(lane.endedAt - lane.startedAt) : null;

  return (
    <div className="text-xs">
      <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="w-full flex items-center gap-2 py-1 hover:bg-muted/50 transition-colors text-left" disabled={lane.stepCount === 0}>
        <StatusDot status={lane.status} />
        <span className="font-mono text-[11px] shrink-0">{laneLabel(lane)}</span>
        <LaneBar fraction={fraction} done={done} />
        <span className="text-muted-foreground tabular-nums shrink-0">
          {queued ? "queued" : `${lane.status === "done" ? "done · " : ""}${lane.stepCount} step${lane.stepCount === 1 ? "" : "s"}`}
          {duration && ` · ${duration}`}
        </span>
        {lane.stepCount > 0 && (expanded ? <IconChevronDown className="size-3 text-muted-foreground" /> : <IconChevronRight className="size-3 text-muted-foreground" />)}
      </button>
      {lane.error && <div className="pl-6 pb-1 text-[11px] text-destructive">{lane.error}</div>}
      {runningToolLabel && <div className="pl-6 pb-1 text-[11px] text-muted-foreground truncate">{runningToolLabel}</div>}
      {expanded && (
        <div className="pl-6 pb-2 space-y-3">
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
  const maxSteps = maxLaneStepCount(lanes);
  const doneCount = lanes.filter((lane) => lane.status === "done").length;
  const totalSteps = lanes.reduce((sum, lane) => sum + lane.stepCount, 0);
  const showBatchBar = lanes.length > 1;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2">
        <div className="text-xs font-medium truncate">{description}</div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span>
            {lanes.length} agent{lanes.length !== 1 ? "s" : ""} · {doneCount} done · {totalSteps} steps
          </span>
          {showBatchBar && (
            <>
              <div className="h-[3px] flex-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-success" style={{ width: `${lanes.length > 0 ? Math.round((doneCount / lanes.length) * 100) : 0}%` }} />
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
      <div className="px-3 pb-2 border-t border-border max-h-96 overflow-y-auto">
        {lanes.map((lane) => (
          <LaneRow key={lane.agentId} lane={lane} maxSteps={maxSteps} renderStepItem={renderStepItem} />
        ))}
      </div>
      {maxSteps > 0 && <div className="px-3 pb-2 text-[10px] text-muted-foreground">bar = steps relative to busiest agent ({maxSteps})</div>}
      {result?.is_error && <div className="px-3 pb-2 text-[11px] text-destructive">{typeof result.output === "string" ? result.output : "Workflow failed"}</div>}
    </div>
  );
}
