import { gt, valid } from 'semver';

import { manifestArtifactAvailability } from './cdn';
import { type InstallSource, type UpdateManifest, type UpdateTarget } from './types';

export function selectUpdateTarget(
  currentVersion: string,
  latest: string | null,
): UpdateTarget | null {
  if (latest === null) return null;
  if (valid(currentVersion) === null || valid(latest) === null) return null;
  if (!gt(latest, currentVersion)) return null;
  return { version: latest };
}

/**
 * Whether an update can be installed from this source at all. Only the native
 * install path consumes a platform artifact, so only it must be suppressed
 * when the manifest does not advertise one:
 * - npm-family sources (`npm-global`, `pnpm-global`, `yarn-global`,
 *   `bun-global`) install from the npm registry, where the published version
 *   *is* the artifact — a missing native zip says nothing about them, and
 *   suppressing their update would be a regression.
 * - `homebrew` installs through its own formula.
 * - `unsupported` never installs anyway.
 */
export function isTargetInstallable(source: InstallSource, manifest: UpdateManifest | null): boolean {
  if (source !== 'native') return true;
  return manifestArtifactAvailability(manifest) === 'available';
}
