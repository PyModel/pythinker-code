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

import { PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV } from '#/constant/app';

export {
  computeUpdateStatus,
  PLUGIN_MARKETPLACE_TIERS,
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
  const marketplace = await withLatestVersions(
    parsePluginMarketplace(read.raw, read.location),
    fetchImpl,
  );
  return withBuiltInEntries(marketplace, builtInEntries);
}
