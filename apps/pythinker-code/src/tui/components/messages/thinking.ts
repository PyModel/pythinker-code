/**
 * Renders thinking content in the transcript.
 * Supports live in-place updates while thinking streams, then finalizes
 * without replacing the component.
 * Supports expand/collapse via Ctrl+O (shared with tool output).
 */

import { Markdown, truncateToWidth, type Component, type TUI } from '@earendil-works/pi-tui';

import {
  formatThinkingSpinnerLabel,
  MESSAGE_INDENT,
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  THINKING_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme, createPythinkerThinkingMarkdownTheme } from '#/tui/theme';
import { shimmerText } from '#/tui/utils/shimmer';

export type ThinkingRenderMode = 'live' | 'finalized';

export class ThinkingComponent implements Component {
  private text: string;
  private showMarker: boolean;
  private mode: ThinkingRenderMode;
  private expanded = false;
  private readonly ui: TUI | undefined;
  private spinnerFrame = 0;
  private animationFrame = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  // Hold a single Markdown instance so pi-tui's (text, width) → lines cache
  // actually survives across renders. Re-constructing per render destroys
  // the cache and forces full re-wrap on every frame, which dominates CPU
  // once the transcript accumulates many finalized thinking blocks.
  private textComponent: Markdown;

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
    this.textComponent = this.createMarkdown(text);
    if (mode === 'live') {
      this.startSpinner();
    }
  }

  invalidate(): void {
    // Markdown caches its default-style ANSI prefix on first render; rebuild
    // the instance so a theme switch re-styles with the new palette.
    this.textComponent = this.createMarkdown(this.text);
  }

  private createMarkdown(text: string): Markdown {
    return new Markdown(text, 0, 0, createPythinkerThinkingMarkdownTheme(), {
      color: (t) => currentTheme.fg('textDim', t),
      italic: true,
    });
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.textComponent.setText(text);
  }

  finalize(): void {
    this.mode = 'finalized';
    this.stopSpinner();
  }

  dispose(): void {
    this.stopSpinner();
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
  }

  render(width: number): string[] {
    const contentWidth = Math.max(1, width - MESSAGE_INDENT.length);
    const contentLines = this.text.length > 0 ? this.textComponent.render(contentWidth) : [''];

    if (this.mode === 'live') {
      const visibleLines =
        contentLines.length > THINKING_PREVIEW_LINES
          ? contentLines.slice(contentLines.length - THINKING_PREVIEW_LINES)
          : contentLines;
      const spinner = currentTheme.fg(
        'primary',
        `${BRAILLE_SPINNER_FRAMES[this.spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0]} `,
      );
      const label = shimmerText(formatThinkingSpinnerLabel(), {
        baseToken: 'primary',
        shimmerToken: 'primaryShimmer',
        frame: this.animationFrame,
        windowSize: 4,
      });
      return ['', spinner + label, ...visibleLines.map((line) => MESSAGE_INDENT + line)];
    }

    const rendered: string[] = [''];
    for (let i = 0; i < contentLines.length; i++) {
      const p = i === 0 && this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
      rendered.push(p + contentLines[i]);
    }

    if (this.expanded || contentLines.length <= THINKING_PREVIEW_LINES) {
      return rendered;
    }

    // Leading blank + first PREVIEW_LINES content lines + hint line.
    const truncated = rendered.slice(0, 1 + THINKING_PREVIEW_LINES);
    const remaining = contentLines.length - THINKING_PREVIEW_LINES;
    const hint = `... (${String(remaining)} more lines, ctrl+o to expand)`;
    const indentWidth = Math.min(MESSAGE_INDENT.length, Math.max(0, width));
    const hintWidth = Math.max(0, width - indentWidth);
    truncated.push(
      ' '.repeat(indentWidth) + currentTheme.dim(truncateToWidth(hint, hintWidth, '…')),
    );
    return truncated;
  }

  private startSpinner(): void {
    if (this.ui === undefined || this.spinnerInterval !== undefined) return;
    this.spinnerInterval = setInterval(() => {
      this.animationFrame += 1;
      this.spinnerFrame = (this.spinnerFrame + 1) % BRAILLE_SPINNER_FRAMES.length;
      this.ui?.requestRender();
    }, BRAILLE_SPINNER_INTERVAL_MS);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval === undefined) return;
    clearInterval(this.spinnerInterval);
    this.spinnerInterval = undefined;
  }
}
