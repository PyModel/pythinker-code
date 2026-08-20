import { valid } from 'semver';
import { z } from 'zod';

import type { UpdateManifest } from './types';

const RolloutBatchSchema = z.object({
  percent: z.number().int().min(0).max(100),
  delaySeconds: z.number().int().min(0),
});

/**
 * CDN `latest.json` wire format. Deliberately NOT `.strict()` — unknown
 * fields are ignored so future manifest additions never break shipped
 * clients (the plain-text `/latest` taught us that hard-failing on
 * unexpected content bricks the update path forever).
 */
export const UpdateManifestSchema = z.object({
  version: z.string().refine((value) => valid(value) !== null, { error: 'invalid semver' }),
  publishedAt: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)), { error: 'invalid timestamp' }),
  rollout: z.array(RolloutBatchSchema).readonly().default([]),
});

export interface FetchLatestResult {
  /** Raw newest version — what `pythinker upgrade` installs, never rollout-gated. */
  readonly latest: string;
  /** Null when the JSON manifest was unavailable and we fell back to plain text. */
  readonly manifest: UpdateManifest | null;
}

export const UPDATE_DISABLED_MESSAGE =
  'Self-update is disabled in this build. Install updates from https://github.com/PyModel/pythinker-code/releases or via npm.';

export async function fetchLatestVersionFromCdn(
  _fetchImpl: typeof fetch = fetch,
): Promise<string> {
  throw new Error(UPDATE_DISABLED_MESSAGE);
}

export async function fetchLatestFromCdn(
  _fetchImpl: typeof fetch = fetch,
): Promise<FetchLatestResult> {
  throw new Error(UPDATE_DISABLED_MESSAGE);
}
