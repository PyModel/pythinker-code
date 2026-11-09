import { useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { IconArrowDown } from "@tabler/icons-react";
import { ChatMessage } from "./ChatMessage";
import { WelcomeScreen } from "./WelcomeScreen";
import { useChatStore } from "@/stores";
import { cn } from "@/lib/utils";
import { getForkTurnIndex } from "shared/fork-turn-index";

function ScrollButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("absolute bottom-4 right-4 p-2 rounded-full z-10", "bg-primary text-primary-foreground shadow-lg", "hover:bg-primary/90 transition-all")}
    >
      <IconArrowDown className="size-4" />
    </button>
  );
}

export function ChatArea() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sessionId = useChatStore((s) => s.sessionId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center relative">
        <WelcomeScreen />
      </div>
    );
  }

  return (
    <div className="h-full relative">
      <Virtuoso
        ref={virtuosoRef}
        // Remount on session switch so initialTopMostItemIndex re-anchors the
        // replayed list at the bottom instead of keeping the old scroll offset.
        key={sessionId ?? "new"}
        className="h-full overflow-x-hidden"
        data={messages}
        computeItemKey={(_, message) => message.id}
        initialTopMostItemIndex={messages.length - 1}
        // "auto" sticks to the bottom on new rows only while already there;
        // scrolling up breaks the pin, returning to the bottom restores it.
        // Virtuoso also re-pins when the streaming tail grows in place.
        followOutput="auto"
        atBottomStateChange={setAtBottom}
        atBottomThreshold={10}
        // Pre-render a few hundred px above the viewport; keep everything below
        // it mounted so the streaming tail never unmounts mid-stream (Cline's
        // always-rendered-tail trick — cheap because below-viewport content is
        // just the tail while pinned to the bottom).
        increaseViewportBy={{ top: 400, bottom: Number.MAX_SAFE_INTEGER }}
        // Virtuoso manages scroll position itself; native anchoring fights it.
        style={{ overflowAnchor: "none" }}
        itemContent={(idx, message) => (
          <ChatMessage
            message={message}
            turnIndex={getForkTurnIndex(messages, idx)}
            isStreaming={isStreaming && idx === messages.length - 1 && message.role === "assistant"}
          />
        )}
      />
      {!atBottom && (
        <ScrollButton
          onClick={() => virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: "end", behavior: "smooth" })}
        />
      )}
    </div>
  );
}
