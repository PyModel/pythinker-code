/**
 * `/hatch` easter egg — everything it needs lives in this one file: the
 * rainbow text coloring, the animation state machine, and the command handler.
 * Removing the feature is "delete this file + its import sites".
 *
 * It is deliberately NOT registered in BUILTIN_SLASH_COMMANDS, so it stays out
 * of `/help` and autocomplete; `executeSlashCommand` calls the handler as a
 * fallback after builtin/skill resolution, so a real command or a same-named
 * skill always wins.
 */

import chalk from 'chalk';

import type { SlashCommandHost } from '../commands/dispatch';
import type { ParsedSlashInput } from '../commands/types';
import { currentTheme } from '../theme';

/** Frame interval for the rainbow flow animation. */
export const HATCH_FRAME_MS = 110;
/** How long the rainbow flows before settling (fading out, or freezing). */
export const HATCH_FLOW_MS = 3000;

const DARK_RAINBOW = [
  '#4FA8FF',
  '#5BC0BE',
  '#4EC87E',
  '#E8A838',
  '#FFCB6B',
  '#C678B8',
  '#A274D9',
  '#7C8DFF',
] as const;

const LIGHT_RAINBOW = [
  '#1565C0',
  '#00838F',
  '#0E7A38',
  '#92660A',
  '#9A4A00',
  '#B91C1C',
  '#8A3A75',
  '#6B3A9A',
  '#354CB5',
] as const;

function getHatchRainbowPalette(): readonly [string, ...string[]] {
  return currentTheme.palette.text === '#1A1A1A' ? LIGHT_RAINBOW : DARK_RAINBOW;
}

/** Paint a string character-by-character through a palette, skipping spaces. */
export function rainbowText(
  text: string,
  colors: readonly [string, ...string[]],
  offset = 0,
  bold = false,
): string {
  let colorIndex = offset;
  return Array.from(text)
    .map((char) => {
      if (char === ' ') return char;
      const color = colors[colorIndex % colors.length] ?? colors[0];
      colorIndex++;
      const style = chalk.hex(color);
      return bold ? style.bold(char) : style(char);
    })
    .join('');
}

/** Read-only view of the hatch state for components that only render it. */
export interface RainbowHatchView {
  /** Whether consumers should paint themselves in rainbow at all. */
  readonly colored: boolean;
  /** Palette offset, advancing while the rainbow flows. */
  readonly phase: number;
}

export interface RainbowHatchController extends RainbowHatchView {
  start(opts: { hold: boolean }): void;
  stop(): void;
  dispose(): void;
}

let currentHatchController: RainbowHatchController | undefined;
let currentHatchView: RainbowHatchView | undefined;

export function setRainbowHatch(hatch: RainbowHatchController | undefined): void {
  currentHatchController = hatch;
  currentHatchView = hatch;
}

export function installRainbowHatch(requestRender: () => void): () => void {
  currentHatchController?.dispose();
  const hatch = new RainbowHatch(requestRender);
  setRainbowHatch(hatch);
  return () => {
    hatch.dispose();
    if (currentHatchController === hatch) {
      setRainbowHatch(undefined);
    }
  };
}

export function getRainbowHatchView(): RainbowHatchView | undefined {
  return currentHatchView;
}

export function isRainbowHatching(): boolean {
  return currentHatchView?.colored === true;
}

export function renderHatchWelcomeText(
  text: string,
  offset = 0,
  bold = false,
): string {
  return rainbowText(
    text,
    getHatchRainbowPalette(),
    (currentHatchView?.phase ?? 0) + offset,
    bold,
  );
}

export function renderHatchWelcomeLogo(logoLines: readonly string[]): string[] {
  const phase = currentHatchView?.phase ?? 0;
  const palette = getHatchRainbowPalette();
  return logoLines.map((line, index) => rainbowText(line, palette, phase + index * 3));
}

export function renderHatchFooterModel(modelLabel: string): string {
  return rainbowText(modelLabel, getHatchRainbowPalette(), currentHatchView?.phase ?? 0);
}

/**
 * Drives the rainbow: a single timer advances a shared `phase` and asks the UI
 * to repaint. Lives independently of any component, so the welcome banner
 * scrolling away or being rebuilt never disturbs the animation. Three states:
 * off (default), flowing, and a frozen static rainbow.
 */
export class RainbowHatch implements RainbowHatchController {
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

  /**
   * Flow the rainbow for `HATCH_FLOW_MS`, then settle:
   *  - `hold: false` → fade back to the default (uncolored) banner.
   *  - `hold: true`  → freeze into a static rainbow that stays on.
   */
  start(opts: { hold: boolean }): void {
    this.clearTimers();
    this.isColored = true;
    this.frameTimer = setInterval(() => {
      // Phase just increments; rainbowText() takes it modulo the *current*
      // palette length, so the hatch never needs to know the palette size.
      this.currentPhase += 1;
      this.requestRender();
    }, HATCH_FRAME_MS);
    this.flowStopTimer = setTimeout(() => {
      this.settle(opts.hold);
    }, HATCH_FLOW_MS);
    this.requestRender();
  }

  /** Turn the rainbow off — back to the default colors. */
  stop(): void {
    this.clearTimers();
    this.isColored = false;
    this.currentPhase = 0;
    this.requestRender();
  }

  /**
   * Clear timers without repainting — for shutdown, where the UI is going
   * away and a final render would be wasted or write to a stopped terminal.
   */
  dispose(): void {
    this.clearTimers();
  }

  /** End the flow: freeze the rainbow (hold) or fade back to default. */
  private settle(hold: boolean): void {
    this.clearTimers();
    if (!hold) {
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

/**
 * Handle `/hatch`:
 *   /hatch       flow for a few seconds, then fade back to the default colors
 *   /hatch on    flow, then freeze into a static rainbow that stays on
 *   /hatch off   turn the rainbow off
 *
 * Returns true when it claimed the input.
 */
export function tryHandleHatchCommand(host: SlashCommandHost, parsed: ParsedSlashInput): boolean {
  if (parsed.name !== 'hatch') return false;
  if (currentHatchController === undefined) return false;

  // The status line dims the whole message, which buried the command in the
  // hint. Paint just the command in the brand color (bold) so it reads as a
  // command; chalk nesting resumes the dim run right after it.
  const cmd = (text: string): string => currentTheme.boldFg('primary', text);

  const sub = parsed.args.trim().toLowerCase();
  if (sub === 'off') {
    currentHatchController.stop();
  } else if (sub === 'on') {
    currentHatchController.start({ hold: true });
    host.showStatus(`Hatching — use ${cmd('/hatch off')} to turn it off.`);
  } else {
    currentHatchController.start({ hold: false });
    host.showStatus(`Use ${cmd('/hatch on')} to keep the rainbow on.`);
  }
  return true;
}
