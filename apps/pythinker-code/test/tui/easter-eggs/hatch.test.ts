import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HATCH_FLOW_MS,
  HATCH_FRAME_MS,
  getRainbowHatchView,
  installRainbowHatch,
  RainbowHatch,
  rainbowText,
  setRainbowHatch,
  tryHandleHatchCommand,
} from '#/tui/easter-eggs/hatch';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { darkColors } from '#/tui/theme/colors';

const TRUECOLOR_PATTERN = /\[38;2;(\d+);(\d+);(\d+)m/g;

/** Ordered list of "r,g,b" truecolor codes in the order they appear. */
function truecolorCodes(text: string): string[] {
  return [...text.matchAll(TRUECOLOR_PATTERN)].map((m) => `${m[1]},${m[2]},${m[3]}`);
}

describe('RainbowHatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts uncolored — the banner keeps its default look', () => {
    const hatch = new RainbowHatch(vi.fn());

    expect(hatch.colored).toBe(false);
    expect(hatch.phase).toBe(0);
  });

  it('flows while hatching and requests renders', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const hatch = new RainbowHatch(requestRender);

    hatch.start({ hold: false });
    expect(hatch.colored).toBe(true);

    const before = hatch.phase;
    vi.advanceTimersByTime(HATCH_FRAME_MS);
    expect(hatch.phase).not.toBe(before);
    expect(requestRender).toHaveBeenCalled();
  });

  it('fades back to default after the flow when not holding', () => {
    vi.useFakeTimers();
    const hatch = new RainbowHatch(vi.fn());

    hatch.start({ hold: false });
    vi.advanceTimersByTime(HATCH_FLOW_MS + HATCH_FRAME_MS);

    expect(hatch.colored).toBe(false);
    expect(hatch.phase).toBe(0);
  });

  it('freezes into a static rainbow after the flow when holding', () => {
    vi.useFakeTimers();
    const hatch = new RainbowHatch(vi.fn());

    hatch.start({ hold: true });
    vi.advanceTimersByTime(HATCH_FLOW_MS + HATCH_FRAME_MS);

    expect(hatch.colored).toBe(true);
    const frozen = hatch.phase;
    vi.advanceTimersByTime(HATCH_FRAME_MS * 10);
    expect(hatch.phase).toBe(frozen);
  });

  it('stops on demand back to the default colors and clears its timers', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const hatch = new RainbowHatch(requestRender);

    hatch.start({ hold: true });
    vi.advanceTimersByTime(HATCH_FRAME_MS * 3);
    expect(hatch.phase).toBeGreaterThan(0);

    requestRender.mockClear();
    hatch.stop();
    expect(hatch.colored).toBe(false);
    expect(hatch.phase).toBe(0);
    expect(requestRender).toHaveBeenCalled();

    requestRender.mockClear();
    vi.advanceTimersByTime(HATCH_FRAME_MS * 5);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('dispose clears timers silently, without a final render', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const hatch = new RainbowHatch(requestRender);

    hatch.start({ hold: false });
    vi.advanceTimersByTime(HATCH_FRAME_MS * 2);
    requestRender.mockClear();

    hatch.dispose();
    expect(requestRender).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HATCH_FLOW_MS + HATCH_FRAME_MS * 10);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('advances the phase by one per frame while flowing', () => {
    vi.useFakeTimers();
    const hatch = new RainbowHatch(vi.fn());

    hatch.start({ hold: true });
    vi.advanceTimersByTime(HATCH_FRAME_MS * 5);
    expect(hatch.phase).toBe(5);

    // Monotonic — the hatch state itself has no palette-length cycle.
    vi.advanceTimersByTime(HATCH_FRAME_MS * 5);
    expect(hatch.phase).toBe(10);
  });
});

