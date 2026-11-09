// apps/pythinker-web/src/components/chatTurnRendering.ts
// Pure turn-rendering helpers: pure functions of their arguments (no Vue
// reactivity, no component state). Shared by ChatPane.vue's template and its
// stateful copy/edit helpers.
import type { ChatTurn, TurnBlock } from '../types';

// Shared 1024-based token formatter (lib/formatTokens); re-exported so the
// existing ChatPane import keeps working.
export { formatTokens } from '../lib/formatTokens';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(1);
  return `${m}m${s}s`;
}

/** Whole-second compact duration for the LIVE timers in TurnFold and
 *  ActivityRun: 45s, 1m3s, 2h5m. Returns '' below one second so a
 *  freshly-started live turn falls back to the "Work details" label. */
export function formatLiveDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return total === 0 ? '' : `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) {
    const s = total % 60;
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h${r}m`;
}

// Ordered render blocks for an assistant turn. messagesToTurns supplies `blocks`
// (thinking + text + tool cards in call order); fall back to deriving them from
// the aggregate fields for any turn built without blocks (e.g. unit tests).
export function turnBlocks(turn: ChatTurn): TurnBlock[] {
  if (turn.blocks) return turn.blocks;
  const blocks: TurnBlock[] = [];
  if (turn.thinking) blocks.push({ kind: 'thinking', thinking: turn.thinking });
  if (turn.text) blocks.push({ kind: 'text', text: turn.text });
  for (const tool of turn.tools ?? []) blocks.push({ kind: 'tool', tool });
  return blocks;
}

/** Parse an ISO timestamp to ms epoch; undefined when absent or invalid. */
export function blockStartedMs(startedAt: string | undefined): number | undefined {
  if (startedAt === undefined) return undefined;
  const ms = Date.parse(startedAt);
  return Number.isNaN(ms) ? undefined : ms;
}

/** A thinking block whose stream ended (durationMs frozen when the next part
 *  started or the step/turn ended) is never the live tail — the run header
 *  and fold must not keep shimmering "Thinking…" for it: a frozen durationMs
 *  is the settled marker every consumer checks. */
export function isSettledThinking(block: { kind?: string; durationMs?: number }): boolean {
  return block.kind === 'thinking' && block.durationMs !== undefined;
}

/** Earliest thinking start across the turn's blocks — seeds
 *  the TurnFold live timer so "Worked Ns" measures from the first thought,
 *  not the first visible text. */
export function earliestThinkingMs(turn: ChatTurn): number | undefined {
  let earliest: number | undefined;
  for (const block of turnBlocks(turn)) {
    if (block.kind === 'activity-run') {
      for (const item of block.items) {
        if (item.kind !== 'thinking') continue;
        const ms = blockStartedMs(item.startedAt);
        if (ms !== undefined && (earliest === undefined || ms < earliest)) earliest = ms;
      }
      continue;
    }
    if (block.kind !== 'thinking') continue;
    const ms = blockStartedMs(block.startedAt);
    if (ms !== undefined && (earliest === undefined || ms < earliest)) earliest = ms;
  }
  return earliest;
}

export type ToolStackPosition = 'single' | 'first' | 'middle' | 'last';

export type ToolStackItem = {
  tool: Extract<TurnBlock, { kind: 'tool' }>['tool'];
  sourceIndex: number;
};

/** One item inside a render-level `activity-run` block: a thinking segment or
 *  a tool card, each carrying its index in the turn's block list so stream
 *  markers can be pinned to the single live tail item. */
export type RunItem =
  | { kind: 'thinking'; thinking: string; startedAt?: string; durationMs?: number; sourceIndex: number }
  | { kind: 'tool'; tool: ToolStackItem['tool']; sourceIndex: number };

export type AssistantRenderBlock =
  | { kind: 'thinking'; thinking: string; startedAt?: string; durationMs?: number; sourceIndex: number }
  | { kind: 'text'; text: string; sourceIndex: number }
  | { kind: 'tool'; tool: ToolStackItem['tool']; sourceIndex: number }
  | { kind: 'tool-stack'; tools: ToolStackItem[] }
  | { kind: 'activity-run'; items: RunItem[] }
  | {
      kind: 'notification';
      items: Extract<TurnBlock, { kind: 'notification' }>['notification'][];
      sourceIndex: number;
    };

