/** `authSummaryService` — app-scope credential status and readiness. */

import { z } from 'zod';

import { noResult } from '../helpers.js';
import type { ServiceContract } from '../types.js';

export const authStatusSchema = z.object({
  loggedIn: z.boolean(),
  provider: z.string(),
});

export const authSummaryContract = {
  summarize: { input: z.tuple([]), output: z.array(authStatusSchema) },
  ensureReady: { input: z.tuple([z.string().optional()]), output: noResult },
} satisfies ServiceContract;
