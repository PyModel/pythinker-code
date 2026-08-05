import { type Component, Container, type Terminal } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';

import { TranscriptViewport, stripAnsi } from '#/tui/components/chrome/transcript-viewport';
import { ViewportLayoutRoot } from '#/tui/components/chrome/viewport-layout';

/** Minimal component emitting pre-baked lines (real transcript rows are
 * not width-padded, unlike pi-tui's Text). */
class StubLines implements Component {
  constructor(private readonly lines: readonly string[]) {}
  render(): string[] {
    return [...this.lines];
  }
  invalidate(): void {}
}

function makeContainer(lineCount: number): Container {
  const container = new Container();
  container.addChild(
    new StubLines(Array.from({ length: lineCount }, (_, i) => `line-${String(i + 1)}`)),
  );
  return container;
}

function makeViewport(lineCount: number, height: number): TranscriptViewport {
  const viewport = new TranscriptViewport(makeContainer(lineCount));
  viewport.setHeight(height);
  return viewport;
}

describe('TranscriptViewport', () => {
  it('emits exactly `height` lines, padding short content at the bottom', () => {
    const viewport = makeViewport(2, 5);
    const lines = viewport.render(40);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('line-1');
    expect(lines[1]).toContain('line-2');
    expect(lines.slice(2)).toEqual(['', '', '']);
  });

  it('pins to the tail when content overflows the region', () => {
    const viewport = makeViewport(10, 4);
    const lines = viewport.render(40);
    expect(lines.map(stripAnsi)).toEqual(['line-7', 'line-8', 'line-9', 'line-10']);
    expect(viewport.isPinned()).toBe(true);
  });

  it('scrolls up by wheel deltas and clamps at the top', () => {
    const viewport = makeViewport(10, 4);
    viewport.render(40);
    viewport.scrollBy(3);
    expect(viewport.getScrollOffset()).toBe(3);
    const scrolled = viewport.render(40).map(stripAnsi);
    expect(scrolled.slice(0, 3)).toEqual(['line-4', 'line-5', 'line-6']);
    expect(scrolled[3]).toContain('line-7');
    expect(scrolled[3]).toContain('▼ 3 more');
    viewport.scrollBy(100);
    expect(viewport.getScrollOffset()).toBe(6);
    const topLines = viewport.render(40).map(stripAnsi);
    expect(topLines.slice(0, 3)).toEqual(['line-1', 'line-2', 'line-3']);
    expect(topLines[3]).toContain('line-4');
    viewport.scrollBy(-100);
    expect(viewport.getScrollOffset()).toBe(0);
    expect(viewport.isPinned()).toBe(true);
  });

  it('keeps the visible window steady when new content arrives while scrolled up', () => {
    const container = makeContainer(10);
    const viewport = new TranscriptViewport(container);
    viewport.setHeight(4);
    viewport.render(40);
    viewport.scrollBy(4);
    expect(viewport.render(40)[0]).toContain('line-3');
    container.addChild(new StubLines(['line-11']));
    expect(viewport.render(40)[0]).toContain('line-3');
  });

  it('clamps the scroll offset when the transcript shrinks', () => {
    const container = makeContainer(10);
    const viewport = new TranscriptViewport(container);
    viewport.setHeight(4);
    viewport.render(40);
    viewport.scrollBy(6);
    container.clear();
    container.addChild(new StubLines(['only']));
    const lines = viewport.render(40);
    expect(viewport.getScrollOffset()).toBe(0);
    expect(lines[0]).toContain('only');
  });

  it('shows a "N more" chip on the last row while scrolled up', () => {
    const viewport = makeViewport(10, 4);
    viewport.render(40);
    expect(viewport.chipHit(4, 39)).toBe(false);
    viewport.scrollBy(3);
    const lines = viewport.render(40);
    expect(stripAnsi(lines[3] ?? '')).toContain('▼ 3 more');
    expect(viewport.chipHit(4, 39)).toBe(true);
    expect(viewport.chipHit(3, 39)).toBe(false);
    expect(viewport.chipHit(4, 1)).toBe(false);
    viewport.scrollToBottom();
    viewport.render(40);
    expect(viewport.chipHit(4, 39)).toBe(false);
  });

  it('maps 1-based screen positions to buffer coordinates', () => {
    const viewport = makeViewport(10, 4);
    viewport.render(40);
    // Pinned: visible window is rows 6..9 of the buffer.
    expect(viewport.screenToBuffer(1, 3)).toEqual({ row: 6, col: 2 });
    expect(viewport.screenToBuffer(4, 41)).toEqual({ row: 9, col: 40 });
    expect(viewport.screenToBuffer(0, 1)).toBeUndefined();
    expect(viewport.screenToBuffer(5, 1)).toBeUndefined();
  });

  it('highlights the selection with inverse video', () => {
    const viewport = makeViewport(3, 5);
    viewport.render(40);
    viewport.setSelection({ row: 0, col: 0 }, { row: 1, col: 4 });
    const lines = viewport.render(40);
    expect(lines[0]).toContain('\u001B[7m');
    expect(stripAnsi(lines[0] ?? '')).toBe('line-1');
  });

  it('extracts selected text in reading order, ANSI-stripped and trimmed', () => {
    const container = new Container();
    container.addChild(new StubLines(['\u001B[31mred\u001B[39m plain', 'second line   ', 'third']));
    const viewport = new TranscriptViewport(container);
    viewport.setHeight(5);
    viewport.render(40);
    // Drag backwards from row 1 col 6 to row 0 col 4: selection normalizes.
    viewport.setSelection({ row: 1, col: 6 }, { row: 0, col: 4 });
    expect(viewport.extractSelectionText()).toBe('plain\nsecond');
  });

  it('treats a bare click as no selection', () => {
    const viewport = makeViewport(2, 5);
    viewport.render(40);
    viewport.setSelection({ row: 0, col: 2 }, { row: 0, col: 2 });
    expect(viewport.hasSelection()).toBe(false);
    expect(viewport.extractSelectionText()).toBe('');
  });

  it('clamps wide selections to each line width', () => {
    const viewport = makeViewport(2, 5);
    viewport.render(40);
    viewport.setSelection({ row: 0, col: 0 }, { row: 1, col: 500 });
    expect(viewport.extractSelectionText()).toBe('line-1\nline-2');
  });

  it('stripAnsi removes SGR, private CSI, and OSC hyperlink sequences', () => {
    expect(stripAnsi('\u001B[31mred\u001B[39m')).toBe('red');
    expect(stripAnsi('\u001B[?2026hsync\u001B[?2026l')).toBe('sync');
    expect(stripAnsi('\u001B]8;;https://example.com\u0007link\u001B]8;;\u0007')).toBe('link');
  });
});