export function rendersToolCard(block: Extract<TurnBlock, { kind: 'tool' }>): boolean {
  return !(block.tool.status === 'ok' && block.tool.media);
}

export function toolStackPosition(index: number, count: number): ToolStackPosition {
  if (count <= 1) return 'single';
  if (index === 0) return 'first';
  if (index === count - 1) return 'last';
  return 'middle';
}

/**
 * @param groupRuns  When false, consecutive thinking/tool items stay separate
 *   rows instead of collapsing into one `activity-run` summary (the
 *   "Tool call summary" setting).
 */
export function assistantRenderBlocks(
  turn: ChatTurn,
  groupRuns = true,
): AssistantRenderBlock[] {
  // Run grouping is per-turn BY CONSTRUCTION, not a wire mapping. The reference
  // UI renders one `activity-run` per daemon run/round (an LLM-loop iteration
  // between user turns), but the pythinker wire carries NO run, segment, or
  // step identifier on the web-facing transcript: message content is
  // text/thinking/tool_use/tool_result with no `step`/`ordinal`/`runId`, and
  // the engine's per-step ordinal only exists server-side in the transcript
  // service (agent-gateway coreEventMap step.ordinals lookup) — it is not
  // exposed to the session WS payloads the web client consumes. The per-turn
  // session has exactly one main-agent run (turn.started → turn.ended), so
  // grouping ALL of a turn's thinking/tool blocks into a single fold — flushed
  // only at text/media boundaries — is the faithful mapping: one run per turn.
  // Splitting a turn into multiple `activity-run` blocks would require the
  // daemon to emit a per-step/segment boundary on the web wire; until then any
  // finer split would be invented, not derived.
  //
  // Source blocks may themselves carry `activity-run` groups (structural
  // parity with the reference turn model); flatten them back into their
  // thinking/tool items before re-grouping.
  const blocks = turnBlocks(turn).flatMap((block) =>
    block.kind === 'activity-run' ? block.items : [block],
  );
  const rendered: AssistantRenderBlock[] = [];
  let run: RunItem[] = [];
  let notificationGroup:
    | {
        items: Extract<TurnBlock, { kind: 'notification' }>['notification'][];
        sourceIndex: number;
      }
    | null = null;

  const pushRunItem = (item: RunItem) => {
    if (item.kind === 'thinking') rendered.push({ kind: 'thinking', thinking: item.thinking, startedAt: item.startedAt, durationMs: item.durationMs, sourceIndex: item.sourceIndex });
    else rendered.push({ kind: 'tool', tool: item.tool, sourceIndex: item.sourceIndex });
  };

  const flushRun = () => {
    const [item] = run;
    if (run.length === 1 && item) {
      pushRunItem(item);
    } else if (run.length > 1) {
      if (groupRuns) rendered.push({ kind: 'activity-run', items: run });
      else for (const runItem of run) pushRunItem(runItem);
    }
    run = [];
  };

  const flushNotifications = () => {
    if (notificationGroup !== null) {
      rendered.push({
        kind: 'notification',
        items: notificationGroup.items,
        sourceIndex: notificationGroup.sourceIndex,
      });
    }
    notificationGroup = null;
  };

  blocks.forEach((block, sourceIndex) => {
    if (block.kind === 'notification') {
      flushRun();
      if (notificationGroup === null) {
        notificationGroup = { items: [block.notification], sourceIndex };
      } else {
        notificationGroup.items.push(block.notification);
      }
      return;
    }
    if (run.length === 0) flushNotifications();
    if (block.kind === 'thinking') {
      run.push({ kind: 'thinking', thinking: block.thinking, startedAt: block.startedAt, durationMs: block.durationMs, sourceIndex });
      return;
    }
    if (block.kind === 'tool') {
      if (rendersToolCard(block)) {
        run.push({ kind: 'tool', tool: block.tool, sourceIndex });
        return;
      }
      flushRun();
      rendered.push({ kind: 'tool', tool: block.tool, sourceIndex });
      return;
    }

    flushRun();
    flushNotifications();
    if (block.kind === 'text' && block.text) {
      rendered.push({ kind: 'text', text: block.text, sourceIndex });
    }
  });

  flushRun();
  flushNotifications();
  return rendered;
}

