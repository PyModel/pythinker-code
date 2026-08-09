import { useState } from "react";
import { IconCopy, IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  content: string;
  className?: string;
}

export function CopyButton({ content, className }: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  if (!content) return null;

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={cn(
        "h-5 w-5 text-muted-foreground hover:text-foreground transition-all border-0! hover:bg-toolbar-hover cursor-pointer",
        isCopied && "text-success hover:text-success",
        className,
      )}
      onClick={() => {
        void handleCopy();
      }}
      title="Copy message"
    >
      {isCopied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
    </Button>
  );
}
