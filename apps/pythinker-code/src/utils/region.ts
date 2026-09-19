/**
 * Process-wide region cache for the CLI/TUI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

export function persistedPythinkerOAuthRef(): PersistedPythinkerOAuthRef | undefined {
  return undefined;
}

export function regionForBareLogin(ref: PersistedPythinkerOAuthRef | undefined): PythinkerRegion | undefined {
  if (ref === undefined) return currentPythinkerRegion();
  if (ref.key === 'oauth/pythinker-code' || /(?:^|\/)oauth\/pythinker-code$/.test(ref.key)) {
    return 'mainland-cn';
  }
  return undefined;
}

function readConfiguredOAuthFromToml(home: string): { host?: string; key?: string } {
  try {
    const text = readFileSync(join(home, 'config.toml'), 'utf8');
    const hostMatch = /oauthHost\s*=\s*"([^"]+)"/.exec(text);
    const keyMatch = /key\s*=\s*"([^"]+)"/.exec(text);
    return {
      host: hostMatch?.[1],
      key: keyMatch?.[1],
    };
  } catch {
    return {};
  }
}

export function currentPythinkerRegion(): PythinkerRegion {
  if (cached === undefined) {
    const home = process.env['PYTHINKER_CODE_HOME'] ?? join(process.env['HOME'] ?? '', '.pythinker-code');
    const configured = readConfiguredOAuthFromToml(home);
    cached = resolvePythinkerRegion({
      readMarker: process.env['PYTHINKER_CODE_REGION_MARKER'] !== 'off',
      configuredOAuthHost: configured.host,
      configuredOAuthKey: configured.key,
      homeDir: home,
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
