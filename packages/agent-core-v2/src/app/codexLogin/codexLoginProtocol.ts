import { z } from 'zod';

import { isoDateTimeSchema } from '#/_base/utils/isoDateTime';

const CODEX_LOGIN_ID_MAX_LENGTH = 128;
const CODEX_LOGIN_ACTION_TAIL_MAX_LENGTH = 160;
const CODEX_REDIRECT_INPUT_MAX_LENGTH = 16_384;

export const codexLoginStartSchema = z.object({
  login_id: z.string().min(1).max(CODEX_LOGIN_ID_MAX_LENGTH),
  authorize_url: z.string().url(),
  loopback: z.boolean(),
  expires_at: isoDateTimeSchema,
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
  login_id: z.string().min(1).max(CODEX_LOGIN_ID_MAX_LENGTH),
  state: codexLoginStateSchema,
  default_model: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
});
export type CodexLoginStatus = z.infer<typeof codexLoginStatusSchema>;

export const codexLoginSubmitCodeRequestSchema = z.object({
  redirect_url: z.string().min(1).max(CODEX_REDIRECT_INPUT_MAX_LENGTH),
});

export const codexLoginIdParamSchema = z.object({
  login_id: z.string().min(1).max(CODEX_LOGIN_ID_MAX_LENGTH),
});

export const codexLoginActionTailParamSchema = z.object({
  tail: z.string().min(1).max(CODEX_LOGIN_ACTION_TAIL_MAX_LENGTH),
});
