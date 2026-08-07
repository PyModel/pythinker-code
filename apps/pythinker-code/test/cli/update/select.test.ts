import { describe, expect, it } from 'vitest';

import { isTargetInstallable, selectUpdateTarget } from '#/cli/update/select';
import type { UpdateManifest } from '#/cli/update/types';

describe('selectUpdateTarget', () => {
  it('returns the latest version when it is newer than current', () => {
    expect(selectUpdateTarget('0.4.0', '0.5.0')).toEqual({ version: '0.5.0' });
  });

  it('returns null when latest equals current', () => {
    expect(selectUpdateTarget('0.5.0', '0.5.0')).toBeNull();
  });

  it('returns null when latest is older than current', () => {
    expect(selectUpdateTarget('0.6.0', '0.5.0')).toBeNull();
  });

  it('returns null when latest is null (cache empty)', () => {
    expect(selectUpdateTarget('0.5.0', null)).toBeNull();
  });

  it('returns null when current is not a valid semver', () => {
    expect(selectUpdateTarget('not-a-version', '0.5.0')).toBeNull();
  });

  it('returns null when latest is not a valid semver', () => {
    expect(selectUpdateTarget('0.5.0', 'not-a-version')).toBeNull();
  });

  it('handles prerelease semver comparisons correctly', () => {
    expect(selectUpdateTarget('0.5.0-rc.1', '0.5.0')).toEqual({ version: '0.5.0' });
    expect(selectUpdateTarget('0.5.0', '0.5.0-rc.1')).toBeNull();
  });
});

describe('isTargetInstallable', () => {
  const artifact = {
    url: 'https://code.pythinker.com/pythinker-code-0.5.0.zip',
    sha256: 'a'.repeat(64),
  };

  function manifestWithPlatforms(platforms: Record<string, { url: string; sha256: string }>): UpdateManifest {
    return {
      version: '0.5.0',
      publishedAt: '2020-01-01T00:00:00.000Z',
      rollout: [],
      platforms,
    };
  }

  function manifestOmittingRunningTarget(): UpdateManifest {
    const otherArch = process.arch === 'arm64' ? 'x64' : 'arm64';
    return manifestWithPlatforms({ [`${process.platform}-${otherArch}`]: artifact });
  }

  it('native: returns false when the manifest omits the running target', () => {
    expect(isTargetInstallable('native', manifestOmittingRunningTarget())).toBe(false);
  });

  it('native: returns true when the manifest has an entry for the running target', () => {
    expect(
      isTargetInstallable('native', manifestWithPlatforms({ [`${process.platform}-${process.arch}`]: artifact })),
    ).toBe(true);
  });

  it('native: returns true for a null manifest', () => {
    expect(isTargetInstallable('native', null)).toBe(true);
  });

  it('native: returns true for a manifest with no platforms key', () => {
    const manifest: UpdateManifest = {
      version: '0.5.0',
      publishedAt: '2020-01-01T00:00:00.000Z',
      rollout: [],
    };
    expect(isTargetInstallable('native', manifest)).toBe(true);
  });

  it('npm-global: returns true even when the manifest omits the running target', () => {
    expect(isTargetInstallable('npm-global', manifestOmittingRunningTarget())).toBe(true);
  });
});