describe('rainbowText', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('assigns each visible character the next palette color', () => {
    const out = rainbowText('abcd', ['#111111', '#226622', '#aa33cc', '#44ddee'], 0);

    expect(truecolorCodes(out)).toEqual([
      '17,17,17',
      '34,102,34',
      '170,51,204',
      '68,221,238',
    ]);
  });

  it('does not consume a palette slot for spaces', () => {
    const out = rainbowText('a b', ['#111111', '#226622'], 0);

    expect(truecolorCodes(out)).toEqual(['17,17,17', '34,102,34']);
  });

  it('starts from the given offset', () => {
    const out = rainbowText('a', ['#111111', '#226622'], 1);

    expect(truecolorCodes(out)).toEqual(['34,102,34']);
  });
});

describe('installRainbowHatch', () => {
  afterEach(() => {
    setRainbowHatch(undefined);
    vi.useRealTimers();
  });

  it('returns a disposer that clears timers and uninstalls the controller', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const dispose = installRainbowHatch(requestRender);
    const host = {
      showStatus: vi.fn(),
      state: { theme: { palette: darkColors } },
    } as unknown as SlashCommandHost;

    tryHandleHatchCommand(host, { name: 'hatch', args: 'on' });
    vi.advanceTimersByTime(HATCH_FRAME_MS * 2);
    expect(requestRender).toHaveBeenCalled();

    requestRender.mockClear();
    dispose();

    expect(getRainbowHatchView()).toBeUndefined();
    vi.advanceTimersByTime(HATCH_FLOW_MS + HATCH_FRAME_MS * 10);
    expect(requestRender).not.toHaveBeenCalled();
  });
});

interface HatchCall {
  fn: 'start' | 'stop';
  hold?: boolean;
}

function makeHost(): { host: SlashCommandHost; calls: HatchCall[]; status: string[] } {
  const calls: HatchCall[] = [];
  const status: string[] = [];
  const rainbowHatch = {
    colored: false,
    phase: 0,
    start: (opts: { hold: boolean }) => calls.push({ fn: 'start', hold: opts.hold }),
    stop: () => calls.push({ fn: 'stop' }),
    dispose: () => {},
  };
  setRainbowHatch(rainbowHatch);
  const host = {
    showStatus: (msg: string) => status.push(msg),
    state: { theme: { palette: darkColors } },
  } as unknown as SlashCommandHost;
  return { host, calls, status };
}

describe('tryHandleHatchCommand', () => {
  let host: SlashCommandHost;
  let calls: HatchCall[];
  let status: string[];

  beforeEach(() => {
    ({ host, calls, status } = makeHost());
  });

  afterEach(() => {
    setRainbowHatch(undefined);
  });

  it('claims /hatch, flowing then fading, and hints at /hatch on', () => {
    const handled = tryHandleHatchCommand(host, { name: 'hatch', args: '' });

    expect(handled).toBe(true);
    expect(calls).toEqual([{ fn: 'start', hold: false }]);
    expect(status.join(' ')).toContain('/hatch on');
  });

  it('holds the rainbow for /hatch on and hints at /hatch off', () => {
    const handled = tryHandleHatchCommand(host, { name: 'hatch', args: 'on' });

    expect(handled).toBe(true);
    expect(calls).toEqual([{ fn: 'start', hold: true }]);
    expect(status.join(' ')).toContain('/hatch off');
  });

  it('turns the rainbow off for /hatch off', () => {
    const handled = tryHandleHatchCommand(host, { name: 'hatch', args: 'off' });

    expect(handled).toBe(true);
    expect(calls).toEqual([{ fn: 'stop' }]);
  });

  it('ignores case and surrounding whitespace in the sub-command', () => {
    tryHandleHatchCommand(host, { name: 'hatch', args: '  ON  ' });

    expect(calls).toEqual([{ fn: 'start', hold: true }]);
  });

  it('treats an unknown sub-command as a one-off hatch', () => {
    tryHandleHatchCommand(host, { name: 'hatch', args: 'wiggle' });

    expect(calls).toEqual([{ fn: 'start', hold: false }]);
  });

  it('does not claim other commands, so they fall through normally', () => {
    const handled = tryHandleHatchCommand(host, { name: 'help', args: '' });

    expect(handled).toBe(false);
    expect(calls).toEqual([]);
  });
});
