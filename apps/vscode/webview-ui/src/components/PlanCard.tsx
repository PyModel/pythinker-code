import { type ReactNode, useState } from "react";
import { IconClipboardList, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface PlanCardProps {
  children: ReactNode;
}

export function PlanCard({ children }: PlanCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="my-2 rounded-lg border border-brand/40 bg-brand/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 bg-brand/10 border-b border-brand/40 cursor-pointer hover:bg-brand/20 transition-colors"
      >
        <IconClipboardList className="size-3.5 text-brand" />
        <span className="text-[11px] font-semibold text-brand flex-1 text-left">Plan Mode</span>
        <IconChevronDown className={cn("size-3.5 text-brand transition-transform", collapsed && "-rotate-90")} />
      </button>
      {!collapsed && (
        <div className="px-1 py-1 [&>*:not(:last-child)]:mb-3">
          {children}
        </div>
      )}
    </div>
  );
}
