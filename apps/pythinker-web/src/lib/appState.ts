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
 * `authReadyAtBoot` is deliberately the value from the first load and never the
 * live one. A daemon that was already ready when the window opened proves setup
 * happened before — that covers cleared browser storage, a restored machine, or
 * a fresh client against an established daemon, none of whom are new users.
 * Reading it live instead would tear the wizard down the instant its own
 * connect step succeeded, skipping the steps after it.
 */
export function isOnboardingCompleted(storedFlag: boolean, authReadyAtBoot: boolean): boolean {
  return storedFlag || authReadyAtBoot;
}
