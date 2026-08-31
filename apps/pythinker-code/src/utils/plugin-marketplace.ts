/**
 * `#/utils/plugin-marketplace` — CLI-side wrapper over the shared plugin
 * marketplace client/parser (`@pymodel/agent-core-v2`,
 * `app/plugin/marketplace`). The shared module owns catalog reading, the
 * lenient entry normalization, source resolution, and version derivation;
 * this wrapper adds only the CLI's configured-source resolution (option →
 * env) and the caller-supplied built-in capability entry injection.
 */

import {
  parsePluginMarketplace,
  readPluginMarketplace,
  withBuiltInEntries,
  withLatestVersions,
  type PluginMarketplace,
  type PluginMarketplaceEntry,
} from '@pymodel/agent-core-v2/app/plugin/marketplace';

import {
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV,
  MARKETPLACE_VERSION_LOOKUP_TIMEOUT_MS,
} from '#/constant/app';

export {
  computeUpdateStatus,
  PLUGIN_MARKETPLACE_TIERS,
  withBuiltInEntries,
  type PluginMarketplace,
  type PluginMarketplaceEntry,
  type PluginMarketplaceTier,
  type MarketplaceUpdateStatus,
} from '@pymodel/agent-core-v2/app/plugin/marketplace';

export interface LoadPluginMarketplaceOptions {
  readonly workDir: string;
  readonly source?: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Built-in capability rows to inject, supplied by the caller from the
   * engine's capability registry (this util owns no product knowledge).
   * Undefined means no injection.
   */
  readonly builtInEntries?: readonly PluginMarketplaceEntry[];
  /**
   * Skip the per-entry "latest GitHub release" lookups so the catalog can be
   * rendered as soon as it is parsed; the caller resolves versions in the
   * background via {@link withMarketplaceLatestVersions} and re-renders.
   */
  readonly skipLatestVersions?: boolean;
}

/**
 * Second phase of the marketplace load: fill in `version` for entries that
 * need a GitHub `releases/latest` lookup. Every lookup gets a hard timeout
 * (MARKETPLACE_VERSION_LOOKUP_TIMEOUT_MS) and per-entry failures degrade to
 * a missing version (badge-less row), so this never throws for network
 * reasons and never blocks the first paint.
 */
export async function withMarketplaceLatestVersions(
  marketplace: PluginMarketplace,
  fetchImpl: typeof fetch = fetch,
): Promise<PluginMarketplace> {
  const timedFetch: typeof fetch = (input, init) =>
    fetchImpl(input, {
      ...init,
      signal: AbortSignal.timeout(MARKETPLACE_VERSION_LOOKUP_TIMEOUT_MS),
    });
  return withLatestVersions(marketplace, timedFetch);
}

export async function loadPluginMarketplace(
  options: LoadPluginMarketplaceOptions,
): Promise<PluginMarketplace> {
  const source = options.source ?? process.env[PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV];
  const builtInEntries = options.builtInEntries ?? [];
  if (source === undefined) {
    return withBuiltInEntries({ source: '', plugins: [] }, builtInEntries);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let read;
  try {
    read = await readPluginMarketplace({
      source,
      workDir: options.workDir,
      fetchImpl,
    });
  } catch (error) {
    if (options.builtInEntries !== undefined) {
      // The built-in entries do not come from the catalog — keep them
      // visible when the catalog itself is unreachable.
      return withBuiltInEntries({ source, plugins: [] }, options.builtInEntries);
    }
    throw error;
  }
  const marketplace = options.skipLatestVersions === true
    ? parsePluginMarketplace(read.raw, read.location)
    : await withLatestVersions(parsePluginMarketplace(read.raw, read.location), fetchImpl);
  return withBuiltInEntries(marketplace, builtInEntries);
}
