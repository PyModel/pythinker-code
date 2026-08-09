import { IconCheck } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { groupModelsByProvider, useSettingsStore } from "@/stores";
import { cn } from "@/lib/utils";

const CAPABILITY_LABELS: Record<string, string> = {
  image_in: "vision",
  video_in: "video",
  thinking: "thinking",
  always_thinking: "always thinking",
  tools: "tools",
  tool_use: "tools",
};

function formatContextWindow(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`;
}

export function ModelsSection() {
  const { models, currentModel } = useSettingsStore();
  const groups = groupModelsByProvider(models);

  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-10">No models available. Add a provider first.</p>;
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.provider}>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            {group.label}
          </h3>
          <div className="space-y-1">
            {group.models.map((model) => {
              const isCurrent = model.id === currentModel;
              return (
                <div
                  key={model.id}
                  className={cn(
                    "rounded border border-border/60 px-2.5 py-1.5 flex items-center gap-2",
                    isCurrent ? "bg-list-hover" : "bg-muted/20",
                  )}
                >
                  <IconCheck className={cn("size-3.5 shrink-0 text-brand", !isCurrent && "opacity-0")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{model.name}</span>
                      {model.contextWindow !== undefined && (
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {formatContextWindow(model.contextWindow)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">{model.id}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    {model.capabilities.map((capability) => (
                      <Badge key={capability} variant="outline" className="h-4 px-1.5 text-[9px]">
                        {CAPABILITY_LABELS[capability] ?? capability.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
