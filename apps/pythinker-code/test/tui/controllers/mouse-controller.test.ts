import { type Component, Container } from '@earendil-works/pi-tui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/clipboard/clipboard-text', () => ({
  copyTextToClipboard: vi.fn(() => Promise.resolve()),
}));

import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import { TranscriptViewport } from '#/tui/components/chrome/transcript-viewport';
import {
  MOUSE_DRAG_SCROLL_INTERVAL_MS,
  MOUSE_REPORTING_DISABLE,
  MOUSE_REPORTING_ENABLE,
} from '#/tui/constant/mouse';
import { MouseController, type MouseControllerHost } from '#/tui/controllers/mouse-controller';

class StubLines implements Component {
  constructor(private readonly lines: readonly string[]) {}
  render(): string[] {
    return [...this.lines];
  }
  invalidate(): void {}
}

type InputListener = (data: string) => { consume: boolean } | undefined;

function makeHost(lineCount = 10, height = 4) {
  const container = new Container();
  container.addChild(
    new StubLines(Array.from({ length: lineCount }, (_, i) => `line-${String(i + 1)}`)),
  );
  const viewport = new TranscriptViewport(container);
  viewport.setHeight(height);
  viewport.render(80);

  const listeners: InputListener[] = [];
  const state = {
    transcriptViewport: viewport,
    ui: {
      addInputListener: (listener: InputListener) => {
        listeners.push(listener);
        return () => {};
      },
      requestRender: vi.fn(),
    },
  };
  const presentation = { writeTerminalControl: vi.fn() };
  const host = { state, presentation } as unknown as MouseControllerHost;
  const fire = (data: string): Array<{ consume: boolean } | undefined> =>
    listeners.map((listener) => listener(data));
  return { host, viewport, presentation, state, fire };
}

describe('MouseController', () => {
  beforeEach(() => {
    vi.mocked(copyTextToClipboard).mockClear();
  });

  it('enables SGR mouse reporting on start and disables it on stop', () => {
    const { host, presentation } = makeHost();
    const controller = new MouseController(host);
    controller.start();
    expect(presentation.writeTerminalControl).toHaveBeenCalledWith(MOUSE_REPORTING_ENABLE);
    controller.stop();
    expect(presentation.writeTerminalControl).toHaveBeenCalledWith(MOUSE_REPORTING_DISABLE);
    // Idempotent: a second stop writes nothing more.
    controller.stop();
    expect(presentation.writeTerminalControl).toHaveBeenCalledTimes(2);
  });

  it('scrolls the transcript viewport on wheel events and consumes them', () => {
    const { host, viewport, fire } = makeHost();
    new MouseController(host).start();
    const results = fire('\x1b[<64;10;2M'); // wheel up
    expect(results).toEqual([{ consume: true }]);
    expect(viewport.getScrollOffset()).toBe(3);
    fire('\x1b[<65;10;2M'); // wheel down
    expect(viewport.getScrollOffset()).toBe(0);
  });

  it('ignores non-mouse input so the editor still receives it', () => {
    const { host, fire } = makeHost();
    new MouseController(host).start();
    expect(fire('a')).toEqual([undefined]);
  });

  it('copies the drag selection to the clipboard on release', () => {
    const { host, fire, presentation } = makeHost();
    new MouseController(host).start();
    // Pinned window shows buffer rows 6..9 on screen rows 1..4.
    fire('\x1b[<0;1;1M'); // left press at screen (1,1) -> buffer (6,0)
    fire('\x1b[<32;7;2M'); // drag to screen (7,2) -> buffer (7,6)
    fire('\x1b[<0;7;2m'); // release
    expect(copyTextToClipboard).toHaveBeenCalledWith('line-7\nline-8');
    expect(presentation.writeTerminalControl).toHaveBeenLastCalledWith(
      '\x1b]52;c;bGluZS03CmxpbmUtOA==\x07',
    );
  });

  it('uses the release position as the final selection endpoint', () => {
    const { host, fire } = makeHost();
    new MouseController(host).start();
    fire('\u001B[<0;1;1M');
    fire('\u001B[<0;7;2m');
    expect(copyTextToClipboard).toHaveBeenCalledWith('line-7\nline-8');
  });

  it('auto-scrolls downward while dragging past the transcript bottom', () => {
    vi.useFakeTimers();
    try {
      const { host, viewport, fire } = makeHost(12, 4);
      new MouseController(host).start();
      viewport.scrollBy(4);
      viewport.render(80);

      fire('\u001B[<0;1;2M'); // left press on line 6
      fire('\u001B[<32;8;5M'); // drag one row below the transcript
      vi.advanceTimersByTime(MOUSE_DRAG_SCROLL_INTERVAL_MS * 4);

      expect(viewport.isPinned()).toBe(true);
      fire('\u001B[<0;8;5m');
      expect(vi.getTimerCount()).toBe(0);
      expect(copyTextToClipboard).toHaveBeenCalledWith(
        'line-6\nline-7\nline-8\nline-9\nline-10\nline-11\nline-12',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not copy on a bare click or a release without a drag', () => {
    const { host, fire } = makeHost();
    new MouseController(host).start();
    fire('\x1b[<0;3;2M');
    fire('\x1b[<0;3;2m');
    fire('\x1b[<0;5;3m');
    expect(copyTextToClipboard).not.toHaveBeenCalled();
  });

  it('jumps to the bottom when the "N more" chip is clicked', () => {
    const { host, viewport, fire } = makeHost();
    new MouseController(host).start();
    viewport.scrollBy(2);
    viewport.render(80); // lay out the chip on the region's last row
    expect(viewport.chipHit(4, 80)).toBe(true);
    fire('\x1b[<0;80;4M');
    expect(viewport.isPinned()).toBe(true);
  });

  it('clears the selection when clicking the chrome area below the transcript', () => {
    const { host, viewport, fire } = makeHost();
    new MouseController(host).start();
    fire('\x1b[<0;1;1M');
    fire('\x1b[<32;7;2M');
    fire('\x1b[<0;7;2m');
    expect(viewport.hasSelection()).toBe(true);
    fire('\x1b[<0;10;8M'); // below the 4-row transcript region
    expect(viewport.hasSelection()).toBe(false);
  });
});
