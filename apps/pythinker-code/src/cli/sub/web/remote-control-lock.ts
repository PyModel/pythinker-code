import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface RemoteControlLockInfo {
  readonly pid: number;
  readonly nonce: string;
  readonly localOrigin: string;
  readonly deviceId: string;
  readonly url: string;
  readonly startedAt: number;
}

interface RemoteControlLockDisk {
  readonly pid: number;
  readonly nonce: string;
  readonly local_origin: string;
  readonly device_id: string;
  readonly url: string;
  readonly started_at: number;
}

export class RemoteControlAlreadyRunningError extends Error {
  readonly holder: RemoteControlLockInfo;

  constructor(holder: RemoteControlLockInfo) {
    super(formatRemoteControlAlreadyRunning(holder));
    this.name = 'RemoteControlAlreadyRunningError';
    this.holder = holder;
  }
}

export function formatRemoteControlAlreadyRunning(holder: RemoteControlLockInfo): string {
  return [
    `Remote Control is already running on this machine (pid ${holder.pid}, ${holder.localOrigin}, since ${new Date(holder.startedAt).toLocaleString()}).`,
    `Use the existing link: ${holder.url}`,
    'To start a new one here, stop the other `pythinker web --remote-control` process first.',
  ].join('\n');
}

export function remoteControlLockPath(homeDir: string): string {
  return join(homeDir, 'server', 'rc.json');
}

export interface RemoteControlLock {
  release(): Promise<void>;
}

const MAX_ACQUIRE_ATTEMPTS = 3;
const ACQUIRE_RETRY_DELAY_MS = 25;

export async function acquireRemoteControlLock(
  homeDir: string,
  details: { localOrigin: string; deviceId: string; url: string },
): Promise<RemoteControlLock> {
  const lockPath = remoteControlLockPath(homeDir);
  // The lock sits beside `server.token`; keep the same owner-only permissions.
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const info: RemoteControlLockInfo = {
    pid: process.pid,
    nonce: randomBytes(8).toString('hex'),
    localOrigin: details.localOrigin,
    deviceId: details.deviceId,
    url: details.url,
    startedAt: Date.now(),
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await handle.writeFile(encodeLock(info));
      } finally {
        await handle.close();
      }
      return { release: () => releaseRemoteControlLock(lockPath, info.nonce) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      // Read the holder even on the last attempt: a second process can recreate
      // the lock between our unlink and our open, and a raw EEXIST tells the
      // user nothing about who holds it or how to stop them.
      const holder = await readRemoteControlLock(lockPath);
      if (holder !== undefined && pidAlive(holder.pid)) {
        throw new RemoteControlAlreadyRunningError(holder);
      }
      // `open(…, 'wx')` publishes an empty file before its JSON is written, so
      // an unreadable lock may simply be a rival mid-write. Deleting it there
      // would let both processes believe they hold the lock. Give the writer a
      // moment and re-read; only sweep it once it is still unreadable at the
      // end, which is the genuinely corrupt case.
      if (holder === undefined && attempt < MAX_ACQUIRE_ATTEMPTS) {
        await sleep(ACQUIRE_RETRY_DELAY_MS);
        continue;
      }
      if (attempt >= MAX_ACQUIRE_ATTEMPTS) {
        throw new Error(
          `Unable to acquire the Remote Control lock at ${lockPath}. Another process keeps recreating it.`, { cause: error },
        );
      }
      await removeFile(lockPath);
    }
  }
}

export async function inspectRemoteControlLock(
  homeDir: string,
): Promise<RemoteControlLockInfo | undefined> {
  const lockPath = remoteControlLockPath(homeDir);
  const info = await readRemoteControlLock(lockPath);
  if (info === undefined) return undefined;
  if (!pidAlive(info.pid)) {
    await removeFile(lockPath);
    return undefined;
  }
  return info;
}

async function releaseRemoteControlLock(lockPath: string, nonce: string): Promise<void> {
  const info = await readRemoteControlLock(lockPath);
  if (info === undefined || info.nonce !== nonce) return;
  await removeFile(lockPath);
}

async function readRemoteControlLock(lockPath: string): Promise<RemoteControlLockInfo | undefined> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch {
    return undefined;
  }
  return decodeLock(raw);
}

function encodeLock(info: RemoteControlLockInfo): string {
  const disk: RemoteControlLockDisk = {
    pid: info.pid,
    nonce: info.nonce,
    local_origin: info.localOrigin,
    device_id: info.deviceId,
    url: info.url,
    started_at: info.startedAt,
  };
  return JSON.stringify(disk);
}

function decodeLock(raw: string): RemoteControlLockInfo | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<RemoteControlLockDisk>;
    if (
      typeof parsed.pid === 'number' &&
      // `process.kill(0, 0)` signals our own process group and reports "alive",
      // so a corrupt `"pid": 0` would pin the lock forever.
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.nonce === 'string' &&
      typeof parsed.local_origin === 'string' &&
      typeof parsed.device_id === 'string' &&
      typeof parsed.url === 'string' &&
      typeof parsed.started_at === 'number'
    ) {
      return {
        pid: parsed.pid,
        nonce: parsed.nonce,
        localOrigin: parsed.local_origin,
        deviceId: parsed.device_id,
        url: parsed.url,
        startedAt: parsed.started_at,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function removeFile(lockPath: string): Promise<void> {
  try {
    await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    return true;
  }
}
