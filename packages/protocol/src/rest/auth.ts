/**
 * GET /v1/auth
 *   Reply: AuthSummary {
 *     ready,
 *     models_ready,
 *     providers_count,
 *     default_model
 *   }
 */
import { z } from 'zod';

export const authSummarySchema = z.object({
  ready: z.boolean(),
  models_ready: z.boolean(),
  providers_count: z.number().int().nonnegative(),
  default_model: z.string().nullable(),
});
export type AuthSummary = z.infer<typeof authSummarySchema>;
