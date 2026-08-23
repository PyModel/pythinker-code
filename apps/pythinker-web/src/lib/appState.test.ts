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

  it('treats a ready daemon as proof that setup already happened', () => {
    // Cleared browser storage, a restored machine, or a fresh client against an
    // established daemon — none of them are new users.
    expect(isOnboardingCompleted(false, true)).toBe(true);
    expect(isOnboardingCompleted(true, false)).toBe(true);
    expect(isOnboardingCompleted(false, false)).toBe(false);
  });
});
