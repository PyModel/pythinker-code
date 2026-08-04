import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { getUpdateInstallLockFile } from '#/utils/paths';

const UPDATE_INSTALL_LOCK_STALE_MS = 30 * 60 * 1000;
const UPDATE_INSTALL_LOCK_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface UpdateInstallLockRequest {
  readonly version: string;
  readonly now?: Date;
}

export interface UpdateInstallLockHandle {
  readonly filePath: string;
  release(): Promise<void>;
}

interface LockSnapshot {
  readonly raw: string;
  readonly ownerId?: string;
  readonly pid?: number;
  readonly startedAt?: string;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT'
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST'
  );
}

/**
 * Liveness probe via `kill(pid, 0)`. EPERM means the process exists but is
 * owned by another user, which is still "running" for lock purposes.
 */
function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'EPERM';
  }
}

async function readLockSnapshot(filePath: string): Promise<LockSnapshot | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return { raw };
      const lock = parsed as {
        readonly ownerId?: unknown;
        readonly pid?: unknown;
        readonly startedAt?: unknown;
      };
      return {
        raw,
        ownerId: typeof lock.ownerId === 'string' ? lock.ownerId : undefined,
        pid: typeof lock.pid === 'number' ? lock.pid : undefined,
        startedAt: typeof lock.startedAt === 'string' ? lock.startedAt : undefined,
      };
    } catch (error) {
      if (error instanceof SyntaxError) return { raw };
      throw error;
    }
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * A recorded pid overrides timestamps: a live owner keeps the lock no
 * matter how old it is. PID-less (legacy) locks expire by age, with a
 * clock-skew tolerance so a small rollback cannot orphan a live install.
 */
function isStaleLock(snapshot: LockSnapshot, now: Date): boolean {
  if (snapshot.pid !== undefined) return !isProcessRunning(snapshot.pid);
  if (snapshot.startedAt === undefined) return true;
  const startedAt = Date.parse(snapshot.startedAt);
  if (!Number.isFinite(startedAt)) return true;
  const age = now.getTime() - startedAt;
  return age < -UPDATE_INSTALL_LOCK_CLOCK_SKEW_MS || age > UPDATE_INSTALL_LOCK_STALE_MS;
}

function hasSameOwner(current: LockSnapshot, expected: LockSnapshot): boolean {
  if (expected.ownerId !== undefined) return current.ownerId === expected.ownerId;
  return current.ownerId === undefined && current.raw === expected.raw;
}

/**
 * Remove the lock file only when its content still matches `expected`.
 * Between two concurrent reclaimers one of them may already have
 * replaced the file; deleting a replacement owner's lock would break
 * its lease, so mismatches are treated as "not ours".
 */
async function unlinkIfOwned(filePath: string, expected: LockSnapshot): Promise<boolean> {
  const current = await readLockSnapshot(filePath);
  if (current === null) return true;
  if (!hasSameOwner(current, expected)) return false;
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) return true;
    throw error;
  }
}

async function createLockFile(
  filePath: string,
  request: UpdateInstallLockRequest,
): Promise<UpdateInstallLockHandle> {
  const now = request.now ?? new Date();
  const ownerId = randomUUID();
  const stagedPath = `${filePath}.${ownerId}.tmp`;
  const file = await open(stagedPath, 'wx', 0o600);
  try {
    try {
      await file.writeFile(`${JSON.stringify({
        version: request.version,
        ownerId,
        pid: process.pid,
        startedAt: now.toISOString(),
      }, null, 2)}\n`, 'utf-8');
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish a fully-written record atomically. Creating the destination with
    // open('wx') and filling it afterward lets a concurrent reader mistake the
    // transient empty file for a stale lock and unlink a live owner's lease.
    await link(stagedPath, filePath);
  } finally {
    await unlink(stagedPath).catch(() => {});
  }

  let released = false;
  return {
    filePath,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      await unlinkIfOwned(filePath, { raw: '', ownerId });
    },
  };
}

export async function tryAcquireUpdateInstallLock(
  request: UpdateInstallLockRequest,
  filePath: string = getUpdateInstallLockFile(),
): Promise<UpdateInstallLockHandle | null> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    return await createLockFile(filePath, request);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const now = request.now ?? new Date();
  const existing = await readLockSnapshot(filePath);
  if (existing === null) {
    try {
      return await createLockFile(filePath, request);
    } catch (error) {
      if (isAlreadyExists(error)) return null;
      throw error;
    }
  }
  if (!isStaleLock(existing, now)) return null;

  // Reclaim via a sidecar lock: it serializes concurrent reclaimers so
  // exactly one of them gets to replace the stale lock file.
  const recoveryFilePath = `${filePath}.reclaim`;
  let recoveryLock: UpdateInstallLockHandle;
  try {
    recoveryLock = await createLockFile(recoveryFilePath, request);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const abandonedRecovery = await readLockSnapshot(recoveryFilePath);
    if (abandonedRecovery !== null && isStaleLock(abandonedRecovery, now)) {
      await unlinkIfOwned(recoveryFilePath, abandonedRecovery);
    }
    return null;
  }

  try {
    const current = await readLockSnapshot(filePath);
    if (current !== null) {
      if (!isStaleLock(current, now)) return null;
      if (!(await unlinkIfOwned(filePath, current))) return null;
    }
    try {
      return await createLockFile(filePath, request);
    } catch (error) {
      if (isAlreadyExists(error)) return null;
      throw error;
    }
  } finally {
    await recoveryLock.release().catch(() => {});
  }
}
