import { Button } from "@/components/ui/button";
import type { ConfigHubSection } from "@/stores/settings.store";
import { SECTIONS } from "./sections";

const DESCRIPTIONS: Record<Exclude<ConfigHubSection, "overview">, string> = {
  models: "Every model available to the agent, grouped by provider.",
  providers: "API providers in config.toml — add, inspect, or remove them.",
  mcp: "MCP servers the agent can call — manage, test, and authenticate.",
  config: "The raw config.toml the extension and the CLI share.",
  settings: "Extension behavior: approvals, autosave, shortcuts, thinking display.",
};

export function OverviewSection({
  onNavigate,
  counts,
}: {
  onNavigate: (section: ConfigHubSection) => void;
  counts: Partial<Record<ConfigHubSection, number>>;
}) {
  return (
    <div className="grid grid-cols-1 @[480px]:grid-cols-2 gap-2.5">
      {SECTIONS.filter((s) => s.id !== "overview").map((s) => (
        <div key={s.id} className="rounded-md border border-border bg-card/30 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <s.icon className="size-4 text-brand shrink-0" />
            <span className="text-xs font-medium flex-1 truncate">{s.label}</span>
            {counts[s.id] !== undefined && (
              <span className="text-[10px] tabular-nums rounded-full bg-badge text-badge-foreground px-1.5 py-px shrink-0">
                {counts[s.id]}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-4 flex-1">
            {DESCRIPTIONS[s.id as Exclude<ConfigHubSection, "overview">]}
          </p>
          <Button variant="outline" size="sm" className="h-6 text-xs self-start" onClick={() => onNavigate(s.id)}>
            Open {s.label}
          </Button>
        </div>
      ))}
    </div>
  );
}
