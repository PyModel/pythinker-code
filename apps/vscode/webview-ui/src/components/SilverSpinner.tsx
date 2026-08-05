import { cn } from "@/lib/utils";

export function SilverSpinner({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center justify-center size-3.5 shrink-0", className)}>
      <span className="size-2 rounded-full bg-zinc-400 dark:bg-zinc-300 animate-pulse-slow shadow-[0_0_6px_rgba(212,212,216,0.4)]" />
    </span>
  );
}
