import chalk from 'chalk';

import type { SlashCommandHost } from '../commands/dispatch';
import {
  buildWelcomeCopy,
  type WelcomeBannerCopy,
} from '../components/chrome/welcome-banner';
import { PYTHINKER_LOGO_LINES } from '../components/chrome/pythinker-logo';
import { currentTheme } from '../theme';

/** Frame interval for the rainbow flow animation. */
export const RAINBOW_FRAME_MS = 110;
/** How long the rainbow flows before fading out or freezing. */
export const RAINBOW_FLOW_MS = 3000;

function themedRainbowPalette(): readonly [string, ...string[]] {
  const colors = currentTheme.palette;
  return [
    colors.rainbowRed,
    colors.rainbowOrange,
    colors.rainbowYellow,
    colors.rainbowGreen,
    colors.rainbowBlue,
    colors.rainbowIndigo,
    colors.rainbowViolet,
  ];
}

function makeRainbowPainter(
  colors: readonly [string, ...string[]],
  offset: number,
  bold: boolean,
): (text: string) => string {
  let colorIndex = offset;
  return (text) =>
    Array.from(text)
      .map((char) => {
        if (char === ' ') return char;
        const color = colors[colorIndex % colors.length] ?? colors[0];
        colorIndex++;
        const style = chalk.hex(color);
        return bold ? style.bold(char) : style(char);
      })
      .join('');
}

/** Paint a string character-by-character through a palette, skipping spaces. */
export function rainbowText(
  text: string,
  colors: readonly [string, ...string[]],
  offset = 0,
  bold = false,
): string {
  return makeRainbowPainter(colors, offset, bold)(text);
}

/** Read-only rainbow state for components that only render it. */
export interface RainbowColorView {
  /** Whether consumers should paint themselves in rainbow colors. */
  readonly colored: boolean;
  /** Palette offset, advancing while the rainbow flows. */
  readonly phase: number;
}

export interface RainbowColorController extends RainbowColorView {
  start(options: { freeze: boolean }): void;
  stop(): void;
  dispose(): void;
}

let currentRainbowController: RainbowColorController | undefined;
let currentRainbowView: RainbowColorView | undefined;

export function setRainbowColors(controller: RainbowColorController | undefined): void {
  currentRainbowController = controller;
  currentRainbowView = controller;
}

export function installRainbowColors(requestRender: () => void): () => void {
  currentRainbowController?.dispose();
  const controller = new RainbowColorMode(requestRender);
  setRainbowColors(controller);
  return () => {
    controller.dispose();
    if (currentRainbowController === controller) {
      setRainbowColors(undefined);
    }
  };
}

export function getRainbowColorView(): RainbowColorView | undefined {
  return currentRainbowView;
}

export function isRainbowColorActive(): boolean {
  return currentRainbowView?.colored === true;
}

/** Create one stateful painter so consecutive render fragments share an offset. */
export function createRainbowPainter(offset = currentRainbowView?.phase ?? 0): (text: string) => string {
  return makeRainbowPainter(themedRainbowPalette(), offset, false);
}

export function renderRainbowWelcomeCopy(isLoggedOut: boolean): WelcomeBannerCopy {
  const phase = currentRainbowView?.phase ?? 0;
  const palette = themedRainbowPalette();
  const base = buildWelcomeCopy(isLoggedOut);
  return {
    head: rainbowText('Welcome to Pythinker — think first, then code.', palette, phase, true),
    strapline: rainbowText(
      'Review · Secure · Diagnose · Build with confidence.',
      palette,
      phase + 2,
    ),
    prompt: base.prompt,
  };
}

export function renderRainbowWelcomeLogo(): string[] {
  const phase = currentRainbowView?.phase ?? 0;
  const palette = themedRainbowPalette();
  return PYTHINKER_LOGO_LINES.map((plain, index) => rainbowText(plain, palette, phase + index));
}

export function renderRainbowFooterModel(modelLabel: string): string {
  return rainbowText(modelLabel, themedRainbowPalette(), currentRainbowView?.phase ?? 0);
}

/**
 * Drives a shared rainbow phase independently of any component. The mode can
 * be off, flowing temporarily, or frozen after one flow.
 */
export class RainbowColorMode implements RainbowColorController {
  private currentPhase = 0;
  private isColored = false;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private flowStopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
  }

  get colored(): boolean {
    return this.isColored;
  }

  get phase(): number {
    return this.currentPhase;
  }

  /** Flow for RAINBOW_FLOW_MS, then freeze when requested or return to normal. */
  start(options: { freeze: boolean }): void {
    this.clearTimers();
    this.isColored = true;
    this.frameTimer = setInterval(() => {
      this.currentPhase += 1;
      this.requestRender();
    }, RAINBOW_FRAME_MS);
    this.flowStopTimer = setTimeout(() => {
      this.settle(options.freeze);
    }, RAINBOW_FLOW_MS);
    this.requestRender();
  }

  /** Turn rainbow colors off and return to the default theme treatment. */
  stop(): void {
    this.clearTimers();
    this.isColored = false;
    this.currentPhase = 0;
    this.requestRender();
  }

  /** Clear timers silently during shutdown. */
  dispose(): void {
    this.clearTimers();
  }

  private settle(freeze: boolean): void {
    this.clearTimers();
    if (!freeze) {
      this.isColored = false;
      this.currentPhase = 0;
    }
    this.requestRender();
  }

  private clearTimers(): void {
    if (this.frameTimer !== null) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.flowStopTimer !== null) {
      clearTimeout(this.flowStopTimer);
      this.flowStopTimer = null;
    }
  }
}

/** Handle the built-in `/colors [on|off]` command. */
export function handleColorsCommand(host: SlashCommandHost, args: string): void {
  const mode = args.trim().toLowerCase();
  if (mode !== '' && mode !== 'on' && mode !== 'off') {
    host.showError('Usage: /colors [on|off]');
    return;
  }
  if (currentRainbowController === undefined) return;

  const command = (text: string): string => currentTheme.boldFg('primary', text);
  if (mode === 'off') {
    currentRainbowController.stop();
    host.showStatus('Rainbow colors are off.');
    return;
  }
  if (mode === 'on') {
    currentRainbowController.start({ freeze: true });
    host.showStatus(`Rainbow colors will stay on. Use ${command('/colors off')} to turn them off.`);
    return;
  }
  currentRainbowController.start({ freeze: false });
  host.showStatus(`Use ${command('/colors on')} to keep the rainbow on.`);
}