/**
 * @param enabled  When false, nothing folds: every block stays visible (the
 *   "Auto-fold messages" setting).
 */
export function foldRenderBlocks(
  blocks: AssistantRenderBlock[],
  enabled = true,
): { folded: AssistantRenderBlock[]; visible: AssistantRenderBlock[] } {
  if (!enabled) return { folded: [], visible: blocks };
  let anchor = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === 'text' && block.text.trim()) {
      anchor = index;
      break;
    }
  }
  if (anchor < 0) {
    anchor = blocks.findIndex((block) =>
      (block.kind === 'tool' && !rendersToolCard({ kind: 'tool', tool: block.tool })) ||
      block.kind === 'notification',
    );
  }
  if (anchor < 0) return { folded: blocks, visible: [] };
  const folded = blocks.slice(0, anchor);
  const visible = blocks.slice(anchor);
  const notifications = folded.filter((block) => block.kind === 'notification');
  if (notifications.length === 0) return { folded, visible };
  return {
    folded: folded.filter((block) => block.kind !== 'notification'),
    visible: [...notifications, ...visible],
  };
}

/**
 * The answer the user reads. Mirrors the fold anchor in `foldRenderBlocks`:
 * text from the last non-empty text block onward. Narration emitted before a
 * tool call ("I'll rerun it…") folds away on screen, so it must not end up on
 * the clipboard either.
 */
export function turnFinalText(turn: ChatTurn): string {
  const texts = turnBlocks(turn).flatMap((blk) => (blk.kind === 'text' && blk.text ? [blk.text] : []));
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    if (texts[index]!.trim()) return texts[index]!;
  }
  return '';
}

/** Convert a single turn to Markdown. */
export function turnToMarkdown(turn: ChatTurn): string {
  const parts: string[] = [];
  for (const blk of turnBlocks(turn)) {
    if (blk.kind === 'thinking' && blk.thinking) {
      parts.push(`> **Thinking**\n> ${blk.thinking.split('\n').join('\n> ')}`);
    } else if (blk.kind === 'text' && blk.text) {
      parts.push(blk.text);
    } else if (blk.kind === 'tool' && blk.tool.output && blk.tool.output.length > 0) {
      const output = blk.tool.output.join('\n');
      parts.push(`\`\`\`\n[${blk.tool.name}]\n${output}\n\`\`\``);
    } else if (blk.kind === 'activity-run') {
      for (const item of blk.items) {
        if (item.kind === 'thinking' && item.thinking) {
          parts.push(`> **Thinking**\n> ${item.thinking.split('\n').join('\n> ')}`);
        } else if (item.kind === 'tool' && item.tool.output && item.tool.output.length > 0) {
          const output = item.tool.output.join('\n');
          parts.push(`\`\`\`\n[${item.tool.name}]\n${output}\n\`\`\``);
        }
      }
    } else if (blk.kind === 'notification') {
      const notification = blk.notification;
      const lines = [notification.title, notification.type, ...notification.body.split('\n')]
        .filter((line) => line !== '');
      const summary = lines.length > 0
        ? `> **Notification**\n> ${lines.join('\n> ')}`
        : '';
      const output = notification.outputPreview?.text ?? '';
      const preview = output !== ''
        ? `\`\`\`\n[output-preview]\n${output}\n\`\`\``
        : '';
      const markdown = [summary, preview].filter((part) => part !== '').join('\n\n');
      if (markdown !== '') parts.push(markdown);
    }
  }
  return parts.join('\n\n');
}

export function toolStackKey(item: ToolStackItem): string {
  return item.tool.id || `tool-${item.sourceIndex}`;
}

export function renderBlockKey(block: AssistantRenderBlock, index: number): string {
  if (block.kind === 'tool-stack') {
    return `tool-stack-${block.tools[0]?.sourceIndex ?? index}`;
  }
  if (block.kind === 'activity-run') {
    return `activity-run-${block.items[0]?.sourceIndex ?? index}`;
  }
  if (block.kind === 'tool') return toolStackKey({ tool: block.tool, sourceIndex: block.sourceIndex });
  return `${block.kind}-${block.sourceIndex}`;
}

export function runItemKey(item: RunItem): string {
  if (item.kind === 'tool') return toolStackKey({ tool: item.tool, sourceIndex: item.sourceIndex });
  return `thinking-${item.sourceIndex}`;
}
