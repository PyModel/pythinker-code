/**
 * Welcome panel shown at the top of the TUI.
 * Layout matches the Python shell welcome banner (`_print_welcome_info`).
 */

import type { Component } from '@earendil-works/pi-tui';

import {
  isRainbowColorActive,
  renderRainbowWelcomeCopy,
  renderRainbowWelcomeLogo,
} from '#/tui/easter-eggs/rainbow-colors';
import type { AppState } from '#/tui/types';
import type { GitStatusCache } from '#/utils/git/git-status';

import {
  LOGO_EYES_OPEN,
  renderPythinkerLogoWithEyes,
  type LogoEyeBlinkState,
} from './pythinker-logo';
import {
  WelcomeLogoAnimator,
  welcomeLogoAnimationEnabled,
  type WelcomeLogoAnimationHost,
} from './welcome-logo-animation';
import {
  asciiGlyphsEnabled,
  buildWelcomeCopy,
  buildWelcomeInfoItems,
  buildWelcomeSubtitleChip,
  createWelcomeGitCache,
  renderWelcomeBanner,
} from './welcome-banner';

export class WelcomeComponent implements Component, WelcomeLogoAnimationHost {
  private state: AppState;
  private readonly gitCache: GitStatusCache;
  private eyeBlinkState: LogoEyeBlinkState = LOGO_EYES_OPEN;
  private antennaFrame: number | null = null;
  private eyeAnimator: WelcomeLogoAnimator | null = null;

  constructor(
    state: AppState,
    requestRender?: () => void,
  ) {
    this.state = state;
    this.gitCache = createWelcomeGitCache(state.workDir);
    if (requestRender !== undefined && welcomeLogoAnimationEnabled() && !isRainbowColorActive()) {
      this.eyeAnimator = new WelcomeLogoAnimator(this, requestRender);
      queueMicrotask(() => this.eyeAnimator?.start());
    }
  }

  setEyeBlinkState(state: LogoEyeBlinkState): void {
    this.eyeBlinkState = state;
  }

  setAntennaFrame(frame: number | null): void {
    this.antennaFrame = frame;
  }

  invalidate(): void {}

  dispose(): void {
    this.eyeAnimator?.dispose();
    this.eyeAnimator = null;
  }

  render(width: number): string[] {
    const isLoggedOut = !this.state.model;
    const copy = isRainbowColorActive()
      ? renderRainbowWelcomeCopy(isLoggedOut)
      : buildWelcomeCopy(isLoggedOut);

    const logoLines = isRainbowColorActive()
      ? renderRainbowWelcomeLogo()
      : renderPythinkerLogoWithEyes(this.eyeBlinkState, this.antennaFrame ?? undefined);

    return renderWelcomeBanner({
      width,
      version: this.state.version,
      infoItems: buildWelcomeInfoItems(this.state, this.gitCache),
      copy,
      subtitleChip: buildWelcomeSubtitleChip(this.state.version),
      logoLines,
      asciiMode: asciiGlyphsEnabled(),
    });
  }
}
