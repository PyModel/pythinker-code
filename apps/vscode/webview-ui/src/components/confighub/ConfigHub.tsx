import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores";
import type { ConfigHubSection } from "@/stores/settings.store";
import { bridge } from "@/services";
import { cn } from "@/lib/utils";
import { SECTIONS } from "./sections";
import { OverviewSection } from "./OverviewSection";
import { ModelsSection } from "./ModelsSection";
import { ProvidersSection } from "./ProvidersSection";
import { MCPServersSection } from "./MCPServersSection";
import { ConfigFileSection } from "./ConfigFileSection";
import { SettingsSection } from "./SettingsSection";

export function useSectionCounts(): Partial<Record<ConfigHubSection, number>> {
  const { models, mcpServers } = useSettingsStore();
  return {
    models: models.length,
    providers: new Set(models.map((m) => m.provider)).size,
    mcp: mcpServers.length,
  };
}

export function ConfigHub() {
  const { configHub, openConfigHub, closeConfigHub, setMCPServers } = useSettingsStore();
  const counts = useSectionCounts();
  const section = configHub.section;
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  // Keep the rail/overview MCP count fresh; the MCP section surfaces fetch
  // errors itself, so a failed count refresh stays silent here.
  useEffect(() => {
    void bridge.getMCPServers().then(setMCPServers).catch(() => undefined);
  }, [setMCPServers]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A nested dialog (e.g. delete confirm) owns Escape while it is open.
      if (e.target instanceof Element && e.target.closest('[role="dialog"], [role="alertdialog"]')) return;
      closeConfigHub();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeConfigHub]);

  return (
    <div className="flex-1 min-h-0 flex flex-col @container">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold whitespace-nowrap">Config Hub</span>
          <span className="text-muted-foreground text-xs">/</span>
          <span className="text-xs text-muted-foreground truncate">{active.label}</span>
        </div>
        <Button size="sm" className="h-6 text-xs" onClick={closeConfigHub}>
          Done
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <nav
          aria-label="Config sections"
          className="shrink-0 w-40 @max-[480px]:w-auto border-r border-border overflow-y-auto py-1.5 px-1.5 space-y-0.5"
        >
          {SECTIONS.map((s) => {
            const isActive = s.id === section;
            const count = counts[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => openConfigHub(s.id)}
                aria-current={isActive ? "page" : undefined}
                title={s.label}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer",
                  "@max-[480px]:justify-center @max-[480px]:px-1.5",
                  isActive ? "bg-list-hover text-foreground" : "text-muted-foreground hover:bg-toolbar-hover hover:text-foreground",
                )}
              >
                <s.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate @max-[480px]:hidden">{s.label}</span>
                {count !== undefined && (
                  <span className="shrink-0 text-[10px] tabular-nums rounded-full bg-badge text-badge-foreground px-1.5 py-px @max-[480px]:hidden">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto p-3">
          {section === "overview" && <OverviewSection onNavigate={openConfigHub} counts={counts} />}
          {section === "models" && <ModelsSection />}
          {section === "providers" && <ProvidersSection />}
          {section === "mcp" && <MCPServersSection />}
          {section === "config" && <ConfigFileSection />}
          {section === "settings" && <SettingsSection />}
        </main>
      </div>
    </div>
  );
}
