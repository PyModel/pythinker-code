import { valid } from 'semver';
import { z } from 'zod';

import { PYTHINKER_CODE_CDN_LATEST_JSON_URL } from '#/constant/app';

import type { UpdateManifest } from './types';

const CDN_FETCH_TIMEOUT_MS = 3_000;

const RolloutBatchSchema = z.object({
  percent: z.number().int().min(0).max(100),
  delaySeconds: z.number().int().min(0),
});

const UpdateManifestPlatformSchema = z.object({
  url: z
    .string()
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { error: 'invalid url' },
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
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
  /**
   * Resolved per-platform artifacts, keyed `<platform>-<arch>`. A malformed
   * value drops only this field via `.catch(undefined)` so `version` and
   * `publishedAt` still parse — failing the whole manifest would send
   * clients to the plain-text `/latest` fallback, which carries no platform
   * information at all.
   */
  platforms: z
    .record(z.string(), UpdateManifestPlatformSchema)
    .readonly()
    .optional()
    .catch(undefined),
});

async function fetchWithTimeout(fetchImpl: typeof fetch, input: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CDN_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch the CDN update manifest — the client's only source of update truth.
 *
 * **Throws** on any failure (network error, non-2xx, unparseable body). Callers
 * must catch: `refreshUpdateCache` deliberately lets the error propagate so the
 * existing cache stays intact instead of being overwritten on a transient blip.
 *
 * There is deliberately no fallback to the plain-text `/latest` endpoint, which
 * still exists for `install.sh`. That endpoint carries no per-platform artifact
 * data, so falling back to it turns "cannot verify this platform has a build"
 * into "verified" and re-opens the hole `platforms` exists to close. It also
 * cannot fail independently: both files come from the same generator in the same
 * deploy, and the manifest schema already tolerates unknown fields and a
 * malformed `platforms` value without failing the parse.
 *
 * `fetchImpl` is injectable for tests; defaults to the global `fetch`.
 */
export async function fetchUpdateManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateManifest> {
  const response = await fetchWithTimeout(fetchImpl, PYTHINKER_CODE_CDN_LATEST_JSON_URL);
  if (!response.ok) {
    throw new Error(`CDN /latest.json returned HTTP ${response.status}`);
  }
  return UpdateManifestSchema.parse(JSON.parse(await response.text()));
}

export type ArtifactAvailability = 'available' | 'unavailable';

/**
 * Whether the manifest advertises an artifact for `target`. Unknown — a
 * null manifest or one that predates artifact addressing — resolves to
 * 'available': a CDN blip must never stop a working update, while a
 * manifest that explicitly omits the target platform is a definitive
 * denial.
 */
export function manifestArtifactAvailability(
  manifest: UpdateManifest | null,
  target: string = `${process.platform}-${process.arch}`,
): ArtifactAvailability {
  if (manifest === null) {
    return 'available';
  }
  if (manifest.platforms === undefined) {
    return 'available';
  }
  return Object.hasOwn(manifest.platforms, target) ? 'available' : 'unavailable';
}
