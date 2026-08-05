/**
 * MouseController — app-managed mouse for the fixed layout.
 *
 * pi-tui never enables mouse reporting, so this controller turns on SGR
 * reporting itself and parses the raw frames from an input listener
 * (StdinBuffer already frames SGR mouse sequences as single chunks).
 * Wheel events scroll the transcript viewport; left-drag paints a
 * selection that is copied to the clipboard on release (Ghostty-style
 * copy-on-select). Native terminal selection stays available through the
 * terminal's mouse bypass modifier (Shift/Option+drag).
 */

import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

import {
  MOUSE_DRAG_SCROLL_INTERVAL_MS,
  MOUSE_REPORTING_DISABLE,
  MOUSE_REPORTING_ENABLE,
  MOUSE_SCROLL_LINES,
  MOUSE_SGR_PATTERN,
  OSC52_CLIPBOARD_PREFIX,
  OSC52_CLIPBOARD_SUFFIX,
} from '../constant/mouse';
import type { TuiPresentation } from '../runtime/contracts';
import type { TUIState } from '../tui-state';

export interface MouseControllerHost {
  state: TUIState;
  presentation: TuiPresentation;
}

const WHEEL_FLAG = 64;
const MOTION_FLAG = 32;
const BUTTON_MASK = 3;
const BUTTON_LEFT = 0;

type DragScrollDirection = -1 | 1;

export class MouseController {
  private removeInputListener: (() => void) | undefined;
  private dragScrollTimer: ReturnType<typeof setInterval> | undefined;
  private dragScrollDirection: DragScrollDirection | undefined;
  private dragScreenCol = 1;
  private active = false;
  private dragging = false;

  constructor(private readonly host: MouseControllerHost) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.removeInputListener = this.host.state.ui.addInputListener((data) => this.handleInput(data));
    this.host.presentation.writeTerminalControl(MOUSE_REPORTING_ENABLE);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;
    this.stopDragScroll();
    this.removeInputListener?.();
    this.removeInputListener = undefined;
    try {
      this.host.presentation.writeTerminalControl(MOUSE_REPORTING_DISABLE);
    } catch {
      // Best-effort: the terminal may already be gone (SIGHUP path).
    }
  }

  private handleInput(data: string): { consume: boolean } | undefined {
    const match = MOUSE_SGR_PATTERN.exec(data);
    if (match === null) return undefined;
    // match[1..3] are decimal button / 1-based column / 1-based row.
    this.handleMouse(Number(match[1]), Number(match[2]), Number(match[3]), match[4] === 'M');
    return { consume: true };
  }

  private handleMouse(button: number, col: number, row: number, isPress: boolean): void {
    const { state } = this.host;
    const viewport = state.transcriptViewport;

    if ((button & WHEEL_FLAG) !== 0) {
      if (!isPress) return;
      this.stopDragScroll();
      const up = (button & 1) === 0;
      viewport.scrollBy(up ? MOUSE_SCROLL_LINES : -MOUSE_SCROLL_LINES);
      state.ui.requestRender();
      return;
    }

    const isLeft = (button & BUTTON_MASK) === BUTTON_LEFT;

    if (isPress && (button & MOTION_FLAG) !== 0) {
      if (!this.dragging) return;
      // Clamp drag rows into the viewport so resting the pointer on the
      // bottom or top edge auto-scrolls instead of ending the selection.
      const edgeRow = Math.min(Math.max(row, 1), viewport.getHeight());
      const cell = viewport.screenToBuffer(edgeRow, col);
      if (cell !== undefined) {
        viewport.extendSelection(cell);
        state.ui.requestRender();
      }
      const direction =
        row <= 1 ? 1 : row >= viewport.getHeight() ? -1 : undefined;
      this.startDragScroll(direction, col);
      return;
    }

    if (isPress && isLeft) {
      this.dragging = false;
      this.stopDragScroll();
      if (viewport.chipHit(row, col)) {
        viewport.scrollToBottom();
        viewport.clearSelection();
        state.ui.requestRender();
        return;
      }
      const cell = viewport.screenToBuffer(row, col);
      if (cell !== undefined) {
        this.dragging = true;
        viewport.setSelection(cell, cell);
      } else {
        // Click on the chrome / footer area: just drop any selection.
        viewport.clearSelection();
      }
      state.ui.requestRender();
      return;
    }

    // Release finishes an active drag: extend the selection to the release
    // position, then copy (Ghostty-style copy-on-select) and keep the
    // highlight until the next press.
    if (isPress || !this.dragging) return;
    this.dragging = false;
    this.stopDragScroll();
    const releaseRow = Math.min(Math.max(row, 1), viewport.getHeight());
    const releaseCell = viewport.screenToBuffer(releaseRow, col);
    if (releaseCell !== undefined) {
      viewport.extendSelection(releaseCell);
      state.ui.requestRender();
    }
    const text = viewport.extractSelectionText();
    if (text.length > 0) {
      try {
        const encoded = Buffer.from(text, 'utf8').toString('base64');
        this.host.presentation.writeTerminalControl(
          `${OSC52_CLIPBOARD_PREFIX}${encoded}${OSC52_CLIPBOARD_SUFFIX}`,
        );
      } catch {
        // The platform clipboard below still works when OSC 52 is unavailable.
      }
      void copyTextToClipboard(text).catch(() => {
        // Copy is best-effort; a missing clipboard tool must not surface.
      });
    }
  }

  private startDragScroll(direction: DragScrollDirection | undefined, screenCol: number): void {
    this.dragScreenCol = screenCol;
    if (direction === undefined) {
      this.stopDragScroll();
      return;
    }
    // Keep the existing timer when the direction is unchanged so the repeat
    // cadence is not restarted by every motion event.
    if (this.dragScrollTimer !== undefined && this.dragScrollDirection === direction) return;
    this.stopDragScroll();
    this.dragScrollDirection = direction;
    this.dragScrollTimer = setInterval(() => {
      this.scrollDragSelection();
    }, MOUSE_DRAG_SCROLL_INTERVAL_MS);
  }

  private scrollDragSelection(): void {
    const direction = this.dragScrollDirection;
    if (!this.dragging || direction === undefined) {
      this.stopDragScroll();
      return;
    }

    const { state } = this.host;
    const viewport = state.transcriptViewport;
    const previousOffset = viewport.getScrollOffset();
    viewport.scrollBy(direction);
    // Stop once scrolling reaches the transcript edge; extend the selection
    // through the edge row on every successful step.
    if (viewport.getScrollOffset() === previousOffset) {
      this.stopDragScroll();
      return;
    }

    const edgeRow = direction > 0 ? 1 : viewport.getHeight();
    const cell = viewport.screenToBuffer(edgeRow, this.dragScreenCol);
    if (cell !== undefined) viewport.extendSelection(cell);
    state.ui.requestRender();
  }

  private stopDragScroll(): void {
    if (this.dragScrollTimer !== undefined) clearInterval(this.dragScrollTimer);
    this.dragScrollTimer = undefined;
    this.dragScrollDirection = undefined;
  }
}
