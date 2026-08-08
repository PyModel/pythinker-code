import { z } from 'zod';

import { getUpdateInstallStateFile } from '#/utils/paths';
import { readJsonFile, writeJsonFile } from '#/utils/persistence';

import { isLeaseFresh, type LeaseLimits } from './lease';
import { emptyUpdateInstallState, type InstallSource, type UpdateInstallOperation, type UpdateInstallProgress, type UpdateInstallState, type UpdateTarget } from './types';

const ACTIVE_LEASE_LIMITS: LeaseLimits = {
  pidCeilingMs: 6 * 60 * 60 * 1000,
  pidlessTtlMs: 6 * 60 * 60 * 1000,
  clockSkewMs: 5 * 60 * 1000,
};

/**
 * Whether an install is still in flight. It lives here, next to the record it
 * reads, because both the preflight and the foreground upgrade command must
 * answer it the same way — a second copy of this predicate is how the
 * foreground paths came to ignore the lease at all.
 */
export function hasFreshActiveInstall(
  state: UpdateInstallState,
  now: Date = new Date(),
): boolean {
  const active = state.active;
  return active !== null && isLeaseFresh(active, ACTIVE_LEASE_LIMITS, now);
}

/**
 * The number of recorded failures for a target. Threshold gates omit
 * `operation`: any failure kind at the limit parks the version. Increment
 * sites pass their operation so a counter never resumes from another
 * operation's attempts. Legacy records without `operation` count toward any
 * operation.
 */
export function failureAttemptsFor(
  state: UpdateInstallState,
  target: UpdateTarget,
  operation?: UpdateInstallOperation,
): number {
  const failure = state.lastFailure;
  if (failure?.version !== target.version) return 0;
  if (
    operation !== undefined &&
    failure.operation !== undefined &&
    failure.operation !== operation
  ) {
    return 0;
  }
  return failure.attempts;
}

const ABANDONED_INSTALL_MESSAGE =
  'The background install was abandoned: the process that started it exited before recording an outcome.';

/**
 * One startup reconciliation for an install record whose owner never recorded
 * an outcome. The background installer's terminal state write lives in the
 * parent process, so when the parent dies the `active` record stays behind and
 * no failure is recorded; without this, a version that cannot succeed is
 * retried on every launch instead of being parked by the failure counter.
 *
 * A fresh record is a live lease and is left alone; an abandoned one is
 * cleared and recorded as one more failure for its version and operation, so
 * the existing threshold logic parks the version after enough of them.
 */
export async function reconcileAbandonedInstall(
  state: UpdateInstallState,
  now: Date = new Date(),
): Promise<UpdateInstallState> {
  const active = state.active;
  if (active === null || hasFreshActiveInstall(state, now)) return state;
  const reconciled: UpdateInstallState = {
    ...state,
    active: null,
    lastFailure: {
      version: active.version,
      failedAt: now.toISOString(),
      attempts: failureAttemptsFor(state, { version: active.version }, active.operation) + 1,
      operation: active.operation,
      message: ABANDONED_INSTALL_MESSAGE,
    },
  };
  await writeUpdateInstallState(reconciled).catch(() => {});
  return reconciled;
}

const InstallSourceSchema: z.ZodType<InstallSource> = z.enum([
  'npm-global',
  'pnpm-global',
  'yarn-global',
  'bun-global',
  'homebrew',
  'native',
  'unsupported',
]);

const UpdateInstallOperationSchema = z.enum(['install', 'prepare', 'activate']);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const UpdateInstallProgressSchema: z.ZodType<UpdateInstallProgress> = z
  .object({
    state: z.enum(['downloading', 'waiting', 'done', 'failed']),
    percent: z.number().int().min(0).max(100).optional(),
    transferred: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    updatedAt: z.string().min(1),
  })
  .strict();

const UpdateInstallStateSchema: z.ZodType<UpdateInstallState> = z
  .object({
    active: z
      .object({
        version: z.string().min(1),
        source: InstallSourceSchema,
        startedAt: z.string().min(1),
        pid: z.number().int().positive().optional(),
        operation: UpdateInstallOperationSchema.optional(),
        jobId: z.uuid().optional(),
        progress: UpdateInstallProgressSchema.optional(),
      })
      .strict()
      .nullable(),
    pending: z
      .object({
        jobId: z.uuid(),
        source: z.literal('homebrew'),
        version: z.string().min(1),
        preparedAt: z.string().min(1),
        requestedBy: z.enum(['automatic', 'manual']),
        formulaUrl: z.url(),
        artifactKind: z.literal('source'),
        artifactSha256: Sha256Schema,
        formulaFileSha256: Sha256Schema,
        artifactPath: z.string().min(1),
      })
      .strict()
      .nullable()
      .default(null),
    lastFailure: z
      .object({
        version: z.string().min(1),
        failedAt: z.string().min(1),
        attempts: z.number().int().min(1),
        operation: UpdateInstallOperationSchema.optional(),
        message: z.string().min(1).optional(),
      })
      .strict()
      .nullable(),
    lastSuccess: z
      .object({
        version: z.string().min(1),
        installedAt: z.string().min(1),
        notifiedAt: z.string().min(1).nullable(),
        unverified: z.string().min(1).optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export { emptyUpdateInstallState };

export async function readUpdateInstallState(
  filePath: string = getUpdateInstallStateFile(),
): Promise<UpdateInstallState> {
  try {
    return await readJsonFile(filePath, UpdateInstallStateSchema, emptyUpdateInstallState());
  } catch {
    return emptyUpdateInstallState();
  }
}

export async function writeUpdateInstallState(
  value: UpdateInstallState,
  filePath: string = getUpdateInstallStateFile(),
): Promise<void> {
  await writeJsonFile(filePath, UpdateInstallStateSchema, value, { durable: true });
}
