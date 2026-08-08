import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PermissionMode } from "shared/legacy-sdk";

const LABELS: Partial<Record<PermissionMode, { text: string; hint: string }>> = {
  yolo: {
    text: "YOLO",
    hint: "Tool actions are auto-approved; the agent may still ask questions. Send /yolo off to stop.",
  },
  auto: {
    text: "AUTO",
    hint: "Fully autonomous; the agent will not ask questions. Send /auto off to stop.",
  },
};

/**
 * Shows the permission mode whenever it is not the default.
 *
 * `/yolo` and `/auto` toggle when sent without an argument, so a chat that
 * never showed the mode let the same command mean "on" or "off" depending on
 * state nobody could see — sending `/yolo` to be sure it was on turned it off.
 * The terminal has always shown this; the red matches its danger row.
 */
export function PermissionModeBadge({ mode }: { mode: PermissionMode }) {
  const label = LABELS[mode];
  if (label === undefined) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-destructive select-none">
          {label.text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label.hint}</TooltipContent>
    </Tooltip>
  );
}
