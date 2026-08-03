/**
 * Welcome-banner eye blink — same phases as install.ps1 `Blink-Eye` / install.sh
 * `_blink_eyes`, with longer holds so the closed eye registers in the TUI.
 */

import { asciiGlyphsEnabled } from './welcome-banner';
import {
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

export interface WelcomeEyeAnimationHost {
  setEyeBlinkState(state: LogoEyeBlinkState): void;
}

export class WelcomeLogoEyeAnimator {
  private eyeState: LogoEyeBlinkState = LOGO_EYES_OPEN;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly host: WelcomeEyeAnimationHost,
    private readonly requestRender: () => void,
  ) {}

  getEyeBlinkState(): LogoEyeBlinkState {
    return this.eyeState;
  }

  start(): void {
    if (!welcomeLogoAnimationEnabled() || this.disposed) return;
    this.runEye('left', 0, () => {
      this.runEye('right', 0, () => {
        this.applyState(LOGO_EYES_OPEN);
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.applyState(LOGO_EYES_OPEN);
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
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runEye(side, stepIndex + 1, done);
    }, step.delayMs);
  }

  private applyState(state: LogoEyeBlinkState): void {
    this.eyeState = state;
    this.host.setEyeBlinkState(state);
    this.requestRender();
  }
}
