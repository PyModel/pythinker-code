import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolvePythinkerHome } from '@pymodel/pythinker-code-sdk';

export type PythinkerRegion = 'mainland-cn' | 'global';

export interface PythinkerRegionProfile {
  readonly telemetryEndpoint: string;
}

// Pythinker runs a single telemetry host, so every region reports to it.
const TELEMETRY_ENDPOINT = 'https://telemetry-logs.pythinker.com/v1/event';

const PROFILES: Record<PythinkerRegion, PythinkerRegionProfile> = {
  'mainland-cn': {
    telemetryEndpoint: TELEMETRY_ENDPOINT,
  },
  global: {
    telemetryEndpoint: TELEMETRY_ENDPOINT,
  },
};

let cached: PythinkerRegion | undefined;

export function currentPythinkerRegion(): PythinkerRegion {
  cached ??= readRegionMarker();
  return cached;
}

export function currentPythinkerProfile(): PythinkerRegionProfile {
  return PROFILES[currentPythinkerRegion()];
}

export function refreshPythinkerRegion(): PythinkerRegion {
  cached = undefined;
  return currentPythinkerRegion();
}

function readRegionMarker(): PythinkerRegion {
  if (process.env['PYTHINKER_CODE_REGION_MARKER'] === 'off') return 'mainland-cn';
  try {
    return readFileSync(join(resolvePythinkerHome(), 'region'), 'utf8').trim() === 'global'
      ? 'global'
      : 'mainland-cn';
  } catch {
    return 'mainland-cn';
  }
}
