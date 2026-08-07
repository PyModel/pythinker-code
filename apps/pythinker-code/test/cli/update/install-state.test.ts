import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptyUpdateInstallState,
  readUpdateInstallState,
  reconcileAbandonedInstall,
  writeUpdateInstallState,
} from '#/cli/update/install-state';
import type {
  UpdateInstallState,
  UpdateInstallSuccess,
  UpdatePreparedHomebrew,
} from '#/cli/update/types';
import { getUpdateInstallStateFile } from '#/utils/paths';

const originalEnv = { ...process.env };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pythinker-install-state-'));
  process.env['PYTHINKER_CODE_HOME'] = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('update install state', () => {
  it('round-trips an active record carrying installer progress', async () => {
    const state: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        pid: 42_424,
        progress: {
          state: 'downloading',
          percent: 42,
          transferred: 5_320_000,
          total: 12_600_000,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
      pending: null,
      lastFailure: null,
      lastSuccess: null,
    };

    await writeUpdateInstallState(state);

    await expect(readUpdateInstallState()).resolves.toEqual(state);
  });

  it('round-trips progress without a total (unknown download size)', async () => {
    const state: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'native',
        startedAt: '2026-04-23T08:00:00.000Z',
        progress: {
          state: 'downloading',
          transferred: 5_320_000,
          updatedAt: '2026-04-23T08:01:00.000Z',
        },
      },
      pending: null,
      lastFailure: null,
      lastSuccess: null,
    };

    await writeUpdateInstallState(state);

    await expect(readUpdateInstallState()).resolves.toEqual(state);
  });

  it('falls back to an empty state when the active record has malformed progress', async () => {
    mkdirSync(join(dir, 'updates'), { recursive: true });
    writeFileSync(
      getUpdateInstallStateFile(),
      JSON.stringify({
        active: {
          version: '0.5.0',
          source: 'native',
          startedAt: '2026-04-23T08:00:00.000Z',
          progress: { state: 'bogus', updatedAt: '2026-04-23T08:01:00.000Z' },
        },
        pending: null,
        lastFailure: null,
        lastSuccess: null,
      }),
      'utf-8',
    );

    await expect(readUpdateInstallState()).resolves.toEqual(emptyUpdateInstallState());
  });
});

describe('reconcileAbandonedInstall', () => {
  const now = new Date('2026-04-23T09:00:00.000Z');
  const fixedNowIso = now.toISOString();

  function doomedActiveInstall(): UpdateInstallState {
    return {
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: '2026-04-23T08:00:00.000Z',
        // Outside any plausible pid range: the owner is gone.
        pid: 999_999_999,
      },
      pending: null,
      lastFailure: null,
      lastSuccess: null,
    };
  }

  it('clears an abandoned active record and records the first failure attempt', async () => {
    const reconciled = await reconcileAbandonedInstall(doomedActiveInstall(), now);

    expect(reconciled).toEqual({
      active: null,
      pending: null,
      lastFailure: {
        version: '0.5.0',
        failedAt: fixedNowIso,
        attempts: 1,
        message: expect.any(String),
      },
      lastSuccess: null,
    });
    // The reconciled state is what the next launch reads.
    await expect(readUpdateInstallState()).resolves.toEqual(reconciled);
  });

  it('reaches the parking threshold after two abandoned installs of the same version', async () => {
    const first = await reconcileAbandonedInstall(doomedActiveInstall(), now);
    expect(first.lastFailure?.attempts).toBe(1);

    // The next launch records a fresh active record on top of the previous
    // failure, exactly like the background lifecycle does.
    const second = await reconcileAbandonedInstall(
      { ...doomedActiveInstall(), lastFailure: first.lastFailure },
      now,
    );
    expect(second.lastFailure?.attempts).toBe(2);
  });

  it('leaves an active record with a live installer pid exactly as it is', async () => {
    const state: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
        pid: process.pid,
      },
      pending: null,
      lastFailure: null,
      lastSuccess: null,
    };

    const reconciled = await reconcileAbandonedInstall(state);

    expect(reconciled).toBe(state);
    expect(existsSync(getUpdateInstallStateFile())).toBe(false);
  });

  it('leaves a state without an active record exactly as it is', async () => {
    const state = emptyUpdateInstallState();

    const reconciled = await reconcileAbandonedInstall(state, now);

    expect(reconciled).toBe(state);
    expect(existsSync(getUpdateInstallStateFile())).toBe(false);
  });

  it('starts a fresh failure counter when an abandoned prepare follows install failures', async () => {
    const state: UpdateInstallState = {
      active: {
        version: '0.5.0',
        source: 'homebrew',
        operation: 'prepare',
        startedAt: '2026-04-23T08:00:00.000Z',
        pid: 999_999_999,
      },
      pending: null,
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-04-22T08:00:00.000Z',
        attempts: 2,
        operation: 'install',
        message: 'npm exited with code 1',
      },
      lastSuccess: null,
    };

    const reconciled = await reconcileAbandonedInstall(state, now);

    expect(reconciled.lastFailure).toEqual({
      version: '0.5.0',
      failedAt: fixedNowIso,
      attempts: 1,
      operation: 'prepare',
      message: expect.any(String),
    });
  });

  it('leaves lastSuccess and pending untouched while reconciling', async () => {
    const lastSuccess: UpdateInstallSuccess = {
      version: '0.4.9',
      installedAt: '2026-04-21T08:00:00.000Z',
      notifiedAt: null,
    };
    const pending: UpdatePreparedHomebrew = {
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      source: 'homebrew',
      version: '0.6.0',
      preparedAt: '2026-04-22T08:00:00.000Z',
      requestedBy: 'automatic',
      formulaUrl: 'https://registry.example.com/pythinker-code-0.6.0.tgz',
      artifactKind: 'source',
      artifactSha256: 'a'.repeat(64),
      formulaFileSha256: 'b'.repeat(64),
      artifactPath: '/tmp/cache/pythinker-code-0.6.0.tgz',
    };
    const state: UpdateInstallState = {
      ...doomedActiveInstall(),
      pending,
      lastSuccess,
    };

    const reconciled = await reconcileAbandonedInstall(state, now);

    expect(reconciled.lastSuccess).toBe(lastSuccess);
    expect(reconciled.pending).toBe(pending);
  });

  it('returns the reconciled state even when persisting it fails', async () => {
    // Plant a file where the data directory would be created, so the state
    // write fails with ENOTDIR and startup must not break.
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'not a directory', 'utf-8');
    process.env['PYTHINKER_CODE_HOME'] = blocked;

    await expect(reconcileAbandonedInstall(doomedActiveInstall(), now)).resolves.toEqual({
      active: null,
      pending: null,
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        attempts: 1,
      }),
      lastSuccess: null,
    });
  });
});
