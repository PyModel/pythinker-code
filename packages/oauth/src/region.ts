/**
 * Region profiles for the mainland-China (.com) and global (.ai)
 * Pythinker Code deployments, plus the resolver that decides which region a
 * client belongs to.
 *
 * A region is a bundle of endpoints (OAuth host, managed API base URL, CDN,
 * site, telemetry). The OAuth client_id is shared across regions and stays
 * in `./constants`.
 *
 * Resolution order (first match wins):
 *   1. env override (`PYTHINKER_CODE_OAUTH_HOST` / `PYTHINKER_OAUTH_HOST`)
 *   2. persisted login (the `oauthHost` stored in config.toml's oauth ref)
 *   3. persisted default-slot login (the oauth ref's key equals
 *      `PYTHINKER_CODE_OAUTH_KEY` — a mainland-China login persists no
 *      `oauthHost`, so the default slot's presence is an explicit-mainland-cn
 *      signal that outranks the marker)
 *   4. install-channel marker file (`<home>/region`, written by install
 *      scripts; consultable only before the first login)
 *   5. default 'mainland-cn'
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { DEFAULT_PYTHINKER_CODE_OAUTH_HOST } from './constants';
import { DEFAULT_PYTHINKER_CODE_BASE_URL } from './managed-usage';
import { pythinkerCodeEnvBaseUrl, pythinkerCodeEnvOAuthHost, PYTHINKER_CODE_OAUTH_KEY } from './managed-pythinker-code';

export type PythinkerRegion = 'mainland-cn' | 'global';

/** Zod schema for the wire/domain contract; parses to {@link PythinkerRegion}. */
export const pythinkerRegionSchema = z.enum(['mainland-cn', 'global']);

export interface PythinkerRegionProfile {
  /** OAuth host the device flow talks to (authorize/token derive from it). */
  readonly oauthHost: string;
  /** Managed API base (`/coding/v1`): usages, userinfo, models, feedback... */
  readonly baseUrl: string;
  /** Update/install/plugin-marketplace root. */
  readonly cdnBase: string;
  /** Official site root (docs, console, signup, upgrade pages). */
  readonly siteBase: string;
  readonly telemetryEndpoint: string;
}

export const PYTHINKER_REGION_PROFILES: Record<PythinkerRegion, PythinkerRegionProfile> = {
  'mainland-cn': {
    oauthHost: DEFAULT_PYTHINKER_CODE_OAUTH_HOST,
    baseUrl: DEFAULT_PYTHINKER_CODE_BASE_URL,
    cdnBase: 'https://code.pythinker.com/pythinker-code',
    siteBase: 'https://www.pythinker.com',
    telemetryEndpoint: 'https://telemetry-logs.pythinker.com/v1/event',
  },
  global: {
    oauthHost: 'https://auth.kimi.ai',
    baseUrl: 'https://api.kimi.ai/coding/v1',
    cdnBase: 'https://code.pythinker.ai/pythinker-code',
    siteBase: 'https://www.pythinker.ai',
    telemetryEndpoint: 'https://telemetry-logs.pythinker.ai/v1/event',
  },
};

export function pythinkerRegionProfile(region: PythinkerRegion): PythinkerRegionProfile {
  return PYTHINKER_REGION_PROFILES[region];
}

/**
 * Content-CDN URL builder (tips banner, WebBridge / Computer-Use binaries).
 * International mirror coverage of cdn.pythinker.ai for these payloads is still
 * being confirmed, so both regions currently share the .com host — funnel
 * every content URL through here so flipping later touches one function.
 */
export function pythinkerCdnContentUrl(path: string): string {
  return `https://cdn.pythinker.com/${path.replace(/^\/+/, '')}`;
}

/**
 * Login hosts for an explicit region choice, or `undefined` when an env
 * override (`PYTHINKER_CODE_OAUTH_HOST` / `PYTHINKER_OAUTH_HOST` / `PYTHINKER_CODE_BASE_URL`)
 * is in play — env keeps full control of endpoints, so a region pick must not
 * smuggle profile hosts past it (requested hosts outrank env in
 * `resolvePythinkerCodeLoginAuth`).
 *
 * When returned, both hosts are always set — including for 'mainland-cn',
 * whose values equal the defaults. Passing them explicitly is what lets
 * "switch back to mainland China" override a previously persisted global
 * login in config.toml.
 */
