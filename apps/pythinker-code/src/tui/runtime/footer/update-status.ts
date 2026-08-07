import { gt, valid } from 'semver';

import { isTargetInstallable, selectUpdateTarget } from '#/cli/update/select';
import type {
  InstallSource,
  UpdateCache,
  UpdateInstallState,
} from '#/cli/update/types';
import type { FooterUpdate } from './footer-model';

/**
 * Map the persisted update state onto the footer update slice.
 *
 * Precedence, highest first:
 *   1. an active install for a newer version that is downloading or waiting
 *   2. a recorded success for a newer version (needs a restart to apply)
 *   3. a recorded failure for a newer version
 *   4. an installable target advertised by the update cache
 *   5. nothing
 *
 * Pure: no file reads, no clock, no `process.*` — everything comes in as
 * arguments so the poller stays off the render path.
 */
export function footerUpdateFromState(
  currentVersion: string,
  source: InstallSource,
  cache: UpdateCache | null,
  installState: UpdateInstallState,
): FooterUpdate {
  const active = installState.active;
  const progress = active?.progress;
  if (
    active !== null &&
    progress !== undefined &&
    isNewer(active.version, currentVersion) &&
    (progress.state === 'downloading' || progress.state === 'waiting')
  ) {
    return {
      version: active.version,
      state: progress.state,
      percent: progress.percent ?? null,
    };
  }

  const success = installState.lastSuccess;
  if (success !== null && isNewer(success.version, currentVersion)) {
    return { version: success.version, state: 'ready', percent: null };
  }

  const failure = installState.lastFailure;
  if (failure !== null && isNewer(failure.version, currentVersion)) {
    return { version: failure.version, state: 'failed', percent: null };
  }

  const target = selectUpdateTarget(currentVersion, cache?.latest ?? null);
  if (target !== null && isTargetInstallable(source, cache?.manifest ?? null)) {
    return { version: target.version, state: 'available', percent: null };
  }

  return { version: null, state: null, percent: null };
}

function isNewer(version: string, currentVersion: string): boolean {
  if (valid(version) === null || valid(currentVersion) === null) return false;
  return gt(version, currentVersion);
}
