/**
 * POST /v1/auth/codex:start
 *   Reply: CodexLoginStart { login_id, authorize_url, loopback, expires_at }
 * GET  /v1/auth/codex/{login_id}
 *   Reply: CodexLoginStatus { login_id, state, default_model?, message? }
 * POST /v1/auth/codex/{login_id}:submit_code
 *   Body:  CodexLoginSubmitCodeRequest { redirect_url }
 * POST /v1/auth/codex/{login_id}:cancel
 *
 * No reply carries the access or refresh token. The server writes them to its
 * own config, exactly as the CLI login does, and tells the client only which
 * model alias the login selected.
 */
import { z } from 'zod';

export const codexLoginStartSchema = z.object({
  login_id: z.string().min(1),
  authorize_url: z.string().min(1),
  /**
   * `true` when the local callback listener owns port 1455, so the browser
   * redirect finishes the login on its own. `false` means the port was taken,
   * and the user has to paste the redirect URL back.
   */
  loopback: z.boolean(),
  expires_at: z.string().min(1),
});
export type CodexLoginStart = z.infer<typeof codexLoginStartSchema>;

export const codexLoginStateSchema = z.enum([
  'pending',
  'completed',
  'failed',
  'cancelled',
]);
export type CodexLoginState = z.infer<typeof codexLoginStateSchema>;

export const codexLoginStatusSchema = z.object({
  login_id: z.string().min(1),
  state: codexLoginStateSchema,
  /** Set once the login wrote its config: the alias now selected by default. */
  default_model: z.string().min(1).optional(),
  /** Set on `failed`. Safe to show to the user. */
  message: z.string().min(1).optional(),
});
export type CodexLoginStatus = z.infer<typeof codexLoginStatusSchema>;

export const codexLoginSubmitCodeRequestSchema = z.object({
  /** The full redirect URL, its query string, or the bare code. */
  redirect_url: z.string().min(1),
});
export type CodexLoginSubmitCodeRequest = z.infer<
  typeof codexLoginSubmitCodeRequestSchema
>;
