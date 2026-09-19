/**
 * Process-wide region cache for the CLI/TUI.
 *
 * Region decides which deployment profile the client's off-session endpoints
 * point at: CDN (updates, plugins, tips), site links, and telemetry.
 */

import {
  PYTHINKER_REGION_PROFILES,
  resolvePythinkerRegion,
  type PythinkerRegion,
  type PythinkerRegionProfile,
} from '@pymodel/pythinker-code-oauth';

let cached: PythinkerRegion | undefined;

export function currentPythinkerRegion(): PythinkerRegion {
  if (cached === undefined) {
    cached = resolvePythinkerRegion({
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
