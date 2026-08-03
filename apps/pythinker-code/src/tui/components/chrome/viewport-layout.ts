/**
 * ViewportLayoutRoot — fixed full-height layout root (`layout = "fixed"`).
 *
 * Emits exactly `terminal.rows` lines every frame: the transcript
 * viewport on top, then the chrome (activity / todo / queue / btw panels
 * and the editor), then the footer. The editor therefore stays pinned to
 * the bottom of the screen from the first frame, and transcript content
 * scrolls inside the viewport region above it. The footer stays hidden
 * until init succeeds (same rule as the legacy inline layout).
 */

import type { Component, Terminal } from '@earendil-works/pi-tui';

import type { TranscriptViewport } from './transcript-viewport';

// Never let the chrome squeeze the transcript away entirely; on very
// short terminals the overflow falls back to pi-tui's normal scrolling.
const MIN_VIEWPORT_HEIGHT = 3;

export class ViewportLayoutRoot implements Component {
  private footerMounted = false;

  constructor(
    private readonly terminal: Terminal,
    private readonly viewport: TranscriptViewport,
    private readonly chrome: readonly Component[],
    private readonly footer: Component,
  ) {}

  setFooterMounted(mounted: boolean): void {
    this.footerMounted = mounted;
  }

  render(width: number): string[] {
    const { chromeLines, footerLines } = this.renderChromeAndFooter(width);
    const height = Math.max(
      MIN_VIEWPORT_HEIGHT,
      this.terminal.rows - chromeLines.length - footerLines.length,
    );
    this.viewport.setHeight(height);
    return [...this.viewport.render(width), ...chromeLines, ...footerLines];
  }

  /** Rows rendered below the transcript region (chrome + mounted footer). */
  followingRows(width: number): number {
    const { chromeLines, footerLines } = this.renderChromeAndFooter(width);
    return chromeLines.length + footerLines.length;
  }

  private renderChromeAndFooter(width: number): {
    chromeLines: string[];
    footerLines: string[];
  } {
    const chromeLines: string[] = [];
    for (const component of this.chrome) {
      chromeLines.push(...component.render(width));
    }
    const footerLines = this.footerMounted ? this.footer.render(width) : [];
    return { chromeLines, footerLines };
  }

  invalidate(): void {
    this.viewport.invalidate();
    for (const component of this.chrome) {
      component.invalidate();
    }
    this.footer.invalidate();
  }
}