export function pythinkerRegionLoginHosts(
  region: PythinkerRegion,
  env: NodeJS.ProcessEnv = process.env,
): { readonly oauthHost: string; readonly baseUrl: string } | undefined {
  if (pythinkerCodeEnvOAuthHost(env) !== undefined || pythinkerCodeEnvBaseUrl(env) !== undefined) {
    return undefined;
  }
  const profile = pythinkerRegionProfile(region);
  return { oauthHost: profile.oauthHost, baseUrl: profile.baseUrl };
}

/**
 * Marker file name under the Pythinker home dir. Install scripts write a single
 * line (`mainland-cn` or `global`) here so a fresh client can default to the
 * region matching the channel it was installed from. It is only consulted
 * while the user has never logged in; a persisted login (config.toml) always
 * wins.
 */
export const PYTHINKER_REGION_MARKER_FILENAME = 'region';

export interface ResolvePythinkerRegionOptions {
  /** Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** The `oauthHost` persisted in config.toml's oauth ref, if any. */
  readonly configuredOAuthHost?: string;
  /**
   * The credential key persisted in config.toml's oauth ref, if any. The
   * default slot ({@link PYTHINKER_CODE_OAUTH_KEY}) only ever holds a
   * mainland-China login — mainland-cn persists no `oauthHost` — so its
   * presence is an explicit-mainland-cn signal that outranks the
   * install-channel marker.
   */
  readonly configuredOAuthKey?: string;
  /** Pythinker home dir; defaults to `PYTHINKER_CODE_HOME` or `~/.pythinker-code`. */
  readonly homeDir?: string;
  /**
   * Set false to skip the install-channel marker (e.g. the desktop app's
   * embedded server, which is not installed through a channel script and
   * leaves the region choice entirely to the login UI).
   */
  readonly readMarker?: boolean;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function regionForOAuthHost(oauthHost: string): PythinkerRegion | undefined {
  const normalized = normalizeHost(oauthHost);
  for (const region of Object.keys(PYTHINKER_REGION_PROFILES) as PythinkerRegion[]) {
    if (normalizeHost(PYTHINKER_REGION_PROFILES[region].oauthHost) === normalized) return region;
  }
  return undefined;
}

function readRegionMarker(homeDir: string): PythinkerRegion | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(homeDir, PYTHINKER_REGION_MARKER_FILENAME), 'utf-8');
  } catch {
    return undefined;
  }
  const value = raw.trim();
  return value === 'mainland-cn' || value === 'global' ? value : undefined;
}

// Mirrors `defaultPythinkerHome` in ./toolkit; keep the two in sync so the marker
// always lands next to the credentials dir it describes.
function defaultHomeDir(env: NodeJS.ProcessEnv): string {
  const override = env['PYTHINKER_CODE_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.pythinker-code');
}

export function resolvePythinkerRegion(options: ResolvePythinkerRegionOptions = {}): PythinkerRegion {
  const env = options.env ?? process.env;
  // An env host that matches a profile pins the region. An unknown env host
  // means a custom/internal environment: the per-endpoint env overrides keep
  // doing their job regardless of region, so skip straight to the default
  // instead of letting a stale config/marker point CDN links somewhere odd.
  const envHost = env['PYTHINKER_CODE_OAUTH_HOST'] ?? env['PYTHINKER_OAUTH_HOST'];
  if (envHost !== undefined && envHost.length > 0) {
    return regionForOAuthHost(envHost) ?? 'mainland-cn';
  }
  const configured = options.configuredOAuthHost;
  if (configured !== undefined && configured.length > 0) {
    const configuredRegion = regionForOAuthHost(configured);
    if (configuredRegion !== undefined) return configuredRegion;
  }
  if (options.configuredOAuthKey === PYTHINKER_CODE_OAUTH_KEY) return 'mainland-cn';
  if (options.readMarker !== false) {
    const markerRegion = readRegionMarker(options.homeDir ?? defaultHomeDir(env));
    if (markerRegion !== undefined) return markerRegion;
  }
  return 'mainland-cn';
}
