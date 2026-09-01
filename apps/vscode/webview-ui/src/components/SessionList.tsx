import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconSearch, IconDots, IconTrash, IconCheck, IconSortDescending, IconSortAscending } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StreamingConfirmDialog } from "./StreamingConfirmDialog";
import { bridge } from "@/services";
import type { SessionInfo } from "shared/legacy-sdk";
import { cn } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { useChatStore, useSettingsStore } from "@/stores";
import { cleanSystemTags } from "shared/utils";
import { toast } from "./ui/sonner";

interface SessionListProps {
  onClose: () => void;
}

const SESSIONS_KEY = ["sessions"] as const;
const NO_SESSIONS: SessionInfo[] = [];

interface GroupBoundaries {
  startOfToday: number;
  startOfYesterday: number;
  startOfWeekWindow: number;
}

function getGroupLabel(timestamp: number, boundaries: GroupBoundaries): string {
  if (timestamp >= boundaries.startOfToday) return "Today";
  if (timestamp >= boundaries.startOfYesterday) return "Yesterday";
  if (timestamp >= boundaries.startOfWeekWindow) return "This week";
  return "Older";
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <span key={idx} className="bg-selection text-selection-foreground rounded-[2px]">
        {text.slice(idx, idx + q.length)}
      </span>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (parts.length === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

interface SessionItemProps {
  session: SessionInfo;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  dirLabel: string | null; // null = current dir, string = relative path
  searchQuery: string;
}

function SessionItem({ session, isSelected, onSelect, onDelete, dirLabel, searchQuery }: SessionItemProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={cn("group relative px-2 py-1 rounded-md cursor-pointer transition-colors", isSelected ? "bg-accent" : "hover:bg-accent/50")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      <p className="text-xs leading-relaxed line-clamp-3 text-foreground">{highlightMatch(cleanSystemTags(session.brief) || "Untitled", searchQuery)}</p>
      <div className="flex items-center justify-between mt-0.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isSelected && <IconCheck className="size-3 text-brand shrink-0" />}
          <span className="text-[10px] text-muted-foreground shrink-0">{formatRelativeDate(session.updatedAt)}</span>
          {dirLabel && <span className="text-[10px] text-muted-foreground/70 truncate" title={session.workDir}>· {dirLabel}</span>}
        </div>
        <div className={cn("transition-opacity", isHovered ? "opacity-100" : "opacity-0")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 -m-1 rounded hover:bg-muted transition-colors" onClick={(e) => e.stopPropagation()}>
                <IconDots className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem
                className="text-xs text-destructive focus:text-destructive cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <IconTrash className="size-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function SessionList({ onClose }: SessionListProps) {
  const { loadSession, sessionId, startNewConversation, isStreaming } = useChatStore();
  const { workspaceRoot, currentWorkDir, setCurrentWorkDir } = useSettingsStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"recent" | "oldest">("recent");
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingSession, setPendingSession] = useState<SessionInfo | null>(null);

  const queryClient = useQueryClient();
  const { data: sessions = NO_SESSIONS, isPending: loading } = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => bridge.getAllSessions(),
  });

  const getWorkDirLabel = (sessionWorkDir: string): string | null => {
    const activeWorkDir = currentWorkDir || workspaceRoot;
    if (sessionWorkDir === activeWorkDir) return null;
    if (!workspaceRoot) return sessionWorkDir;
    // Show (root) for workspace root, relative path for subdirs
    if (sessionWorkDir === workspaceRoot) {
      return "/";
    }
    if (sessionWorkDir.startsWith(workspaceRoot)) {
      return "." + sessionWorkDir.slice(workspaceRoot.length);
    }
    return sessionWorkDir;
  };

  const groupedSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => cleanSystemTags(s.brief).toLowerCase().includes(q)) : sessions;
    // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- The copied array is safe to sort in place.
    const sorted = [...filtered].sort((a, b) => (sortOrder === "recent" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));

    const now = new Date();
    // Calendar-day arithmetic, not fixed 24h offsets — a DST change makes a
    // local day 23 or 25 hours, which would shift sessions between groups.
    const boundaries = {
      startOfToday: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
      startOfYesterday: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime(),
      startOfWeekWindow: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(),
    };
    // Map preserves insertion order, so group order follows the sort direction
    const groups = new Map<string, SessionInfo[]>();
    for (const session of sorted) {
      const label = getGroupLabel(session.updatedAt, boundaries);
      const bucket = groups.get(label);
      if (bucket) {
        bucket.push(session);
      } else {
        groups.set(label, [session]);
      }
    }
    return [...groups.entries()].map(([label, items]) => ({ label, items }));
  }, [sessions, searchQuery, sortOrder]);

  const isEmpty = groupedSessions.length === 0;

  const handleSelect = async (session: SessionInfo) => {
    // If streaming, show confirmation dialog
    if (isStreaming) {
      setPendingSession(session);
      return;
    }

    await doLoadSession(session);
  };

  const doLoadSession = async (session: SessionInfo) => {
    try {
      // Switch workDir if session is from a different directory
      const activeWorkDir = currentWorkDir || workspaceRoot;
      if (session.workDir !== activeWorkDir) {
        const newWorkDir = session.workDir === workspaceRoot ? null : session.workDir;
        const result = await bridge.setWorkDir(newWorkDir);
        if (result.ok) {
          setCurrentWorkDir(newWorkDir);
        }
      }
      const events = await bridge.loadSessionHistory(session.id);
      await loadSession(session.id, events);
      onClose();
    } catch (error) {
      console.error("[SessionList] Failed to load session:", error);
      toast.error(`Unable to open the conversation: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleConfirmSwitch = async () => {
    if (!pendingSession) return;
    await doLoadSession(pendingSession);
    setPendingSession(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    try {
      await bridge.deleteSession(deleteTarget.id);

      if (sessionId === deleteTarget.id) {
        await startNewConversation();
      }

      queryClient.setQueryData<SessionInfo[]>(SESSIONS_KEY, (prev) => prev?.filter((s) => s.id !== deleteTarget.id) ?? []);
    } catch (error) {
      console.error("[SessionList] Failed to delete session:", error);
      toast.error(`Unable to delete the conversation: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <div className="flex flex-col max-h-[70vh]">
        <div className="flex items-center gap-1 p-2 border-b border-border shrink-0">
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input placeholder="Search conversations…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            title={sortOrder === "recent" ? "Recent first — click for oldest first" : "Oldest first — click for recent first"}
            aria-label={sortOrder === "recent" ? "Sort: recent first" : "Sort: oldest first"}
            onClick={() => setSortOrder((prev) => (prev === "recent" ? "oldest" : "recent"))}
          >
            {sortOrder === "recent" ? <IconSortDescending className="size-3.5 text-muted-foreground" /> : <IconSortAscending className="size-3.5 text-muted-foreground" />}
          </Button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">Loading…</div>
          ) : isEmpty ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">{searchQuery ? "No conversations found" : "No conversations yet"}</div>
          ) : (
            <div className="pb-1.5">
              {groupedSessions.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 bg-popover px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{group.label}</div>
                  <div className="px-1.5 space-y-1">
                    {group.items.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isSelected={sessionId === session.id}
                        onSelect={() => {
                          void handleSelect(session);
                        }}
                        onDelete={() => setDeleteTarget(session)}
                        dirLabel={getWorkDirLabel(session.workDir)}
                        searchQuery={searchQuery}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <StreamingConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Conversation?"
        description="This will permanently delete this conversation. This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          void handleDelete();
        }}
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
        confirmLoading={isDeleting}
      />

      <StreamingConfirmDialog
        open={pendingSession !== null}
        onOpenChange={(open) => !open && setPendingSession(null)}
        title="Switch Conversation?"
        description="The current conversation is still generating a response. Switching will truncate the output. Are you sure you want to continue?"
        confirmLabel="Switch"
        onConfirm={() => {
          void handleConfirmSwitch();
        }}
      />
    </>
  );
}
