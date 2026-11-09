export type LoginState = "idle" | "pending" | "error";

/**
 * How a finished login maps onto the login screen. Login is multi-provider, so
 * a falsy `success` is usually a cancelled picker rather than a failure: only a
 * result carrying an error message may render the error screen.
 */
export function loginOutcomeState(result: { success: boolean; error?: string }): {
  state: LoginState;
  error: string | null;
} {
  if (result.error) return { state: "error", error: result.error };
  return { state: "idle", error: null };
}
