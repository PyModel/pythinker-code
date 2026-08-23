/** Which top-level surface the window shows. */
export type AppState = 'loading' | 'first-run' | 'recovery' | 'app';

export interface AppStateInput {
  /** The first load has settled and the daemon gave a definitive answer. */
  initialized: boolean;
  /** This person has finished setup at some point. */
  onboardingCompleted: boolean;
  /** The daemon can serve a turn right now. */
  authReady: boolean;
}

/**
 * Decide the top-level surface from the two independent facts.
 *
 * "Has never set this up" and "cannot reach a model right now" are different
 * states, and collapsing them into one flag is what would send an established
 * user whose API key expired back through new-user onboarding. Setup being
 * unfinished always wins; a finished setup that is currently broken goes to
 * recovery instead.
 */
export function resolveAppState({
  initialized,
  onboardingCompleted,
  authReady,
}: AppStateInput): AppState {
  if (!initialized) return 'loading';
  if (!onboardingCompleted) return 'first-run';
  return authReady ? 'app' : 'recovery';
}

/**
 * Whether setup counts as finished.
 *
 * A daemon that is already ready proves setup happened at some point, which
 * covers a cleared browser profile, a restored machine, or a fresh client
 * pointed at an established daemon — none of those people are new users.
 */
export function isOnboardingCompleted(storedFlag: boolean, authReady: boolean): boolean {
  return storedFlag || authReady;
}
