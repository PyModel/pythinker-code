import { useState, useEffect, useRef } from "react";
import { useChatStore, useSettingsStore } from "@/stores";
import { cn } from "@/lib/utils";
import { IconArrowUp, IconArrowDown, IconGauge, IconRefresh, IconBolt } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function useTokenSpeed() {
  const isStreaming = useChatStore((s) => s.isStreaming);
  const outputTokens = useChatStore((s) => s.tokenUsage.output + s.activeTokenUsage.output);

  const [speed, setSpeed] = useState<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const startTokensRef = useRef<number>(0);

  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        startTokensRef.current = outputTokens;
      }

      const interval = setInterval(() => {
        if (!startTimeRef.current) return;
        const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
        const tokensGenerated = outputTokens - startTokensRef.current;
        if (elapsedSec > 0.2 && tokensGenerated >= 0) {
          setSpeed(tokensGenerated / elapsedSec);
        }
      }, 250);

      return () => clearInterval(interval);
    }
      startTimeRef.current = null;
    
  }, [isStreaming, outputTokens]);

  return { speed, isStreaming };
}

export function TokenInfo() {
  const { lastStatus, tokenUsage, activeTokenUsage } = useChatStore();
  const { currentModel, models } = useSettingsStore();
  const { speed } = useTokenSpeed();

  const currentModelConfig = models.find((m) => m.id === currentModel);

  const inputTotal =
    tokenUsage.input_other +
    tokenUsage.input_cache_read +
    tokenUsage.input_cache_creation +
    activeTokenUsage.input_other +
    activeTokenUsage.input_cache_read +
    activeTokenUsage.input_cache_creation;

  const outputTotal = tokenUsage.output + activeTokenUsage.output;
  const grandTotal = inputTotal + outputTotal;

  const contextPercent = lastStatus?.context_usage ? Math.round(lastStatus.context_usage * 1000) / 10 : 0;

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Token Usage & Performance</div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col p-2 rounded bg-muted/40 border border-border/40">
          <span className="text-muted-foreground text-[10px] flex items-center gap-1">
            <IconGauge className="size-3" /> Context Window
          </span>
          <span className={cn("text-sm font-semibold mt-0.5", contextPercent > 80 && "text-amber-500", contextPercent > 95 && "text-destructive")}>
            {contextPercent}%
          </span>
          <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
            {grandTotal.toLocaleString()} tokens used
          </span>
        </div>

        <div className="flex flex-col p-2 rounded bg-muted/40 border border-border/40">
          <span className="text-muted-foreground text-[10px] flex items-center gap-1">
            <IconBolt className="size-3 text-amber-400" /> Generation Speed
          </span>
          <span className="text-sm font-semibold font-mono text-foreground mt-0.5">
            {speed > 0 ? `${speed.toFixed(1)} tok/s` : "Idle"}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
            Model: {currentModelConfig?.name ?? currentModel ?? "Default"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs pt-1">
        <div className="flex flex-col p-1.5 rounded bg-muted/20">
          <span className="text-muted-foreground text-[10px]">Input</span>
          <span className="font-mono text-[11px]">{inputTotal.toLocaleString()}</span>
        </div>
        <div className="flex flex-col p-1.5 rounded bg-muted/20">
          <span className="text-muted-foreground text-[10px]">Output</span>
          <span className="font-mono text-[11px]">{outputTotal.toLocaleString()}</span>
        </div>
        <div className="flex flex-col p-1.5 rounded bg-muted/20">
          <span className="text-muted-foreground text-[10px]">Cache Read</span>
          <span className="font-mono text-[11px]">
            {(tokenUsage.input_cache_read + activeTokenUsage.input_cache_read).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChatStatus() {
  const { lastStatus, tokenUsage, activeTokenUsage } = useChatStore();
  const { speed, isStreaming } = useTokenSpeed();

  if (!lastStatus && !isStreaming) {
    return null;
  }

  const context_usage = lastStatus?.context_usage;
  const retrying = lastStatus?.retrying;

  const inputTotal =
    tokenUsage.input_other +
    tokenUsage.input_cache_read +
    tokenUsage.input_cache_creation +
    activeTokenUsage.input_other +
    activeTokenUsage.input_cache_read +
    activeTokenUsage.input_cache_creation;

  const outputTotal = tokenUsage.output + activeTokenUsage.output;
  const contextPercent = context_usage ? Math.round(context_usage * 1000) / 10 : 0;

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground border border-border/40 rounded-full px-2.5 py-0.5 select-none h-6 box-border mr-2 @max-[240px]:hidden bg-muted/20">
      {retrying && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-amber-500 font-mono">
              <IconRefresh className="size-3 animate-spin" />
              Retry {retrying.next_attempt}/{retrying.max_attempts}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Retrying in {Math.ceil(retrying.delay_ms / 1000)}s: {retrying.message}
          </TooltipContent>
        </Tooltip>
      )}
      {retrying && <div className="w-px h-3 bg-border/50" />}

      {/* Real-time Token Generation Speed */}
      {speed > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-amber-500 font-mono font-medium">
              <IconBolt className="size-3 fill-amber-400/20 text-amber-400 animate-pulse" />
              <span>{speed.toFixed(1)} t/s</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Live Generation Speed (tokens / second)</TooltipContent>
        </Tooltip>
      )}
      {speed > 0 && <div className="w-px h-3 bg-border/50" />}

      {/* Context Window Usage */}
      <div className="flex items-center gap-1" title="Context Window Usage">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 font-mono">
              <IconGauge className="size-3 opacity-70" />
              <span className={cn(contextPercent > 70 && "text-amber-500", contextPercent > 90 && "text-destructive font-semibold")}>
                {contextPercent}%
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Context Window Usage ({contextPercent}%)</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-px h-3 bg-border/50 @max-[440px]:hidden" />

      {/* Input Tokens */}
      <div className="flex items-center gap-1 @max-[440px]:hidden" title="Total Input Tokens">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 font-mono">
              <IconArrowUp className="size-3 opacity-70" />
              <span>{inputTotal.toLocaleString()}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Total Input Tokens</TooltipContent>
        </Tooltip>
      </div>

      <div className="w-px h-3 bg-border/50 @max-[440px]:hidden" />

      {/* Output Tokens */}
      <div className="flex items-center gap-1 @max-[440px]:hidden" title="Output Tokens">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 font-mono">
              <IconArrowDown className="size-3 opacity-70" />
              <span>{outputTotal.toLocaleString()}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>Total Output Tokens</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
