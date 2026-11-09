import { PythinkerMascot } from "./PythinkerMascot";
import { useWelcomeHint } from "@/hooks/useWelcomeHint";
import { Button } from "@/components/ui/button";
import { bridge, Events } from "@/services";
import { useChatStore } from "@/stores";
import { cleanSystemTags } from "shared/utils";
import { toast } from "./ui/sonner";
import type { SessionInfo } from "shared/legacy-sdk";
import { formatRelativeDate } from "@/lib/format";

export function WelcomeScreen() {
  const { hint, recentSessions } = useWelcomeHint();
  const loadSession = useChatStore((s) => s.loadSession);
  const { slashCommand } = hint;

  const openSession = async (session: SessionInfo) => {
    try {
      const events = await bridge.loadSessionHistory(session.id);
      await loadSession(session.id, events);
    } catch (error) {
      toast.error(`Unable to open the conversation: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 px-4">
      <PythinkerMascot className="h-24 w-auto max-w-[280px]" />
      {hint.component ? (
        hint.component
      ) : (
        <div className="flex flex-col items-center text-center space-y-0.5">
          <p className="text-xs font-medium text-foreground">{hint.title}</p>
          <p className="text-xs text-muted-foreground">{hint.description}</p>
          {slashCommand && (
            <Button
              variant="outline"
              size="xs"
              className="mt-1.5 text-xs"
              onClick={() => bridge.emit(Events.InsertMention, { mention: slashCommand })}
            >
              {slashCommand}
            </Button>
          )}
        </div>
      )}
      {recentSessions.length > 0 && (
        <div className="w-full max-w-96 mt-2">
          <p className="px-2 mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Recent sessions
          </p>
          <div className="space-y-0.5">
            {recentSessions.map((session) => (
              <button
                key={session.id}
                className="w-full text-left px-2 py-1 rounded-md cursor-pointer transition-colors hover:bg-accent/50"
                onClick={() => {
                  void openSession(session);
                }}
              >
                <p className="text-xs text-muted-foreground truncate">{cleanSystemTags(session.brief) || "Untitled"}</p>
                <span className="text-[10px] text-muted-foreground/70">{formatRelativeDate(session.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
