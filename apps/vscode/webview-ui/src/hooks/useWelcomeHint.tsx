import { useState, useEffect, useMemo } from "react";
import { bridge } from "@/services";
import type { SessionInfo } from "shared/legacy-sdk";

export interface WelcomeHint {
  title: string;
  description: string;
  slashCommand?: string;
  component?: React.ReactNode;
}

function ShortcutRow({ kbd, children }: { kbd: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <kbd className="kbd shrink-0">{kbd}</kbd>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ShortcutGuide() {
  return (
    <div className="text-left text-xs mt-2 space-y-5 w-full max-w-96">
      <div>
        <div className="font-medium text-foreground mb-1.5">⚡ Commands</div>
        <div className="text-muted-foreground space-y-1">
          <ShortcutRow kbd="/">View all commands</ShortcutRow>
          <ShortcutRow kbd="/init">Scan project and generate AGENTS.md file</ShortcutRow>
          <ShortcutRow kbd="/compact">Trim context so that I focus on the essentials</ShortcutRow>
        </div>
      </div>
      <div>
        <div className="font-medium text-foreground mb-1.5">💡 Tips</div>
        <div className="text-muted-foreground space-y-1">
          <ShortcutRow kbd="↑">Browse input history</ShortcutRow>
          <ShortcutRow kbd="@">Add/Search files to reference</ShortcutRow>
          <ShortcutRow kbd="Alt+K">Add selected code directly from editor</ShortcutRow>
        </div>
      </div>
      <div>
        <div className="font-medium text-foreground mb-1.5">🚀 Pro Tips</div>
        <div className="text-muted-foreground space-y-1">
          <div>• Use YOLO mode to auto-approve tool calls</div>
          <div>• AGENTS.md helps me understand your codebase</div>
          <div>• Enable Thinking for complex tasks</div>
        </div>
      </div>
    </div>
  );
}

const HINT_FIRST_TIME: WelcomeHint = {
  title: "Quick Start Guide",
  description: "",
  component: <ShortcutGuide />,
};

const HINT_AGENT_MD: WelcomeHint = {
  title: "Let me map your codebase",
  description: "Run /init to scan the project and generate docs",
  slashCommand: "/init",
};

const HINTS_POOL: WelcomeHint[] = [
  HINT_FIRST_TIME,
  HINT_AGENT_MD,
  {
    title: "Reference specific code",
    description: "Type @ to select files, or press Alt+K with code highlighted",
  },
  {
    title: "See what I can do",
    description: "Type / for all commands—like /compact to trim context",
  },
  {
    title: "Need deeper analysis?",
    description: "Enable thinking mode for complex architecture or debugging",
  },
  {
    title: "More than code",
    description: "Paste a screenshot or design and I'll help implement it",
  },
  {
    title: "Add more tools",
    description: "Connect external services via MCP servers in settings",
  },
  {
    title: "Prefer fewer interruptions?",
    description: "Enable YOLO mode to auto-approve",
  },
  {
    title: "Context getting long?",
    description: "Type /compact to keep only the essentials",
    slashCommand: "/compact",
  },
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Rolled once per app load so the hint stays stable when the chat empties again.
const SESSION_HINT = pickRandom(HINTS_POOL);
const SHOW_AGENTS_HINT = Math.random() < 0.3;

export interface WelcomeContent {
  hint: WelcomeHint;
  recentSessions: SessionInfo[];
}

export function useWelcomeHint(): WelcomeContent {
  const [hasAgentsMd, setHasAgentsMd] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  useEffect(() => {
    bridge
      .checkFileExists("AGENTS.md")
      .then(setHasAgentsMd)
      .catch(() => setHasAgentsMd(false));
    bridge
      .getSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const hasHistory = sessions === null ? null : sessions.length > 0;

  const hint = useMemo(() => {
    // First time user: show shortcut guide
    if (hasHistory === false) {
      return HINT_FIRST_TIME;
    }
    // 30% chance to show AGENTS.md hint if missing
    if (hasAgentsMd === false && SHOW_AGENTS_HINT) {
      return HINT_AGENT_MD;
    }
    return SESSION_HINT;
  }, [hasAgentsMd, hasHistory]);

  const recentSessions = useMemo(
    () => [...(sessions ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [sessions],
  );

  return { hint, recentSessions };
}
