import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tryAcquireUpdateInstallLock } from '#/cli/update/install-lock';
import { getUpdateInstallLockFile } from '#/utils/paths';

const originalEnv = { ...process.env };

let dir: string;

function writeLock(contents: unknown): string {
  const filePath = getUpdateInstallLockFile();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(contents)}\n`, 'utf-8');
  return filePath;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pythinker-update-install-lock-'));
  process.env['PYTHINKER_CODE_HOME'] = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

describe('update install lock', () => {
  it('allows only one holder until the lock is released', async () => {
    const first = await tryAcquireUpdateInstallLock({ version: '0.5.0' });
    expect(first).not.toBeNull();
    expect(getUpdateInstallLockFile()).toBe(join(dir, 'updates', 'install.lock'));

    const second = await tryAcquireUpdateInstallLock({ version: '0.5.0' });
    expect(second).toBeNull();

    await first?.release();

    const third = await tryAcquireUpdateInstallLock({ version: '0.5.0' });
    expect(third).not.toBeNull();
    await third?.release();
  });

  it('does not reclaim an old lock while its owner process is alive', async () => {
    writeLock({
      version: '0.5.0',
      ownerId: 'live-owner',
      pid: process.pid,
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(tryAcquireUpdateInstallLock({
      version: '0.5.0',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })).resolves.toBeNull();
  });

  it('reclaims a lock whose owner process is no longer running', async () => {
    writeLock({
      version: '0.5.0',
      ownerId: 'dead-owner',
      pid: 999_999_999,
      startedAt: new Date().toISOString(),
    });

    const lock = await tryAcquireUpdateInstallLock({ version: '0.5.0' });

    expect(lock).not.toBeNull();
    await lock?.release();
  });

  it('does not let an old handle unlink a replacement owner', async () => {
    const old = await tryAcquireUpdateInstallLock({ version: '0.5.0' });
    expect(old).not.toBeNull();
    const filePath = getUpdateInstallLockFile();
    writeFileSync(filePath, `${JSON.stringify({
      version: '0.5.0',
      ownerId: 'replacement-owner',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })}\n`, 'utf-8');

    await old?.release();

    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toMatchObject({
      ownerId: 'replacement-owner',
    });
  });

  it('allows only one concurrent replacement of a stale lock', async () => {
    writeLock({
      version: '0.5.0',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const now = new Date('2026-08-03T00:00:00.000Z');

    const attempts = await Promise.all(Array.from({ length: 16 }, () =>
      tryAcquireUpdateInstallLock({ version: '0.5.0', now })));
    const holders = attempts.filter((lock) => lock !== null);

    expect(holders).toHaveLength(1);
    await holders[0]?.release();
  });

  it('recovers from a corrupt lock file', async () => {
    const filePath = getUpdateInstallLockFile();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, '{', 'utf-8');

    const lock = await tryAcquireUpdateInstallLock({ version: '0.5.0' });

    expect(lock).not.toBeNull();
    await lock?.release();
  });
});
