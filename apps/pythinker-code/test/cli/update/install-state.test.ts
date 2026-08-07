import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emptyUpdateInstallState,
  readUpdateInstallState,
  writeUpdateInstallState,
} from '#/cli/update/install-state';
import type { UpdateInstallState } from '#/cli/update/types';
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
