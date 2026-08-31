import { describe, expect, it } from 'vitest';

import { isOnboardingCompleted, resolveAppState } from './appState';

describe('app state', () => {
  it('holds on loading until the first load settles', () => {
    expect(
      resolveAppState({ initialized: false, onboardingCompleted: false, authReady: false }),
    ).toBe('loading');
  });

  it('sends a brand-new install to first run', () => {
    expect(
      resolveAppState({ initialized: true, onboardingCompleted: false, authReady: false }),
    ).toBe('first-run');
  });

  it('sends an established user with a broken provider to recovery, not onboarding', () => {
    // The regression this split exists to prevent: someone six months in whose
    // API key expired must not be treated as a first-time user.
    expect(
      resolveAppState({ initialized: true, onboardingCompleted: true, authReady: false }),
    ).toBe('recovery');
  });

  it('shows the app once setup is done and a model is reachable', () => {
    expect(
      resolveAppState({ initialized: true, onboardingCompleted: true, authReady: true }),
    ).toBe('app');
  });

  it('treats a daemon that was ready at boot as proof that setup already happened', () => {
    // Cleared browser storage, a restored machine, or a fresh client against an
    // established daemon — none of them are new users.
    expect(isOnboardingCompleted(false, true)).toBe(true);
    expect(isOnboardingCompleted(true, false)).toBe(true);
    expect(isOnboardingCompleted(false, false)).toBe(false);
  });

  it('keeps first run open while its own connect step makes the daemon ready', () => {
    // Boot readiness is false for a fresh install and stays false for the rest
    // of the session. Reading readiness live here would end the wizard the
    // instant a provider connected, skipping the model and appearance steps.
    const bootReady = false;
    expect(
      resolveAppState({
        initialized: true,
        onboardingCompleted: isOnboardingCompleted(false, bootReady),
        authReady: true,
      }),
    ).toBe('first-run');
  });
});
