/**
 * Welcome panel shown at the top of the TUI.
 * The component owns only presentation state; the banner renderer owns layout.
 */

import type { Component } from '@pymodel/pi-tui';

import {
  isRainbowDancing,
  renderDanceWelcomeLogo,
  renderDanceWelcomeText,
} from '#/tui/easter-eggs/dance';
import type { AppState } from '#/tui/types';
import type { GitStatusCache } from '#/utils/git/git-status';

import {
  asciiGlyphsEnabled,
  buildWelcomeCopy,
  buildWelcomeCopyText,
  buildWelcomeInfoItems,
  createWelcomeGitCache,
  renderWelcomeBanner,
} from './welcome-banner';
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

export class WelcomeComponent implements Component, WelcomeLogoAnimationHost {
  private readonly state: AppState;
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
    if (requestRender !== undefined && welcomeLogoAnimationEnabled() && !isRainbowDancing()) {
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

  invalidate(): void {
    // Logo and copy colours are read from currentTheme during render.
  }

  dispose(): void {
    this.eyeAnimator?.dispose();
    this.eyeAnimator = null;
  }

  render(width: number): string[] {
    const isLoggedOut = !this.state.model;
    const copy = isRainbowDancing()
      ? (() => {
          const text = buildWelcomeCopyText(isLoggedOut);
          return {
            head: renderDanceWelcomeText(text.head, 2, true),
            strapline: renderDanceWelcomeText(text.strapline, 5),
            prompt: renderDanceWelcomeText(text.prompt),
          };
        })()
      : buildWelcomeCopy(isLoggedOut);
    const logoLines = renderPythinkerLogoWithEyes(
      this.eyeBlinkState,
      this.antennaFrame ?? undefined,
    );
    const renderedLogo = isRainbowDancing() ? renderDanceWelcomeLogo(logoLines) : logoLines;

    return renderWelcomeBanner({
      width,
      version: this.state.version,
      infoItems: buildWelcomeInfoItems(this.state, this.gitCache),
      copy,
      logoLines: renderedLogo,
      asciiMode: asciiGlyphsEnabled(),
    });
  }
}
