import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores";
import { cn } from "@/lib/utils";
import type { InlineError as InlineErrorType } from "../stores/chat.store";

interface InlineErrorProps {
  error: InlineErrorType;
}

export function InlineError({ error }: InlineErrorProps) {
  const { retryLastMessage, isStreaming } = useChatStore();

  // Display detailed error info if detail differs from message
  const showDetail = error.detail && error.detail !== error.message;

  return (
    <div className={cn("flex flex-col gap-1 px-3 py-2 mt-2 rounded-md", "bg-destructive/10", "border border-destructive/40")}>
      <div className="flex items-center gap-2">
        <IconAlertCircle className="size-4 text-destructive shrink-0" />
        <span className="text-xs text-destructive flex-1">{error.message}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-destructive hover:bg-destructive/20"
          onClick={retryLastMessage}
          disabled={isStreaming}
        >
          <IconRefresh className="size-3.5 mr-1" />
          Retry
        </Button>
      </div>
      {showDetail && <div className="text-[10px] text-destructive/70 pl-6 font-mono break-all">{error.detail}</div>}
    </div>
  );
}
