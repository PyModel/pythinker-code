/**
 * Welcome-banner animation — eye blink with the same phases as install.ps1
 * `Blink-Eye` / install.sh `_blink_eyes` (longer holds so the closed eye
 * registers in the TUI), plus a one-shot antenna spin while the banner
 * first loads.
 */

import { asciiGlyphsEnabled } from './welcome-banner';
import {
  ANTENNA_SPINNER_FRAMES,
  LOGO_EYES_OPEN,
  type EyeBlinkPhase,
  type LogoEyeBlinkState,
} from './pythinker-logo';

/** One step in the installer blink sequence for a single eye. */
interface EyeBlinkStep {
  readonly phase: EyeBlinkPhase;
  readonly delayMs: number;
}

/** Left eye, then right eye — slower than the installer intro so the blink reads in the TUI. */
const SINGLE_EYE_BLINK: readonly EyeBlinkStep[] = [
  { phase: 'glance', delayMs: 90 },
  { phase: 'closed', delayMs: 120 },
  { phase: 'closed', delayMs: 180 },
  { phase: 'open-shine', delayMs: 90 },
  { phase: 'open', delayMs: 60 },
];

export function welcomeLogoAnimationEnabled(): boolean {
  if (process.env['PYTHINKER_NO_ANIMATION']) return false;
  if (process.env['CI']) return false;
  if (process.env['NO_COLOR']) return false;
  if (asciiGlyphsEnabled()) return false;
  return true;
}

export interface WelcomeLogoAnimationHost {
  setEyeBlinkState(state: LogoEyeBlinkState): void;
  /** `null` restores the static ● bulb. */
  setAntennaFrame(frame: number | null): void;
}

/** Idle time between blink sequences. */
export const WELCOME_BLINK_INTERVAL_MS = 5000;

/** Antenna spin cadence and total length — one spin at banner load. */
export const WELCOME_ANTENNA_SPIN_TICK_MS = 120;
export const WELCOME_ANTENNA_SPIN_DURATION_MS = 6000;

export class WelcomeLogoAnimator {
  private eyeState: LogoEyeBlinkState = LOGO_EYES_OPEN;
  private antennaFrameIndex = 0;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private spinTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly host: WelcomeLogoAnimationHost,
    private readonly requestRender: () => void,
  ) {}

  getEyeBlinkState(): LogoEyeBlinkState {
    return this.eyeState;
  }

  start(): void {
    if (!welcomeLogoAnimationEnabled() || this.disposed) return;
    this.spinAntenna(0);
    this.playBlink();
  }

  private playBlink(): void {
    this.runEye('left', 0, () => {
      this.runEye('right', 0, () => {
        this.applyState(LOGO_EYES_OPEN);
        this.scheduleNextBlink();
      });
    });
  }

  private scheduleNextBlink(): void {
    if (this.disposed) return;
    this.blinkTimer = setTimeout(() => {
      this.blinkTimer = null;
      this.playBlink();
    }, WELCOME_BLINK_INTERVAL_MS);
  }

  private spinAntenna(elapsedMs: number): void {
    if (this.disposed) return;
    if (elapsedMs >= WELCOME_ANTENNA_SPIN_DURATION_MS) {
      this.applyAntennaFrame(null);
      return;
    }
    this.applyAntennaFrame(this.antennaFrameIndex);
    this.antennaFrameIndex = (this.antennaFrameIndex + 1) % ANTENNA_SPINNER_FRAMES.length;
    this.spinTimer = setTimeout(() => {
      this.spinTimer = null;
      this.spinAntenna(elapsedMs + WELCOME_ANTENNA_SPIN_TICK_MS);
    }, WELCOME_ANTENNA_SPIN_TICK_MS);
  }

  private applyAntennaFrame(frame: number | null): void {
    this.host.setAntennaFrame(frame);
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.blinkTimer !== null) {
      clearTimeout(this.blinkTimer);
      this.blinkTimer = null;
    }
    if (this.spinTimer !== null) {
      clearTimeout(this.spinTimer);
      this.spinTimer = null;
    }
    this.applyState(LOGO_EYES_OPEN);
    this.applyAntennaFrame(null);
  }

  private runEye(side: 'left' | 'right', stepIndex: number, done: () => void): void {
    if (this.disposed) return;
    const step = SINGLE_EYE_BLINK[stepIndex];
    if (step === undefined) {
      done();
      return;
    }
    this.applyState({
      left: side === 'left' ? step.phase : 'open',
      right: side === 'right' ? step.phase : 'open',
    });
    if (step.delayMs <= 0) {
      this.runEye(side, stepIndex + 1, done);
      return;
    }
    this.blinkTimer = setTimeout(() => {
      this.blinkTimer = null;
      this.runEye(side, stepIndex + 1, done);
    }, step.delayMs);
  }

  private applyState(state: LogoEyeBlinkState): void {
    this.eyeState = state;
    this.host.setEyeBlinkState(state);
    this.requestRender();
  }
}
