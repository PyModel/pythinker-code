import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/dispatch';
import {
  createRainbowPainter,
  getRainbowColorView,
  handleColorsCommand,
  installRainbowColors,
  RAINBOW_FLOW_MS,
  RAINBOW_FRAME_MS,
  RainbowColorMode,
  rainbowText,
  renderRainbowFooterModel,
  setRainbowColors,
  type RainbowColorController,
} from '#/tui/easter-eggs/rainbow-colors';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

const TRUECOLOR_PATTERN = /\[38;2;(\d+);(\d+);(\d+)m/g;

function truecolorCodes(text: string): string[] {
  return [...text.matchAll(TRUECOLOR_PATTERN)].map((match) => `${match[1]},${match[2]},${match[3]}`);
}

function colorCode(hex: string): string {
  const value = hex.slice(1);
  return [0, 2, 4]
    .map((offset) => String(Number.parseInt(value.slice(offset, offset + 2), 16)))
    .join(',');
}

describe('RainbowColorMode', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts uncolored', () => {
    const colors = new RainbowColorMode(vi.fn());

    expect(colors.colored).toBe(false);
    expect(colors.phase).toBe(0);
  });

  it('flows and requests renders', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const colors = new RainbowColorMode(requestRender);

    colors.start({ freeze: false });
    expect(colors.colored).toBe(true);

    vi.advanceTimersByTime(RAINBOW_FRAME_MS);
    expect(colors.phase).toBe(1);
    expect(requestRender).toHaveBeenCalled();
  });

  it('returns to normal after a one-shot flow', () => {
    vi.useFakeTimers();
    const colors = new RainbowColorMode(vi.fn());

    colors.start({ freeze: false });
    vi.advanceTimersByTime(RAINBOW_FLOW_MS + RAINBOW_FRAME_MS);

    expect(colors.colored).toBe(false);
    expect(colors.phase).toBe(0);
  });

  it('freezes after the flow when requested', () => {
    vi.useFakeTimers();
    const colors = new RainbowColorMode(vi.fn());

    colors.start({ freeze: true });
    vi.advanceTimersByTime(RAINBOW_FLOW_MS + RAINBOW_FRAME_MS);

    expect(colors.colored).toBe(true);
    const frozen = colors.phase;
    vi.advanceTimersByTime(RAINBOW_FRAME_MS * 10);
    expect(colors.phase).toBe(frozen);
  });

  it('stops on demand and clears its timers', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const colors = new RainbowColorMode(requestRender);

    colors.start({ freeze: true });
    vi.advanceTimersByTime(RAINBOW_FRAME_MS * 3);
    requestRender.mockClear();
    colors.stop();

    expect(colors.colored).toBe(false);
    expect(colors.phase).toBe(0);
    expect(requestRender).toHaveBeenCalledOnce();

    requestRender.mockClear();
    vi.advanceTimersByTime(RAINBOW_FRAME_MS * 5);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it('disposes silently', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const colors = new RainbowColorMode(requestRender);

    colors.start({ freeze: false });
    vi.advanceTimersByTime(RAINBOW_FRAME_MS * 2);
    requestRender.mockClear();
    colors.dispose();

    expect(requestRender).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RAINBOW_FLOW_MS + RAINBOW_FRAME_MS * 10);
    expect(requestRender).not.toHaveBeenCalled();
  });
});

