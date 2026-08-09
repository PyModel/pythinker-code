import { useState, useEffect, useRef } from "react";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useApprovalStore } from "@/stores";
import { DisplayBlocks } from "./DisplayBlocks";
import { cn } from "@/lib/utils";
import type { ApprovalResponse } from "shared/legacy-sdk";

const focusComposer = () => document.querySelector<HTMLTextAreaElement>("textarea")?.focus();

export function ApprovalDialog() {
  const { pending, respondToRequest } = useApprovalStore();
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // The request stays in the store until the RPC settles, so repeated key
  // presses would send duplicate responses without this guard.
  const inFlightRef = useRef(false);

  const req = pending[0];

  // Auto-expand if there's a diff block (code change); focus the card so number shortcuts work.
  useEffect(() => {
    if (req) {
      const hasDiff = req.display?.some((b) => b.type === "diff") ?? false;
      setExpanded(hasDiff);
      cardRef.current?.focus();
    }
  }, [req?.id]);

  if (!req) return null;
  const hasDisplay = req.display && req.display.length > 0;

  const handleResponse = async (response: ApprovalResponse) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await respondToRequest(req.id, response);
      setSelectedIndex(1);
      setExpanded(false);
      focusComposer();
    } finally {
      inFlightRef.current = false;
    }
  };

  const options = [
    { key: "approve", label: "Yes", index: 1 },
    { key: "approve_for_session", label: "Yes, for this session", index: 2 },
    { key: "reject", label: "No", index: 3 },
  ] as const;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const digit = Number(e.key);
    if (digit >= 1 && digit <= options.length) {
      e.preventDefault();
      const opt = options[digit - 1];
      if (opt) void handleResponse(opt.key);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[selectedIndex - 1];
      if (opt) void handleResponse(opt.key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      focusComposer();
    }
  };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn("mb-0.5 border border-brand/40 rounded-lg overflow-hidden bg-background flex flex-col shrink", "outline-none focus:ring-1 focus:ring-ring")}
    >
      <div className="p-2 space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-xs font-semibold text-foreground">Allow this {req.action.toLowerCase()}?</div>
            {pending.length > 1 && (
              <span className="text-[10px] px-1.5 py-px rounded-full bg-badge text-badge-foreground shrink-0">+{pending.length - 1} more pending</span>
            )}
          </div>
          {hasDisplay && (
            <button onClick={() => setExpanded(!expanded)} className="p-1 hover:bg-muted rounded transition-colors">
              {expanded ? <IconChevronDown className="size-4 text-muted-foreground" /> : <IconChevronUp className="size-4 text-muted-foreground" />}
            </button>
          )}
        </div>

        <div className="text-xs text-foreground/90 break-all leading-relaxed bg-muted/30 py-2 px-2 rounded shrink-0 max-h-20 overflow-y-auto font-mono">{req.description}</div>

        {hasDisplay && (
          <div className={cn("overflow-y-auto", expanded ? "flex-1 min-h-0" : "max-h-24")}>
            <DisplayBlocks blocks={req.display} maxHeight={expanded ? "max-h-none" : "max-h-20"} />
          </div>
        )}

        <div className="text-xs text-muted-foreground shrink-0">{req.sender}</div>

        <div className="space-y-1.5 pt-1 shrink-0">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                void handleResponse(opt.key);
              }}
              onMouseEnter={() => setSelectedIndex(opt.index)}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border border-border cursor-pointer",
                selectedIndex === opt.index ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("mr-2", selectedIndex === opt.index ? "text-primary-foreground/70" : "text-muted-foreground")}>{opt.index}</span>
              <span className="font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
