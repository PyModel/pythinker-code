/**
 * TranscriptViewport — fixed-height window over the transcript.
 *
 * Renders the wrapped transcript container into a flat line buffer and
 * emits exactly `height` lines per frame: a slice of that buffer, padded
 * at the bottom with blanks so the layout root can pin the editor and
 * footer to the terminal's last rows. The viewport owns transcript
 * scrolling (mouse wheel via MouseController) and drag selection;
 * native terminal scrollback is intentionally unused in the fixed
 * layout, so the transcript buffer here is the only history.
 */

import {
  type Component,
  type Container,
  sliceByColumn,
  visibleWidth,
} from '@earendil-works/pi-tui';

/** A cell position inside the transcript buffer (0-based row/column). */
export interface ViewportCell {
  readonly row: number;
  readonly col: number;
}

/** An ordered selection range within the transcript buffer. */
export interface ViewportSelection {
  readonly start: ViewportCell;
  readonly end: ViewportCell;
}

const INVERSE_ON = '\u001B[7m';
const INVERSE_OFF = '\u001B[27m';

// SGR / private CSI sequences and OSC strings (e.g. hyperlinks). Used to
// recover plain text for clipboard copies.
// oxlint-disable-next-line no-control-regex -- ESC/BEL are required to match ANSI sequences
const ANSI_PATTERN = /\u001B\[[0-9;?]*[a-zA-Z]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/gu;

/** Removes SGR/OSC escape sequences from a line, keeping plain text for clipboard copies. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_PATTERN, '');
}

export class TranscriptViewport implements Component {
  private height = 1;
  /** Lines the window is shifted up from the tail; 0 pins it to the bottom. */
  private scrollOffset = 0;
  private lastBuffer: string[] = [];
  private anchor: ViewportCell | undefined;
  private active: ViewportCell | undefined;
  /** 0-based screen column range of the "N more" chip, on the region's last row. */
  private chipCols: { start: number; end: number } | undefined;

  constructor(private readonly transcript: Container) {}

  setHeight(height: number): void {
    this.height = Math.max(1, height);
  }

  getHeight(): number {
    return this.height;
  }

  getScrollOffset(): number {
    return this.scrollOffset;
  }

  isPinned(): boolean {
    return this.scrollOffset === 0;
  }

  scrollBy(delta: number): void {
    this.scrollOffset = this.clampOffset(this.scrollOffset + delta);
  }

  scrollToBottom(): void {
    this.scrollOffset = 0;
  }

  private clampOffset(offset: number): number {
    const max = Math.max(0, this.lastBuffer.length - this.height);
    return Math.min(Math.max(0, offset), max);
  }

  // --- Selection -------------------------------------------------------

  setSelection(anchor: ViewportCell, active: ViewportCell): void {
    this.anchor = anchor;
    this.active = active;
  }

  extendSelection(active: ViewportCell): void {
    if (this.anchor === undefined) return;
    this.active = active;
  }

  clearSelection(): void {
    this.anchor = undefined;
    this.active = undefined;
  }

  hasSelection(): boolean {
    return this.orderedSelection() !== undefined;
  }

  private orderedSelection(): ViewportSelection | undefined {
    if (this.anchor === undefined || this.active === undefined) return undefined;
    const before = (a: ViewportCell, b: ViewportCell): number => a.row - b.row || a.col - b.col;
    const ordered =
      before(this.anchor, this.active) <= 0
        ? { start: this.anchor, end: this.active }
        : { start: this.active, end: this.anchor };
    // A bare click (anchor == active) is not a selection.
    if (ordered.start.row === ordered.end.row && ordered.start.col === ordered.end.col) {
      return undefined;
    }
    return ordered;
  }

  /** Map a 1-based screen position to transcript buffer coordinates. */
  screenToBuffer(screenRow: number, screenCol: number): ViewportCell | undefined {
    if (screenRow < 1 || screenRow > this.height) return undefined;
    if (this.lastBuffer.length === 0) return undefined;
    // Derive the window top from the last buffer each call so wheel scrolls
    // apply even before the next render refreshes `lastBuffer`.
    const top = Math.max(0, this.lastBuffer.length - this.height) - this.scrollOffset;
    const row = Math.min(top + (screenRow - 1), this.lastBuffer.length - 1);
    return { row, col: Math.max(0, screenCol - 1) };
  }

  /** True when the 1-based screen position lands on the "N more" chip. */
  chipHit(screenRow: number, screenCol: number): boolean {
    if (this.scrollOffset === 0 || this.chipCols === undefined) return false;
    if (screenRow !== this.height) return false;
    const col = screenCol - 1;
    return col >= this.chipCols.start && col < this.chipCols.end;
  }

  /** Plain-text contents of the current selection, for the clipboard. */
  extractSelectionText(): string {
    const selection = this.orderedSelection();
    if (selection === undefined) return '';
    const lines: string[] = [];
    const lastRow = Math.min(selection.end.row, this.lastBuffer.length - 1);
    for (let row = selection.start.row; row <= lastRow; row++) {
      const line = this.lastBuffer[row] ?? '';
      const lineWidth = visibleWidth(line);
      const from = row === selection.start.row ? Math.min(selection.start.col, lineWidth) : 0;
      const to = row === selection.end.row ? Math.min(selection.end.col, lineWidth) : lineWidth;
      lines.push(stripAnsi(sliceByColumn(line, from, Math.max(0, to - from))).trimEnd());
    }
    return lines.join('\n').trimEnd();
  }

  private applySelectionHighlight(
    line: string,
    bufferRow: number,
    selection: ViewportSelection,
  ): string {
    if (bufferRow < selection.start.row || bufferRow > selection.end.row) return line;
    const lineWidth = visibleWidth(line);
    if (lineWidth === 0) return line;
    const from = bufferRow === selection.start.row ? Math.min(selection.start.col, lineWidth) : 0;
    const to = bufferRow === selection.end.row ? Math.min(selection.end.col, lineWidth) : lineWidth;
    if (to <= from) return line;
    return (
      sliceByColumn(line, 0, from) +
      INVERSE_ON +
      sliceByColumn(line, from, to - from) +
      INVERSE_OFF +
      sliceByColumn(line, to, lineWidth - to)
    );
  }

  // --- Render ----------------------------------------------------------

  render(width: number): string[] {
    const buffer = this.transcript.render(width);
    // While scrolled up, appended lines would otherwise shift the visible
    // window (top = maxTop - offset); grow the offset to hold it steady.
    if (this.scrollOffset > 0 && buffer.length > this.lastBuffer.length) {
      this.scrollOffset += buffer.length - this.lastBuffer.length;
    }
    this.lastBuffer = buffer;
    this.scrollOffset = this.clampOffset(this.scrollOffset);
    const top = Math.max(0, buffer.length - this.height) - this.scrollOffset;

    const selection = this.orderedSelection();
    const lines: string[] = [];
    for (let i = 0; i < this.height; i++) {
      const bufferRow = top + i;
      let line = bufferRow < buffer.length ? (buffer[bufferRow] ?? '') : '';
      if (selection !== undefined) {
        line = this.applySelectionHighlight(line, bufferRow, selection);
      }
      lines.push(line);
    }

    if (this.scrollOffset > 0 && this.height > 0) {
      const label = ` ▼ ${String(this.scrollOffset)} more `;
      const labelWidth = visibleWidth(label);
      const last = lines[this.height - 1] ?? '';
      const padded = last + ' '.repeat(Math.max(0, width - visibleWidth(last)));
      lines[this.height - 1] =
        sliceByColumn(padded, 0, Math.max(0, width - labelWidth)) + INVERSE_ON + label + INVERSE_OFF;
      this.chipCols = { start: Math.max(0, width - labelWidth), end: width };
    } else {
      this.chipCols = undefined;
    }

    return lines;
  }

  invalidate(): void {
    this.transcript.invalidate();
  }
}
