/**
 * One rule for "is this install lease still held", shared by the install lock
 * file and the active-install record.
 *
 * Both used to answer it with their own copy of `isProcessRunning` and their own
 * age arithmetic, and they drifted: a live pid used to hold either lease forever,
 * with no ceiling, so a recycled pid wedged every update path permanently.
 */

export interface LeaseRecord {
  /** Owner process id; absent in leases written before pids were recorded. */
  readonly pid?: number;
  readonly startedAt?: string;
}

export interface LeaseLimits {
  /** Ceiling on a lease whose owner pid is still alive. The OS reuses pids. */
  readonly pidCeilingMs: number;
  /** Ceiling on a lease with no recorded pid, where age is the only signal. */
  readonly pidlessTtlMs: number;
  /** A clock rollback within this tolerance must not orphan a live install. */
  readonly clockSkewMs: number;
}

/**
 * Liveness probe via `kill(pid, 0)`. EPERM means the process exists but is
 * owned by another user, which is still "running" for lease purposes.
 */
export function isProcessRunning(pid: number): boolean {
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

/**
 * A lease is held while its owner is alive *and* it is younger than the
 * ceiling. A lease with no usable timestamp can never age out, so it is never
 * fresh; a far-future timestamp is not fresh either.
 */
export function isLeaseFresh(record: LeaseRecord, limits: LeaseLimits, now: Date): boolean {
  const startedAt = record.startedAt === undefined ? Number.NaN : Date.parse(record.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  const age = now.getTime() - startedAt;
  if (age < -limits.clockSkewMs) return false;
  if (record.pid !== undefined) {
    return isProcessRunning(record.pid) && age < limits.pidCeilingMs;
  }
  return age < limits.pidlessTtlMs;
}
