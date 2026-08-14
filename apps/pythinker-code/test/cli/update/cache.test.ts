import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptyUpdateInstallState,
  readUpdateInstallState,
  writeUpdateInstallState,
} from '#/cli/update/install-state';
import { readUpdateCache, writeUpdateCache } from '#/cli/update/cache';
import { emptyUpdateCache, type UpdateInstallState } from '#/cli/update/types';
import {
  getUpdateInstallLogFile,
  getUpdateInstallStateFile,
  getUpdateStateFile,
} from '#/utils/paths';

const originalEnv = { ...process.env };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pythinker-update-cache-'));
  process.env['PYTHINKER_CODE_HOME'] = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('update cache', () => {
  it('returns an empty cache when the file is missing', async () => {
    await expect(readUpdateCache()).resolves.toEqual(emptyUpdateCache());
  });

  it('falls back to an empty cache when the file is corrupt', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(getUpdateStateFile(), '{"broken"', 'utf-8');
    await expect(readUpdateCache()).resolves.toEqual(emptyUpdateCache());
  });

  it('falls back to an empty cache when the file has the old npm.json shape', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(
      getUpdateStateFile(),
      JSON.stringify({
        packageName: '@pymodel/pythinker-code',
        checkedAt: '2026-04-23T08:00:00.000Z',
        distTags: { beta: '0.0.1-beta.1' },
      }),
      'utf-8',
    );
    await expect(readUpdateCache()).resolves.toEqual(emptyUpdateCache());
  });

  it('writes and reads back the cache from updates/latest.json', async () => {
    const cache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: '0.5.0',
      manifest: null,
    } as const;

    await writeUpdateCache(cache);

    expect(getUpdateStateFile()).toBe(join(dir, 'updates', 'latest.json'));
    await expect(readUpdateCache()).resolves.toEqual(cache);
  });

  it('writes and reads back a cache carrying a rollout manifest', async () => {
    const cache = {
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: '0.5.0',
      manifest: {
        version: '0.5.0',
        publishedAt: '2026-04-23T07:00:00.000Z',
        rollout: [
          { percent: 30, delaySeconds: 0 },
          { percent: 30, delaySeconds: 43_200 },
          { percent: 40, delaySeconds: 86_400 },
        ],
      },
    } as const;

    await writeUpdateCache(cache);

    await expect(readUpdateCache()).resolves.toEqual(cache);
  });

  it('reads a legacy cache file without a manifest field as manifest null', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(
      getUpdateStateFile(),
      JSON.stringify({
        source: 'cdn',
        checkedAt: '2026-04-23T08:00:00.000Z',
        latest: '0.5.0',
      }),
      'utf-8',
    );

    await expect(readUpdateCache()).resolves.toEqual({
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: '0.5.0',
      manifest: null,
    });
  });

  it('keeps latest and treats a malformed manifest field as null', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(
      getUpdateStateFile(),
      JSON.stringify({
        source: 'cdn',
        checkedAt: '2026-04-23T08:00:00.000Z',
        latest: '0.5.0',
        manifest: { version: 'not-semver', publishedAt: 'nope', rollout: 'bad' },
      }),
      'utf-8',
    );

    await expect(readUpdateCache()).resolves.toEqual({
      source: 'cdn',
      checkedAt: '2026-04-23T08:00:00.000Z',
      latest: '0.5.0',
      manifest: null,
    });
  });
});

describe('update install state', () => {
  it('returns an empty install state when the file is missing', async () => {
    await expect(readUpdateInstallState()).resolves.toEqual(emptyUpdateInstallState());
  });

  it('falls back to an empty install state when the file is corrupt', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(getUpdateInstallStateFile(), '{"broken"', 'utf-8');
    await expect(readUpdateInstallState()).resolves.toEqual(emptyUpdateInstallState());
  });

  it('reads a legacy install.json whose active record has no pid', async () => {
    const legacyState: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: '2026-04-23T08:00:00.000Z',
      },
      pending: null,
      lastFailure: null,
      lastSuccess: null,
    };
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(getUpdateInstallStateFile(), JSON.stringify(legacyState), 'utf-8');

    await expect(readUpdateInstallState()).resolves.toEqual(legacyState);
  });

  it('writes and reads back the install state from updates/install.json', async () => {
    const state: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: '2026-04-23T08:00:00.000Z',
        pid: 42_424,
      },
      pending: {
        jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
        source: 'homebrew',
        version: '0.5.0',
        preparedAt: '2026-04-23T08:05:00.000Z',
        requestedBy: 'automatic',
        formulaUrl: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
        artifactKind: 'source',
        artifactSha256: 'a'.repeat(64),
        formulaFileSha256: 'b'.repeat(64),
        artifactPath: '/tmp/cache/pythinker-code-0.5.0.tgz',
      },
      lastFailure: {
        version: '0.4.0',
        failedAt: '2026-04-22T08:00:00.000Z',
        attempts: 1,
      },
      lastSuccess: {
        version: '0.3.0',
        installedAt: '2026-04-21T08:00:00.000Z',
        notifiedAt: null,
      },
    };

    await writeUpdateInstallState(state);

    expect(getUpdateInstallStateFile()).toBe(join(dir, 'updates', 'install.json'));
    expect(getUpdateInstallLogFile()).toBe(join(dir, 'updates', 'install.log'));
    const persisted = JSON.parse(readFileSync(getUpdateInstallStateFile(), 'utf-8')) as {
      readonly active: { readonly pid?: number } | null;
    };
    expect(persisted.active?.pid).toBe(42_424);
    await expect(readUpdateInstallState()).resolves.toEqual(state);
  });
});
