/**
 * Renders a compaction block in the transcript.
 *
 * Lifecycle:
 *   - constructed on `compaction.started` → elapsed-time label,
 *     a progress bar, and optional custom
 *     instruction
 *   - `markDone()` on `compaction.completed` → collapsed
 *     "└ Compacted (ctrl+o to see full summary)"; ctrl+o (the shared
 *     `Expandable` contract) reveals the token counts and the summary text
 *   - `markCanceled()` on `compaction.cancelled` → solid warning bullet +
 *     "Compaction cancelled"
 */

import { Container, Text, Spacer } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';

import { BRAILLE_SPINNER_INTERVAL_MS, MESSAGE_INDENT } from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { shimmerText } from '#/tui/utils/shimmer';

/** Summary body sits under the "└ " marker the done line opens with. */
const SUMMARY_INDENT = `${MESSAGE_INDENT}  `;

const BAR_FILLED = '▰';
const BAR_EMPTY = '▱';
const BAR_MAX_WIDTH = 40;

/**
 * The agent emits no progress events between `compaction.started` and
 * `compaction.completed`, so elapsed seconds double as the percentage. The
 * ceiling keeps it short of full so only the completion event can finish it.
 */
const PROGRESS_CEILING = 0.95;

export class CompactionComponent extends Container {
  private readonly ui: TUI | undefined;
  private readonly instruction: string | undefined;
  private readonly startedAt = Date.now();
  private headerText: Text;
  private barText: Text | undefined;
  private barWidth = BAR_MAX_WIDTH;
  private animationFrame = 0;
  private animationTimer: ReturnType<typeof setInterval> | null = null;
  private done = false;
  private canceled = false;
  private expanded = false;
  private tokensBefore: number | undefined;
  private tokensAfter: number | undefined;
  private summary: string | undefined;

  constructor(ui?: TUI, instruction?: string | undefined) {
    super();
    this.ui = ui;
    this.instruction = instruction;
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.rebuildChildren();
    this.startAnimation();
  }

  private get running(): boolean {
    return !this.done && !this.canceled;
  }

  /**
   * Rebuilds the child list. Called on construction and on state changes
   * (done/cancelled/theme switch) — animation ticks reuse the existing Text
   * nodes via `setText` instead.
   */
  private rebuildChildren(): void {
    this.clear();
    // Top margin so the block isn't glued to the previous transcript entry.
    this.addChild(new Spacer(1));
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.addChild(this.headerText);

    if (this.running) {
      this.barText = new Text(this.buildBar(), 0, 0);
      this.addChild(this.barText);
    } else {
      this.barText = undefined;
    }

    if (this.done && this.expanded && this.summary !== undefined) {
      for (const line of this.summary.split('\n')) {
        this.addChild(new Text(currentTheme.dim(`${SUMMARY_INDENT}${line}`), 0, 0));
      }
    }

    if (this.instruction !== undefined) {
      this.addChild(new Text(currentTheme.dim(`  ${this.instruction}`), 0, 0));
    }
  }

  override render(width: number): string[] {
    // Leave room for the two-space indent and the trailing " 100%".
    const nextBarWidth = Math.max(8, Math.min(BAR_MAX_WIDTH, width - 10));
    if (nextBarWidth !== this.barWidth) {
      this.barWidth = nextBarWidth;
    }
    if (this.running) {
      this.headerText.setText(this.buildHeader());
      this.barText?.setText(this.buildBar());
    }
    return super.render(width);
  }

  override invalidate(): void {
    // Text nodes cache ANSI codes, so a palette switch needs fresh ones.
    this.rebuildChildren();
    super.invalidate();
  }

  markDone(tokensBefore?: number, tokensAfter?: number, summary?: string): void {
    if (!this.running) return;
    this.done = true;
    this.tokensBefore = tokensBefore;
    this.tokensAfter = tokensAfter;
    const trimmed = summary?.trim();
    this.summary = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    this.stopAnimation();
    this.rebuildChildren();
    this.ui?.requestRender();
  }

  /** Shared ctrl+o contract — see `utils/component-capabilities`. */
  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    if (this.done) this.rebuildChildren();
  }

  markCanceled(): void {
    if (!this.running) return;
    this.canceled = true;
    this.stopAnimation();
    this.rebuildChildren();
    this.ui?.requestRender();
  }

  dispose(): void {
    this.stopAnimation();
  }

  /** Elapsed-time estimate in the range [0, PROGRESS_CEILING]. */
  private progressRatio(): number {
    return Math.min(PROGRESS_CEILING, this.elapsedSeconds() / 100);
  }

  private elapsedSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this.startedAt) / 1_000));
  }

  private buildBar(): string {
    const ratio = this.progressRatio();
    const filled = Math.min(this.barWidth, Math.round(ratio * this.barWidth));
    const filledBar = currentTheme.fg('primary', BAR_FILLED.repeat(filled));
    const emptyBar = currentTheme.fg('progressEmpty', BAR_EMPTY.repeat(this.barWidth - filled));
    const percent = currentTheme.dim(` ${String(Math.round(ratio * 100))}%`);
    return `  ${filledBar}${emptyBar}${percent}`;
  }

  private buildHeader(): string {
    if (this.done) {
      const tokens =
        this.tokensBefore !== undefined && this.tokensAfter !== undefined
          ? ` (${String(this.tokensBefore)} → ${String(this.tokensAfter)} tokens)`
          : '';
      // Collapsed, the line advertises ctrl+o; expanded it yields that space
      // to the token counts, with the summary rendered underneath.
      const detail =
        this.summary !== undefined && !this.expanded ? ' (ctrl+o to see full summary)' : tokens;
      return `${MESSAGE_INDENT}${currentTheme.dim('└')} ${currentTheme.dim(`Compacted${detail}`)}`;
    }
    if (this.canceled) {
      const bullet = currentTheme.fg('warning', STATUS_BULLET);
      const label = currentTheme.boldFg('warning', 'Compaction cancelled');
      return `${bullet}${label}`;
    }
    const label = currentTheme.bold(
      shimmerText('Compacting conversation…', {
        baseToken: 'primary',
        shimmerToken: 'primaryShimmer',
      }),
    );
    return `${label}${currentTheme.dim(` (${String(this.elapsedSeconds())}s)`)}`;
  }

  private startAnimation(): void {
    this.animationTimer = setInterval(() => {
      this.animationFrame += 1;
      this.headerText.setText(this.buildHeader());
      this.barText?.setText(this.buildBar());
      this.ui?.requestRender();
    }, BRAILLE_SPINNER_INTERVAL_MS);
  }

  private stopAnimation(): void {
    if (this.animationTimer !== null) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  }
}
