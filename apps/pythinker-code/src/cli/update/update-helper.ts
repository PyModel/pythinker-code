import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { valid } from 'semver';
import { z } from 'zod';

import { getUpdateInstallLogFile } from '#/utils/paths';

import { formatErrorMessage } from './format-error';
import { prepareHomebrewUpdate } from './homebrew';
import { readUpdateInstallState, writeUpdateInstallState } from './install-state';
import type { UpdateInstallActive, UpdateInstallState } from './types';

const UPDATE_INSTALL_LOG_MAX_BYTES = 1024 * 1024;

const PrepareHomebrewArgsSchema = z.tuple([
  z.literal('prepare-homebrew'),
  z.uuid(),
  z.string().refine((value) => valid(value) !== null, { error: 'invalid semver' }),
  z.enum(['automatic', 'manual']),
]);

async function rotateHelperLogIfNeeded(): Promise<void> {
  const filePath = getUpdateInstallLogFile();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const size = await stat(filePath).then((entry) => entry.size, () => 0);
    if (size >= UPDATE_INSTALL_LOG_MAX_BYTES) {
      await writeFile(filePath, '', { encoding: 'utf-8', mode: 0o600 });
    }
  } catch {
    // Diagnostics must not change the update outcome.
  }
}

async function appendHelperLog(message: string): Promise<void> {
  const filePath = getUpdateInstallLogFile();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await appendFile(filePath, line, { encoding: 'utf-8', mode: 0o600 });
  } catch {
    // Diagnostics must not change the update outcome.
  }
}

function prepareFailureAttempts(state: UpdateInstallState, version: string): number {
  const failure = state.lastFailure;
  return failure?.version === version && failure.operation === 'prepare' ? failure.attempts : 0;
}

function ownsPrepareJob(
  state: UpdateInstallState,
  jobId: string,
  requestedVersion: string,
): state is UpdateInstallState & { readonly active: UpdateInstallActive } {
  const active = state.active;
  return (
    active?.jobId === jobId &&
    active.operation === 'prepare' &&
    active.source === 'homebrew' &&
    active.version === requestedVersion
  );
}

export function dispatchUpdateHelperIfRequested(): boolean {
  if (process.env['PYTHINKER_CODE_UPDATE_HELPER'] !== '1') return false;
  const commandIndex = process.argv[2] === '__update_helper'
    ? 2
    : process.argv[1] === '__update_helper'
      ? 1
      : -1;
  if (commandIndex < 0) return false;
  void runUpdateHelper(process.argv.slice(commandIndex + 1))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Update helper failed: ${formatErrorMessage(error)}\n`);
      process.exitCode = 1;
    });
  return true;
}

export async function runUpdateHelper(args: readonly string[]): Promise<number> {
  const parsed = PrepareHomebrewArgsSchema.safeParse(args);
  if (!parsed.success) {
    await appendHelperLog('update helper rejected invalid arguments');
    return 2;
  }
  const [, jobId, requestedVersion, requestedBy] = parsed.data;
  await rotateHelperLogIfNeeded();
  let state = await readUpdateInstallState();
  if (!ownsPrepareJob(state, jobId, requestedVersion)) {
    await appendHelperLog(`prepare job ${jobId} is no longer active`);
    return 0;
  }

  try {
    state = {
      ...state,
      active: {
        ...state.active,
        pid: process.pid,
      },
    };
    await writeUpdateInstallState(state);
    await appendHelperLog(`prepare job ${jobId} started for ${requestedVersion}`);

    const prepared = await prepareHomebrewUpdate(
      { jobId, requestedVersion, requestedBy },
      { logFile: getUpdateInstallLogFile() },
    );
    const latest = await readUpdateInstallState();
    if (!ownsPrepareJob(latest, jobId, requestedVersion)) {
      await appendHelperLog(`prepare job ${jobId} lost ownership before completion`);
      return 0;
    }
    // Keep `lastFailure` so prepare attempts accumulate when a "successful"
    // preparation later turns out invalid at activation; a fully activated
    // update clears it in `activatePendingUpdate`.
    await writeUpdateInstallState({
      ...latest,
      active: null,
      pending: prepared,
    });
    await appendHelperLog(`prepare job ${jobId} verified ${prepared.version}`);
    return 0;
  } catch (error) {
    const latest = await readUpdateInstallState();
    if (!ownsPrepareJob(latest, jobId, requestedVersion)) return 1;
    const message = formatErrorMessage(error);
    await writeUpdateInstallState({
      ...latest,
      active: null,
      lastFailure: {
        version: requestedVersion,
        failedAt: new Date().toISOString(),
        attempts: prepareFailureAttempts(latest, requestedVersion) + 1,
        operation: 'prepare',
        message,
      },
    }).catch(() => {});
    await appendHelperLog(`prepare job ${jobId} failed: ${message}`);
    return 1;
  }
}
