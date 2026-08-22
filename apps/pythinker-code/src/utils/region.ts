/**
 * Process-wide region cache for the CLI/TUI.
 *
 * Region decides which deployment (mainland-China .com / international .ai)
 * the client's off-session endpoints point at: CDN (updates, plugins, tips),
 * site links, telemetry. The OAuth login flow itself does NOT read this — it
 * takes explicit hosts; this cache is for everything derived afterwards.
 *
 * Resolution lives in `@pymodel/pythinker-code-oauth` (see `resolvePythinkerRegion`);
 * this module only adds the one thing that package deliberately does not own:
 * reading the persisted login's oauth ref (credential key + `oauthHost`) out
 * of config.toml, synchronously, via the SDK's safe config reader. First call
 * wins; `refreshPythinkerRegion` re-resolves after login/logout rewrote the oauth
 * ref.
 */

import { loadRuntimeConfigSafe, resolveConfigPath } from '@pymodel/pythinker-code-sdk';
import {
  PYTHINKER_CODE_OAUTH_KEY,
  PYTHINKER_REGION_PROFILES,
  resolvePythinkerRegion,
  type PythinkerRegion,
  type PythinkerRegionProfile,
} from '@pymodel/pythinker-code-oauth';

// Same value as DEFAULT_OAUTH_PROVIDER_NAME in '#/constant/app' — inlined here
// to keep the import one-directional (constant/app derives URLs from this
// module, so this module must not import back from it).
const MANAGED_PYTHINKER_CODE_PROVIDER_KEY = 'managed:pythinker-code';

/** Platform-selector value for the global OAuth login entry. */
export const PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE = 'pythinker-code-global';

let cached: PythinkerRegion | undefined;

export interface PersistedPythinkerOAuthRef {
  readonly key: string;
  readonly oauthHost?: string;
}

/** The oauth ref persisted by a previous login, if any. */
export function persistedPythinkerOAuthRef(): PersistedPythinkerOAuthRef | undefined {
  const result = loadRuntimeConfigSafe(resolveConfigPath({}));
  // `providers` is always present on a real config load; the `?.` guards
  // hosts/tests that hand us a partial config shape.
  const oauth = result.config.providers?.[MANAGED_PYTHINKER_CODE_PROVIDER_KEY]?.oauth;
  if (oauth === undefined) return undefined;
  return { key: oauth.key, oauthHost: oauth.oauthHost };
}

/** Region for a no-flag `pythinker login` / `pythinker acp --login`: a fresh install
    follows the resolved region (env/marker/default); the default slot (only
    ever a mainland-cn login) re-pins the profile explicitly; a scoped slot —
    a global login, or a custom env persisted with only PYTHINKER_CODE_BASE_URL and
    no oauthHost — keeps its configured hosts (`undefined`). */
export function regionForBareLogin(ref: PersistedPythinkerOAuthRef | undefined): PythinkerRegion | undefined {
  if (ref === undefined) return currentPythinkerRegion();
  return ref.key === PYTHINKER_CODE_OAUTH_KEY ? 'mainland-cn' : undefined;
}

export function currentPythinkerRegion(): PythinkerRegion {
  if (cached === undefined) {
    const persisted = persistedPythinkerOAuthRef();
    cached = resolvePythinkerRegion({
      configuredOAuthHost: persisted?.oauthHost,
      configuredOAuthKey: persisted?.key,
      readMarker: process.env['PYTHINKER_CODE_REGION_MARKER'] !== 'off',
    });
  }
  return cached;
}

export function currentPythinkerProfile(): PythinkerRegionProfile {
  return PYTHINKER_REGION_PROFILES[currentPythinkerRegion()];
}

/** Drop the cache and re-resolve. Call after login/logout rewrote config. */
export function refreshPythinkerRegion(): PythinkerRegion {
  cached = undefined;
  return currentPythinkerRegion();
}