describe('ViewportLayoutRoot', () => {
  function makeRoot(rows: number, transcriptLines: number) {
    const viewport = new TranscriptViewport(makeContainer(transcriptLines));
    const chrome = new StubLines(['chrome-a', 'chrome-b']);
    const footer = new StubLines(['footer-a']);
    const terminal = { rows } as unknown as Terminal;
    const root = new ViewportLayoutRoot(terminal, viewport, [chrome], footer);
    return { root, viewport };
  }

  it('fills exactly terminal.rows lines: viewport + chrome + footer', () => {
    const { root, viewport } = makeRoot(10, 3);
    root.setFooterMounted(true);
    const lines = root.render(40);
    expect(lines).toHaveLength(10);
    // 3 chrome/footer lines pin to the bottom; the viewport gets the rest.
    expect(viewport.getHeight()).toBe(7);
    expect(lines[7]).toBe('chrome-a');
    expect(lines[8]).toBe('chrome-b');
    expect(lines[9]).toBe('footer-a');
  });

  it('renders the footer only after it is mounted', () => {
    const { root, viewport } = makeRoot(10, 3);
    const withoutFooter = root.render(40);
    // The viewport expands to fill the unmounted footer slot.
    expect(withoutFooter).toHaveLength(10);
    expect(viewport.getHeight()).toBe(8);
    expect(withoutFooter).not.toContain('footer-a');
    root.setFooterMounted(true);
    expect(root.render(40).at(-1)).toBe('footer-a');
  });

  it('places the footer after the chrome lines', () => {
    const { root } = makeRoot(12, 3);
    root.setFooterMounted(true);
    const lines = root.render(40);
    expect(lines.at(-3)).toBe('chrome-a');
    expect(lines.at(-2)).toBe('chrome-b');
    expect(lines.at(-1)).toBe('footer-a');
  });
});
