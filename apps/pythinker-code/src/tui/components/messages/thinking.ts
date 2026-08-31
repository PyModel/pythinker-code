/**
 * Renders thinking content in the transcript.
 * Supports live in-place updates while thinking streams, then finalizes
 * without replacing the component.
 * Supports expand/collapse via Ctrl+O (shared with tool output).
 */

import { Text, truncateToWidth, type Component, type TUI } from '@pymodel/pi-tui';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
  MESSAGE_INDENT,
  THINKING_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';
import { shimmerText } from '#/tui/utils/shimmer';

export type ThinkingRenderMode = 'live' | 'finalized';

export class ThinkingComponent implements Component {
  private text: string;
  private showMarker: boolean;
  private mode: ThinkingRenderMode;
  private expanded = false;
  private readonly ui: TUI | undefined;
  private spinnerFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  // Hold a single Text instance so pi-tui's (text, width) → lines cache
  // actually survives across renders. Re-constructing per render destroys
  // the cache and forces full re-wrap on every frame, which dominates CPU
  // once the transcript accumulates many finalized thinking blocks.
  private readonly textComponent: Text;

  private renderCache: { width: number; lines: string[] } | undefined;

  constructor(
    text: string,
    showMarker: boolean = true,
    mode: ThinkingRenderMode = 'finalized',
    ui?: TUI,
  ) {
    this.text = text;
    this.showMarker = showMarker;
    this.mode = mode;
    this.ui = ui;
    this.textComponent = new Text(this.styled(text), 0, 0);
    if (mode === 'live') {
      this.startSpinner();
    }
  }

  private markRenderDirty(): void {
    this.renderCache = undefined;
  }

  invalidate(): void {
    this.markRenderDirty();
    this.textComponent.setText(this.styled(this.text));
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.markRenderDirty();
    this.textComponent.setText(this.styled(text));
  }

  private styled(text: string): string {
    return currentTheme.italicFg('textDim', text);
  }

  finalize(): void {
    this.mode = 'finalized';
    this.markRenderDirty();
    this.stopSpinner();
  }

  dispose(): void {
    this.stopSpinner();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.markRenderDirty();
  }

  render(width: number): string[] {
    if (
      isRenderCacheEnabled() &&
      this.renderCache !== undefined &&
      this.renderCache.width === width
    ) {
      return this.renderCache.lines;
    }

    let rendered: string[];
    if (this.mode === 'live') {
      const spinner = currentTheme.fg(
        'primary',
        `${BRAILLE_SPINNER_FRAMES[this.spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0]} `,
      );
      const label = shimmerText(formatThinkingSpinnerLabel(), {
        baseToken: 'primary',
        shimmerToken: 'primaryShimmer',
        bandHalfWidth: 4,
      });
      rendered = ['', spinner + label];
      if (this.expanded) {
        const contentLines = this.renderContent(width);
        const visibleLines =
          contentLines.length > THINKING_PREVIEW_LINES
            ? contentLines.slice(contentLines.length - THINKING_PREVIEW_LINES)
            : contentLines;
        rendered.push(...visibleLines.map((line) => MESSAGE_INDENT + line));
      }
    } else if (!this.expanded) {
      if (this.text.length === 0) {
        rendered = [];
      } else {
        const contentLines = this.renderContent(width);
        const hint = `… (${String(contentLines.length)} more lines, ctrl+o to expand)`;
        const prefix = this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
        const styledHint = currentTheme.fg(
          'textDim',
          truncateToWidth(hint, Math.max(1, width - MESSAGE_INDENT.length), '…'),
        );
        rendered = ['', prefix + styledHint];
      }
    } else {
      const contentLines = this.renderContent(width);
      const lines: string[] = [''];
      for (let i = 0; i < contentLines.length; i++) {
        const p = i === 0 && this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
        lines.push(p + contentLines[i]);
      }
      rendered = lines;
    }

    if (isRenderCacheEnabled()) {
      this.renderCache = { width, lines: rendered };
    }
    return rendered;
  }

  private renderContent(width: number): string[] {
    if (this.text.length === 0) return [''];
    return this.textComponent.render(Math.max(1, width - MESSAGE_INDENT.length));
  }

  private startSpinner(): void {
    if (this.ui === undefined || this.spinnerInterval !== undefined) return;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % BRAILLE_SPINNER_FRAMES.length;
      this.markRenderDirty();
      this.ui?.requestRender();
    }, BRAILLE_SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval === undefined) return;
    clearInterval(this.spinnerInterval);
    this.spinnerInterval = undefined;
  }
}
