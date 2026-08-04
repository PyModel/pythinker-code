import { gte, valid } from 'semver';

import { getUpdateInstallLogFile } from '#/utils/paths';

import {
  activateHomebrewUpdate,
  PreparedHomebrewUpdateInvalidError,
} from './homebrew';
import { tryAcquireUpdateInstallLock, type UpdateInstallLockHandle } from './install-lock';
import { readUpdateInstallState, writeUpdateInstallState } from './install-state';
import { detectInstallSource } from './source';
import type { InstallSource, UpdateInstallState, UpdatePreparedHomebrew } from './types';

const ACTIVATION_FAILURE_LIMIT = 2;

export interface ActivatePendingUpdateDeps {
  readonly readState: () => Promise<UpdateInstallState>;
  readonly writeState: (state: UpdateInstallState) => Promise<void>;
  readonly acquireLock: (
    request: { readonly version: string },
  ) => Promise<UpdateInstallLockHandle | null>;
  readonly activateHomebrew: (
    prepared: UpdatePreparedHomebrew,
  ) => Promise<{ readonly version: string; readonly executable: string }>;
  readonly detectSource: () => Promise<InstallSource>;
  readonly now: () => Date;
  readonly pid: number;
}

export interface ActivatePendingUpdateOptions {
  readonly enabled: boolean;
  readonly automaticEnabled: boolean;
  readonly deps?: Partial<ActivatePendingUpdateDeps>;
}

function resolveDeps(overrides: Partial<ActivatePendingUpdateDeps> = {}): ActivatePendingUpdateDeps {
  return {
    readState: overrides.readState ?? (() => readUpdateInstallState()),
    writeState: overrides.writeState ?? ((state) => writeUpdateInstallState(state)),
    acquireLock: overrides.acquireLock ?? ((request) => tryAcquireUpdateInstallLock(request)),
    activateHomebrew:
      overrides.activateHomebrew ??
      ((prepared) => activateHomebrewUpdate(prepared, { logFile: getUpdateInstallLogFile() })),
    detectSource: overrides.detectSource ?? (() => detectInstallSource()),
    now: overrides.now ?? (() => new Date()),
    pid: overrides.pid ?? process.pid,
  };
}

function activationAttempts(state: UpdateInstallState, version: string): number {
  const failure = state.lastFailure;
  return failure?.version === version && failure.operation === 'activate' ? failure.attempts : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRunningPreparedVersion(currentVersion: string, preparedVersion: string): boolean {
  return (
    valid(currentVersion) !== null &&
    valid(preparedVersion) !== null &&
    gte(currentVersion, preparedVersion)
  );
}

export async function activatePendingUpdate(
  currentVersion: string,
  options: ActivatePendingUpdateOptions,
) {
  if (!options.enabled) return { status: 'none' as const };
  const deps = resolveDeps(options.deps);
  let state = await deps.readState();
  const pending = state.pending;
  if (pending === null) return { status: 'none' as const };
  if (pending.requestedBy === 'automatic' && !options.automaticEnabled) {
    return { status: 'none' as const };
  }

  if (isRunningPreparedVersion(currentVersion, pending.version)) {
    const installedAt = deps.now().toISOString();
    await deps.writeState({
      active: null,
      pending: null,
      lastFailure: null,
      lastSuccess: {
        version: currentVersion,
        installedAt,
        notifiedAt: null,
      },
    });
    return { status: 'finalized' as const, version: currentVersion };
  }

  if (await deps.detectSource() !== pending.source) {
    await deps.writeState({ ...state, active: null, pending: null });
    return { status: 'invalidated' as const, version: pending.version };
  }

  if (activationAttempts(state, pending.version) >= ACTIVATION_FAILURE_LIMIT) {
    return {
      status: 'failed' as const,
      version: pending.version,
      message: `Automatic activation failed ${String(ACTIVATION_FAILURE_LIMIT)} times`,
    };
  }

  const lock = await deps.acquireLock({ version: pending.version });
  if (lock === null) return { status: 'in-progress' as const, version: pending.version };

  try {
    state = await deps.readState();
    if (state.pending?.jobId !== pending.jobId) return { status: 'none' as const };
    const startedAt = deps.now().toISOString();
    const activatingState: UpdateInstallState = {
      ...state,
      active: {
        version: pending.version,
        source: 'homebrew',
        operation: 'activate',
        jobId: pending.jobId,
        startedAt,
        pid: deps.pid,
      },
    };
    await deps.writeState(activatingState);

    try {
      const activated = await deps.activateHomebrew(pending);
      return {
        status: 'activated' as const,
        version: activated.version,
        executable: activated.executable,
      };
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof PreparedHomebrewUpdateInvalidError) {
        await deps.writeState({
          ...activatingState,
          active: null,
          pending: null,
          lastFailure: {
            version: pending.version,
            failedAt: deps.now().toISOString(),
            attempts: 1,
            operation: 'prepare',
            message,
          },
        });
        return { status: 'invalidated' as const, version: pending.version };
      }
      const attempts = activationAttempts(activatingState, pending.version) + 1;
      await deps.writeState({
        ...activatingState,
        active: null,
        lastFailure: {
          version: pending.version,
          failedAt: deps.now().toISOString(),
          attempts,
          operation: 'activate',
          message,
        },
      });
      return { status: 'failed' as const, version: pending.version, message };
    }
  } finally {
    await lock.release().catch(() => {});
  }
}
