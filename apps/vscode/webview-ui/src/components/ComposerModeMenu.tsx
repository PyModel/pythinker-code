import { useState } from "react";
import { IconAdjustmentsHorizontal, IconBolt, IconBulb, IconCheck, IconClipboardList, IconRobot, IconShieldCheck } from "@tabler/icons-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { applyPermissionCommand, type PermissionCommand } from "@/stores/chat.store";
import { cn } from "@/lib/utils";
import type { PermissionMode, ThinkingMode } from "shared/legacy-sdk";

interface ModeEntry {
  id: PermissionMode;
  label: string;
  description: string;
  icon: typeof IconShieldCheck;
}

/** Descriptions match the host's `/yolo` and `/auto` command help. */
const MODES: readonly ModeEntry[] = [
  { id: "manual", label: "Manual", description: "Approve every action.", icon: IconShieldCheck },
  { id: "yolo", label: "YOLO", description: "Auto-approve tools; the agent may still ask questions.", icon: IconBolt },
  { id: "auto", label: "Auto", description: "Fully autonomous; the agent will not ask questions.", icon: IconRobot },
];

/** Same path as the `/yolo` / `/auto` slash commands, so the flush-pending-approvals rule lives in one place. */
function applyMode(current: PermissionMode, next: PermissionMode): Promise<void> {
  const command: PermissionCommand =
    next === "manual" ? { mode: current === "auto" ? "auto" : "yolo", request: "off" } : { mode: next, request: "on" };
  return applyPermissionCommand(command);
}

function effortLabel(effort: string): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{children}</div>;
}

interface RowProps {
  icon: typeof IconShieldCheck;
  label: string;
  description?: string;
  checked: boolean;
  warning?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function Row({ icon: Icon, label, description, checked, warning, disabled, onSelect }: RowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        disabled ? "cursor-default opacity-60" : "hover:bg-list-hover cursor-pointer",
      )}
    >
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", warning ? "text-warning" : "text-muted-foreground")} />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-foreground">{label}</span>
        {description !== undefined && <span className="text-muted-foreground">{description}</span>}
      </span>
      {checked && <IconCheck className="ml-auto mt-0.5 size-3.5 shrink-0 text-foreground" />}
    </button>
  );
}

interface ComposerModeMenuProps {
  permissionMode: PermissionMode;
  planMode: boolean;
  onTogglePlanMode: () => void;
  thinkingMode: ThinkingMode;
  thinkingEffort: string;
  thinkingEfforts?: string[];
  thinkingAlwaysOn?: boolean;
  /** Streaming: thinking cannot change mid-turn; permission and plan still can. */
  thinkingDisabled?: boolean;
  /** Muted wrapping note below the effort options (mid-conversation cache-cost notice). */
  cacheNote?: string;
  onToggleThinking: () => void;
  onSelectThinkingEffort: (effort: string) => void;
}

/**
 * Single composer control for permission mode, plan mode, and thinking
 * effort. The store's `permissionMode` updates through host status events,
 * so selection only fires the RPC — no optimistic state.
 */
export function ComposerModeMenu({
  permissionMode,
  planMode,
  onTogglePlanMode,
  thinkingMode,
  thinkingEffort,
  thinkingEfforts = [],
  thinkingAlwaysOn = false,
  thinkingDisabled = false,
  cacheNote,
  onToggleThinking,
  onSelectThinkingEffort,
}: ComposerModeMenuProps) {
  const [open, setOpen] = useState(false);
  const permission = MODES.find((entry) => entry.id === permissionMode) ?? MODES[0]!;
  const thinkingActive = thinkingEffort !== "off" || thinkingAlwaysOn;

  const selectPermission = (next: PermissionMode) => {
    setOpen(false);
    if (next === permissionMode) return;
    void applyMode(permissionMode, next);
  };

  const stateSummary = [
    permission.label,
    planMode ? "Plan" : undefined,
    thinkingMode !== "none" && thinkingActive ? `Thinking ${effortLabel(thinkingEffort)}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={stateSummary}
          className={cn(
            "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs select-none transition-colors cursor-pointer",
            permissionMode !== "manual"
              ? "bg-warning/10 text-warning hover:bg-warning/20"
              : planMode || thinkingActive
                ? "bg-brand/15 text-brand hover:bg-brand/25"
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <IconAdjustmentsHorizontal className="size-4" />
          <span className="max-[380px]:hidden">{permission.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 gap-0 p-1">
        <SectionLabel>Permissions</SectionLabel>
        {MODES.map((entry) => (
          <Row
            key={entry.id}
            icon={entry.icon}
            label={entry.label}
            description={entry.description}
            checked={entry.id === permissionMode}
            warning={entry.id !== "manual"}
            onSelect={() => selectPermission(entry.id)}
          />
        ))}
        <div className="mx-1 my-1 border-t border-border/60" />
        <Row
          icon={IconClipboardList}
          label="Plan mode"
          description="Plan and review before making changes."
          checked={planMode}
          onSelect={() => {
            setOpen(false);
            onTogglePlanMode();
          }}
        />
        {thinkingMode !== "none" && (
          <>
            <div className="mx-1 my-1 border-t border-border/60" />
            <SectionLabel>Thinking</SectionLabel>
            {thinkingMode === "always" && <Row icon={IconBulb} label="Always on" description="This model always thinks." checked disabled onSelect={() => {}} />}
            {thinkingMode === "switch" && (
              <Row
                icon={IconBulb}
                label="Thinking"
                description={thinkingActive ? "Enabled." : "Disabled."}
                checked={thinkingActive}
                disabled={thinkingDisabled}
                onSelect={() => {
                  setOpen(false);
                  onToggleThinking();
                }}
              />
            )}
            {thinkingMode === "effort" &&
              (thinkingAlwaysOn ? thinkingEfforts : ["off", ...thinkingEfforts]).map((option) => (
                <Row
                  key={option}
                  icon={IconBulb}
                  label={effortLabel(option)}
                  checked={option === thinkingEffort}
                  disabled={thinkingDisabled}
                  onSelect={() => {
                    setOpen(false);
                    onSelectThinkingEffort(option);
                  }}
                />
              ))}
            {cacheNote !== undefined && (
              <div className="px-2 py-1.5 text-[10px] leading-snug whitespace-normal text-muted-foreground">{cacheNote}</div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
