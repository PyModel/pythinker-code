/**
 * Process-wide region cache for the CLI/TUI.
 */

import {
  PYTHINKER_REGION_PROFILES,
  resolvePythinkerRegion,
  type PythinkerRegion,
  type PythinkerRegionProfile,
} from '@pymodel/pythinker-code-oauth';

let cached: PythinkerRegion | undefined;

export interface PersistedPythinkerOAuthRef {
  readonly key: string;
  readonly oauthHost?: string;
}

/** Best-effort persisted oauth ref. Without managed slots this is unused. */
export function persistedPythinkerOAuthRef(): PersistedPythinkerOAuthRef | undefined {
  return undefined;
}

export function regionForBareLogin(_ref: PersistedPythinkerOAuthRef | undefined): PythinkerRegion | undefined {
  return currentPythinkerRegion();
}

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

export function refreshPythinkerRegion(): PythinkerRegion {
  cached = undefined;
  return currentPythinkerRegion();
}

export const PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE = 'openai-global';
