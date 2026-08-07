import { writeUpdateCache } from './cache';
import { fetchUpdateManifest } from './cdn';
import { type UpdateCache, type UpdateManifest } from './types';

export interface RefreshUpdateCacheDeps {
  /** Resolves with the CDN update manifest. **Throws** on any failure — callers
   * (including the default background invocation in preflight) must catch.
   * Errors intentionally skip `writeCache` so a transient CDN blip does not
   * overwrite a previously known `latest` with `null`. */
  readonly fetchManifest: () => Promise<UpdateManifest>;
  readonly writeCache: (cache: UpdateCache) => Promise<void>;
  readonly now: () => Date;
}

export async function refreshUpdateCache(
  overrides: Partial<RefreshUpdateCacheDeps> = {},
): Promise<UpdateCache> {
  const resolved: RefreshUpdateCacheDeps = {
    fetchManifest: overrides.fetchManifest ?? (() => fetchUpdateManifest()),
    writeCache: overrides.writeCache ?? writeUpdateCache,
    now: overrides.now ?? (() => new Date()),
  };

  const manifest = await resolved.fetchManifest();
  const cache: UpdateCache = {
    source: 'cdn',
    checkedAt: resolved.now().toISOString(),
    latest: manifest.version,
    manifest,
  };
  await resolved.writeCache(cache);
  return cache;
}
