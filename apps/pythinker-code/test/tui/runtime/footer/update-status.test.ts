import { describe, expect, it } from 'vitest';

import type { UpdateCache, UpdateInstallState } from '#/cli/update/types';
import { footerUpdateFromState } from '#/tui/runtime/footer/update-status';

const CURRENT = '0.10.0';
const NEWER = '0.11.0';

const EMPTY = { version: null, state: null, percent: null } as const;

function installState(
  overrides: Partial<UpdateInstallState> = {},
): UpdateInstallState {
  return {
    active: null,
    pending: null,
    lastFailure: null,
    lastSuccess: null,
    ...overrides,
  };
}

function cache(latest: string | null = NEWER): UpdateCache {
  return {
    source: 'cdn',
    checkedAt: '2026-04-23T08:00:00.000Z',
    latest,
    manifest: null,
  };
}

describe('footerUpdateFromState', () => {
  it('shows downloading when an active install is newer and downloading', () => {
    const state = installState({
      active: {
        version: NEWER,
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'downloading',
          percent: 42,
          transferred: 5_320_000,
          total: 12_600_000,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual({
      version: NEWER,
      state: 'downloading',
      percent: 42,
    });
  });

  it('shows waiting when an active install is newer and waiting', () => {
    const state = installState({
      active: {
        version: NEWER,
        source: 'homebrew',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'waiting',
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
    });

    expect(footerUpdateFromState(CURRENT, 'homebrew', null, state)).toEqual({
      version: NEWER,
      state: 'waiting',
      percent: null,
    });
  });

  it('ignores an active install without progress and falls through to nothing', () => {
    const state = installState({
      active: {
        version: NEWER,
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual(EMPTY);
  });

  it('ignores an active install older than the running version', () => {
    const state = installState({
      active: {
        version: CURRENT,
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'downloading',
          percent: 42,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual(EMPTY);
  });

  it('shows ready after a newer version was installed', () => {
    const state = installState({
      lastSuccess: {
        version: NEWER,
        installedAt: '2026-04-23T08:02:00.000Z',
        notifiedAt: null,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual({
      version: NEWER,
      state: 'ready',
      percent: null,
    });
  });

  it('shows nothing when the last success is the running version', () => {
    const state = installState({
      lastSuccess: {
        version: CURRENT,
        installedAt: '2026-04-23T08:02:00.000Z',
        notifiedAt: null,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual(EMPTY);
  });

  it('shows failed after a newer install failed', () => {
    const state = installState({
      lastFailure: {
        version: NEWER,
        failedAt: '2026-04-23T08:02:00.000Z',
        attempts: 2,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual({
      version: NEWER,
      state: 'failed',
      percent: null,
    });
  });

  it('prefers the active install over a recorded success', () => {
    const state = installState({
      active: {
        version: NEWER,
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'downloading',
          percent: 10,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
      lastSuccess: {
        version: NEWER,
        installedAt: '2026-04-23T08:02:00.000Z',
        notifiedAt: null,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual({
      version: NEWER,
      state: 'downloading',
      percent: 10,
    });
  });

  it('prefers a recorded success over a recorded failure', () => {
    const state = installState({
      lastFailure: {
        version: NEWER,
        failedAt: '2026-04-23T08:02:00.000Z',
        attempts: 1,
      },
      lastSuccess: {
        version: NEWER,
        installedAt: '2026-04-23T08:03:00.000Z',
        notifiedAt: null,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', null, state)).toEqual({
      version: NEWER,
      state: 'ready',
      percent: null,
    });
  });

  it('prefers a recorded failure over an available target', () => {
    const state = installState({
      lastFailure: {
        version: NEWER,
        failedAt: '2026-04-23T08:02:00.000Z',
        attempts: 1,
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', cache(), state)).toEqual({
      version: NEWER,
      state: 'failed',
      percent: null,
    });
  });

  it('shows available when the cache targets a newer installable version', () => {
    expect(footerUpdateFromState(CURRENT, 'native', cache(), installState())).toEqual({
      version: NEWER,
      state: 'available',
      percent: null,
    });
  });

  it('shows required when the cached manifest declares a minRequiredVersion above current', () => {
    const requiredCache: UpdateCache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: NEWER,
      manifest: {
        version: NEWER,
        publishedAt: '2026-04-23T08:00:00.000Z',
        rollout: [],
        minRequiredVersion: '0.10.1',
      },
    };

    expect(footerUpdateFromState(CURRENT, 'native', requiredCache, installState())).toEqual({
      version: NEWER,
      state: 'required',
      percent: null,
    });
  });

  it('keeps available when the declared minRequiredVersion is at or below current', () => {
    const baseManifest = {
      version: NEWER,
      publishedAt: '2026-04-23T08:00:00.000Z',
      rollout: [],
    };
    const atCurrent: UpdateCache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: NEWER,
      manifest: { ...baseManifest, minRequiredVersion: CURRENT },
    };
    const belowCurrent: UpdateCache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: NEWER,
      manifest: { ...baseManifest, minRequiredVersion: '0.9.0' },
    };

    expect(footerUpdateFromState(CURRENT, 'native', atCurrent, installState())).toEqual({
      version: NEWER,
      state: 'available',
      percent: null,
    });
    expect(footerUpdateFromState(CURRENT, 'native', belowCurrent, installState())).toEqual({
      version: NEWER,
      state: 'available',
      percent: null,
    });
  });

  it('still shows downloading when a required update is already in flight', () => {
    const requiredCache: UpdateCache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: NEWER,
      manifest: {
        version: NEWER,
        publishedAt: '2026-04-23T08:00:00.000Z',
        rollout: [],
        minRequiredVersion: '0.10.1',
      },
    };
    const state = installState({
      active: {
        version: NEWER,
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'downloading',
          percent: 42,
          transferred: 5_320_000,
          total: 12_600_000,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
    });

    expect(footerUpdateFromState(CURRENT, 'native', requiredCache, state)).toEqual({
      version: NEWER,
      state: 'downloading',
      percent: 42,
    });
  });

  it('shows nothing when the cache target is not installable from this source', () => {
    const unavailableCache: UpdateCache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: NEWER,
      manifest: {
        version: NEWER,
        publishedAt: '2026-04-23T08:00:00.000Z',
        rollout: [],
        platforms: {},
      },
    };

    expect(
      footerUpdateFromState(CURRENT, 'native', unavailableCache, installState()),
    ).toEqual(EMPTY);
  });

  it('shows nothing when the cache is null', () => {
    expect(footerUpdateFromState(CURRENT, 'native', null, installState())).toEqual(EMPTY);
  });

  it('shows nothing when the cache has no newer latest', () => {
    expect(footerUpdateFromState(CURRENT, 'native', cache(CURRENT), installState())).toEqual(
      EMPTY,
    );
  });
});