describe('rainbow painters', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    currentTheme.setPalette(darkColors);
  });

  it('assigns each visible character the next palette color', () => {
    const output = rainbowText('abcd', ['#111111', '#226622', '#aa33cc', '#44ddee']);

    expect(truecolorCodes(output)).toEqual([
      '17,17,17',
      '34,102,34',
      '170,51,204',
      '68,221,238',
    ]);
  });

  it('does not consume a palette slot for spaces', () => {
    const output = rainbowText('a b', ['#111111', '#226622']);

    expect(truecolorCodes(output)).toEqual(['17,17,17', '34,102,34']);
  });

  it('keeps one offset across consecutive painter calls', () => {
    const paint = createRainbowPainter(0);
    const output = paint('ab') + paint('cd');

    expect(truecolorCodes(output)).toEqual([
      colorCode(darkColors.rainbowRed),
      colorCode(darkColors.rainbowOrange),
      colorCode(darkColors.rainbowYellow),
      colorCode(darkColors.rainbowGreen),
    ]);
  });

  it('uses the active theme rainbow tokens', () => {
    const output = renderRainbowFooterModel('abcdefg');

    expect(truecolorCodes(output)).toEqual([
      darkColors.rainbowRed,
      darkColors.rainbowOrange,
      darkColors.rainbowYellow,
      darkColors.rainbowGreen,
      darkColors.rainbowBlue,
      darkColors.rainbowIndigo,
      darkColors.rainbowViolet,
    ].map(colorCode));
  });
});

describe('installRainbowColors', () => {
  afterEach(() => {
    setRainbowColors(undefined);
    vi.useRealTimers();
  });

  it('returns a disposer that clears timers and uninstalls the controller', () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const dispose = installRainbowColors(requestRender);
    const host = {
      showError: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;

    handleColorsCommand(host, 'on');
    vi.advanceTimersByTime(RAINBOW_FRAME_MS * 2);
    expect(requestRender).toHaveBeenCalled();

    requestRender.mockClear();
    dispose();

    expect(getRainbowColorView()).toBeUndefined();
    vi.advanceTimersByTime(RAINBOW_FLOW_MS + RAINBOW_FRAME_MS * 10);
    expect(requestRender).not.toHaveBeenCalled();
  });
});

interface ColorCall {
  readonly fn: 'start' | 'stop';
  readonly freeze?: boolean;
}

function makeHost(): {
  host: SlashCommandHost;
  calls: ColorCall[];
  status: string[];
  errors: string[];
} {
  const calls: ColorCall[] = [];
  const status: string[] = [];
  const errors: string[] = [];
  const controller: RainbowColorController = {
    colored: false,
    phase: 0,
    start: ({ freeze }) => calls.push({ fn: 'start', freeze }),
    stop: () => calls.push({ fn: 'stop' }),
    dispose: () => {},
  };
  setRainbowColors(controller);
  const host = {
    showError: (message: string) => errors.push(message),
    showStatus: (message: string) => status.push(message),
  } as unknown as SlashCommandHost;
  return { host, calls, status, errors };
}

describe('handleColorsCommand', () => {
  let host: SlashCommandHost;
  let calls: ColorCall[];
  let status: string[];
  let errors: string[];

  beforeEach(() => {
    ({ host, calls, status, errors } = makeHost());
  });

  afterEach(() => {
    setRainbowColors(undefined);
  });

  it('runs a one-shot flow for /colors', () => {
    handleColorsCommand(host, '');

    expect(calls).toEqual([{ fn: 'start', freeze: false }]);
    expect(status.join(' ')).toContain('/colors on');
  });

  it('freezes the rainbow for /colors on', () => {
    handleColorsCommand(host, 'on');

    expect(calls).toEqual([{ fn: 'start', freeze: true }]);
    expect(status.join(' ')).toContain('/colors off');
  });

  it('turns the rainbow off for /colors off', () => {
    handleColorsCommand(host, 'off');

    expect(calls).toEqual([{ fn: 'stop' }]);
  });

  it('ignores case and surrounding whitespace', () => {
    handleColorsCommand(host, '  ON  ');

    expect(calls).toEqual([{ fn: 'start', freeze: true }]);
  });

  it('rejects invalid arguments with usage guidance', () => {
    handleColorsCommand(host, 'wiggle');

    expect(calls).toEqual([]);
    expect(status).toEqual([]);
    expect(errors).toEqual(['Usage: /colors [on|off]']);
  });
});
