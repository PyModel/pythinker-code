import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

export type PythinkerRegion = 'mainland-cn' | 'global';

export const pythinkerRegionSchema = z.enum(['mainland-cn', 'global']);

export interface PythinkerRegionProfile {
  readonly cdnBase: string;
  readonly siteBase: string;
  readonly telemetryEndpoint: string;
}

export const PYTHINKER_REGION_PROFILES: Record<PythinkerRegion, PythinkerRegionProfile> = {
  'mainland-cn': {
    cdnBase: 'https://code.pythinker.com/pythinker-code',
    siteBase: 'https://www.pythinker.com',
    telemetryEndpoint: 'https://telemetry-logs.pythinker.com/v1/event',
  },
  global: {
    cdnBase: 'https://code.pythinker.com/pythinker-code',
    siteBase: 'https://www.pythinker.com',
    telemetryEndpoint: 'https://telemetry-logs.pythinker.com/v1/event',
  },
};

export function pythinkerRegionProfile(region: PythinkerRegion): PythinkerRegionProfile {
  return PYTHINKER_REGION_PROFILES[region];
}

export function pythinkerCdnContentUrl(path: string): string {
  return `https://cdn.pythinker.com/${path.replace(/^\/+/, '')}`;
}

export interface ResolvePythinkerRegionOptions {
  readonly configuredOAuthHost?: string;
  readonly configuredOAuthKey?: string;
  readonly readMarker?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

function readRegionMarker(homeDir: string): PythinkerRegion | undefined {
  try {
    const raw = readFileSync(join(homeDir, 'region'), 'utf8').trim().toLowerCase();
    if (raw === 'mainland-cn' || raw === 'global') return raw;
  } catch {
    // no marker
  }
  return undefined;
}

export function resolvePythinkerRegion(options: ResolvePythinkerRegionOptions = {}): PythinkerRegion {
  const env = options.env ?? process.env;
  const host = (env['PYTHINKER_CODE_REGION'] ?? '').trim().toLowerCase();
  if (host === 'mainland-cn' || host === 'global') return host;

  if (options.configuredOAuthHost !== undefined) {
    const normalized = options.configuredOAuthHost.toLowerCase();
    if (normalized.includes('.ai') || normalized.includes('global')) return 'global';
    if (normalized.includes('.com') || normalized.includes('cn')) return 'mainland-cn';
  }

  if (options.readMarker !== false) {
    const marker = readRegionMarker(options.homeDir ?? join(homedir(), '.pythinker-code'));
    if (marker !== undefined) return marker;
  }

  return 'mainland-cn';
}
