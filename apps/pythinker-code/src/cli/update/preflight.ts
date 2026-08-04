import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import { gte, valid } from 'semver';

import { log, type Logger } from '@pythoughts/pythinker-code-sdk';
import type { TelemetryProperties } from '@pythoughts/pythinker-telemetry';

import {
  NATIVE_INSTALL_COMMAND_UNIX,
  NATIVE_INSTALL_COMMAND_WIN,
} from '#/constant/app';
import { loadTuiConfig } from '#/tui/config';

import { readUpdateCache } from './cache';
import { formatErrorMessage } from './format-error';
import { tryAcquireUpdateInstallLock } from './install-lock';
import { emptyUpdateInstallState, readUpdateInstallState, writeUpdateInstallState } from './install-state';
import {
  CHANGELOG_URL,
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from './prompt';
import { refreshUpdateCache } from './refresh';
import { selectUpdateTarget } from './select';
import {
  appendRolloutDecisionLog,
  decidePassiveUpdateTarget,
  isRolloutBypassedByExperimentalEnv,
  resolveUpdateDeviceId,
  rolloutBucket,
  rolloutDelayForBucket,
  type PassiveUpdateDecision,
} from './rollout';
import { detectInstallSource } from './source';
import {
  NPM_PACKAGE_NAME,
  type InstallSource,
  type UpdateDecision,
  type UpdateInstallOperation,
  type UpdateInstallState,
  type UpdateCache,
  type UpdateManifest,
  type UpdatePreflightResult,
  type UpdateRequestOrigin,
  type UpdateTarget,
} from './types';

export type { UpdatePreflightResult } from './types';

export interface RunUpdatePreflightOptions {
  readonly stdout?: { write(chunk: string): boolean };
  readonly stderr?: { write(chunk: string): boolean };
  readonly isTTY?: boolean;
  readonly track?: (event: string, properties?: TelemetryProperties) => void;
  readonly logger?: UpdateLogger;
}

const AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD = 2;
const AUTO_INSTALL_ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const AUTO_INSTALL_ACTIVE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS = 1_000;
const UPDATE_HELPER_ENV = 'PYTHINKER_CODE_UPDATE_HELPER';

type UpdateLogger = Pick<Logger, 'info' | 'warn'>;

function withCmdSuffix(base: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.cmd` : base;
}

function bunCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

export function installCommandFor(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): string {
  switch (source) {
    case 'npm-global':
      return `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'pnpm-global':
      return `pnpm add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'yarn-global':
      return `yarn global add ${NPM_PACKAGE_NAME}@${version}`;
    case 'bun-global':
      return `bun add -g ${NPM_PACKAGE_NAME}@${version}`;
    case 'homebrew':
      return 'brew upgrade pythinker-code';
    case 'native':
      return platform === 'win32' ? NATIVE_INSTALL_COMMAND_WIN : NATIVE_INSTALL_COMMAND_UNIX;
    case 'unsupported':
      return `npm install -g ${NPM_PACKAGE_NAME}@${version}`;
  }
}

export type AutomaticUpdateMode = 'background-install' | 'restart-install' | 'manual';

export function canAutoInstall(source: InstallSource, _platform: NodeJS.Platform): boolean {
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      return true;
    case 'homebrew':
      // Foreground installUpdate() never owns Homebrew. Passive and explicit
      // TUI updates use the separate prepare-on-restart lifecycle instead.
      return false;
    case 'native':
      return true;
    case 'unsupported':
      return false;
  }
}

export function automaticUpdateModeFor(
  source: InstallSource,
  platform: NodeJS.Platform,
): AutomaticUpdateMode {
  if (source === 'homebrew') return 'restart-install';
  return canAutoInstall(source, platform) ? 'background-install' : 'manual';
}

interface SpawnCommand {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export function spawnForSource(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): SpawnCommand {
  switch (source) {
    case 'npm-global':
      return { cmd: withCmdSuffix('npm', platform), args: ['install', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'pnpm-global':
      return { cmd: withCmdSuffix('pnpm', platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'yarn-global':
      return { cmd: withCmdSuffix('yarn', platform), args: ['global', 'add', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'bun-global':
      return { cmd: bunCommand(platform), args: ['add', '-g', `${NPM_PACKAGE_NAME}@${version}`] };
    case 'homebrew':
      return { cmd: 'brew', args: ['upgrade', 'pythinker-code'] };
    case 'native':
      if (platform === 'win32') {
        // install.ps1 reads $env:PYTHINKER_VERSION when set instead of
        // fetching the CDN's current latest, so the version this preflight
        // decided on is the one actually installed.
        return {
          cmd: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', NATIVE_INSTALL_COMMAND_WIN],
          env: { PYTHINKER_VERSION: version },
        };
      }
      // `curl … | bash` reports only the trailing bash's exit status, so a
      // failed download (curl can't connect → empty stdin → bash exits 0)
      // would look like a successful update. `pipefail` makes the pipeline
      // surface curl's non-zero status so installUpdate() rejects and we warn
      // instead of printing "Updated …".
      return { cmd: 'bash', args: ['-c', `set -o pipefail; ${NATIVE_INSTALL_COMMAND_UNIX}`] };
    case 'unsupported':
      throw new Error('unsupported install source cannot be auto-installed');
  }
}

export function renderManualUpdateMessage(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): string {
  let sourceDesc: string;
  switch (source) {
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global':
      sourceDesc = source;
      break;
    case 'homebrew':
      sourceDesc = 'homebrew';
      break;
    case 'native':
      sourceDesc = 'native install.';
      break;
    case 'unsupported':
      sourceDesc = 'unsupported package manager or layout.';
      break;
  }
  const homebrewHint =
    source === 'homebrew'
      ? 'Automatic Homebrew preparation is disabled or could not complete.\n'
      : '';
  return (
    `A newer version of ${NPM_PACKAGE_NAME} is available ` +
    `(${currentVersion} -> ${target.version}).\n` +
    `Detected install source: ${sourceDesc}\n` +
    `To update manually, run: ${installCommand}\n` +
    homebrewHint
  );
}

export function renderInstallSuccessMessage(target: UpdateTarget): string {
  return `Updated ${NPM_PACKAGE_NAME} to ${target.version}. Restart the CLI to use the new version.\n`;
}

function renderBackgroundInstallSuccessNotice(version: string): string {
  const displayVersion = version.startsWith('v') ? version : `v${version}`;
  return `Pythinker Code updated to ${displayVersion}\nChangelog: ${CHANGELOG_URL}\n`;
}

function refreshInBackground(): void {
  void refreshUpdateCache().catch(() => {});
}

/** Telemetry properties describing where this device sits in the rollout. */
interface RolloutTelemetry {
  readonly rollout_bucket: number;
  readonly rollout_delay_seconds: number;
  readonly rollout_from_manifest: boolean;
  readonly rollout_bypassed: boolean;
}

function rolloutTelemetryFor(
  deviceId: string,
  targetVersion: string,
  manifest: UpdateManifest | null,
  bypassRollout: boolean,
): RolloutTelemetry {
  const bucket = rolloutBucket(deviceId, targetVersion);
  return {
    rollout_bucket: bucket,
    rollout_delay_seconds:
      manifest === null || bypassRollout ? 0 : rolloutDelayForBucket(manifest.rollout, bucket),
    rollout_from_manifest: manifest !== null,
    rollout_bypassed: bypassRollout,
  };
}

type RolloutCheckPhase = 'startup-cache' | 'background-refresh' | 'prompt-refresh';

/** Record which case a passive version check hit in `updates/rollout.log`. */
function logRolloutDecision(
  phase: RolloutCheckPhase,
  currentVersion: string,
  latest: string | null,
  manifest: UpdateManifest | null,
  decision: PassiveUpdateDecision,
): void {
  void appendRolloutDecisionLog({
    ts: nowIso(),
    phase,
    reason: decision.reason,
    current: currentVersion,
    latest,
    target: decision.target?.version ?? null,
    manifestPresent: manifest !== null,
    publishedAt: manifest?.publishedAt ?? null,
    bucket: decision.bucket,
    delaySeconds: decision.delaySeconds,
    eligibleAt: decision.eligibleAt,
  });
}

function refreshAndMaybeInstallInBackground(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  isInteractive: boolean,
  installState: UpdateInstallState,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
): void {
  void (async () => {
    const refreshed = await refreshUpdateCache();
    if (!isInteractive) return;
    const decision = decidePassiveUpdateTarget(
      currentVersion,
      refreshed.latest,
      refreshed.manifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('background-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
    const target = decision.target;
    if (target === null) return;
    const source = await detectInstallSource().catch(() => 'unsupported' as const);
    await tryStartAutomaticBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetryFor(deviceId, target.version, refreshed.manifest, bypassRollout),
    );
  })().catch(() => {});
}

interface UserVisibleUpdateTarget {
  readonly target: UpdateTarget | null;
  readonly manifest: UpdateManifest | null;
}

async function refreshUserVisibleUpdateTarget(
  currentVersion: string,
  deviceId: string,
  bypassRollout: boolean,
  fallbackTarget: UpdateTarget,
  fallbackManifest: UpdateManifest | null,
): Promise<UserVisibleUpdateTarget> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fallback: UserVisibleUpdateTarget = {
    target: fallbackTarget,
    manifest: fallbackManifest,
  };
  try {
    const refresh = refreshUpdateCache()
      .then((refreshed) => {
        const decision = decidePassiveUpdateTarget(
          currentVersion,
          refreshed.latest,
          refreshed.manifest,
          deviceId,
          new Date(),
          bypassRollout,
        );
        logRolloutDecision('prompt-refresh', currentVersion, refreshed.latest, refreshed.manifest, decision);
        return {
          target: decision.target,
          manifest: refreshed.manifest,
        };
      })
      .catch(() => fallback);
    const timeoutFallback = new Promise<UserVisibleUpdateTarget>((resolve) => {
      timeout = setTimeout(() => {
        resolve(fallback);
      }, USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS);
    });
    return await Promise.race([refresh, timeoutFallback]);
  } catch {
    return fallback;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function failureAttemptsFor(
  state: UpdateInstallState,
  target: UpdateTarget,
  operation?: UpdateInstallOperation,
): number {
  const failure = state.lastFailure;
  if (failure?.version !== target.version) return 0;
  // Threshold gates omit `operation`: any failure kind at the limit parks the
  // version. Increment sites pass their operation so a counter never resumes
  // from another operation's attempts. Legacy records without `operation`
  // count toward any operation.
  if (
    operation !== undefined &&
    failure.operation !== undefined &&
    failure.operation !== operation
  ) {
    return 0;
  }
  return failure.attempts;
}

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

/**
 * An active record still counts as a lease when the recorded installer
 * pid is alive (liveness beats the TTL), or — for legacy pid-less
 * records — when its timestamp is within the TTL (with clock-skew
 * tolerance). Far-future timestamps never count as fresh.
 */
function hasFreshActiveInstall(state: UpdateInstallState): boolean {
  const active = state.active;
  if (active === null) return false;
  const startedAt = Date.parse(active.startedAt);
  if (!Number.isFinite(startedAt)) return false;
  const age = Date.now() - startedAt;
  if (age < -AUTO_INSTALL_ACTIVE_CLOCK_SKEW_MS) return false;
  if (active.pid !== undefined) return isProcessRunning(active.pid);
  return age < AUTO_INSTALL_ACTIVE_TTL_MS;
}

async function showPendingBackgroundInstallNotice(
  state: UpdateInstallState,
  currentVersion: string,
  stdout: { write(chunk: string): boolean },
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
): Promise<UpdateInstallState> {
  const success = state.lastSuccess;
  if (success !== null && success.notifiedAt === null && success.version === currentVersion) {
    stdout.write(renderBackgroundInstallSuccessNotice(success.version));
    trackUpdateEvent(track, 'update_success_notice_shown', {
      version: success.version,
      inferred_from_active: false,
    });
    logUpdateInfo(logger, 'background update success notice shown', {
      version: success.version,
      inferredFromActive: false,
    });
    const nextState: UpdateInstallState = {
      ...state,
      lastFailure: null,
      lastSuccess: {
        ...success,
        notifiedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(nextState).catch(() => {});
    return nextState;
  }

  const active = state.active;
  if (
    active === null ||
    active.version !== currentVersion ||
    hasFreshActiveInstall(state)
  ) return state;
  if (success !== null && success.version === currentVersion && success.notifiedAt !== null) {
    return state;
  }

  const notifiedAt = nowIso();
  stdout.write(renderBackgroundInstallSuccessNotice(active.version));
  trackUpdateEvent(track, 'update_success_notice_shown', {
    version: active.version,
    inferred_from_active: true,
  });
  logUpdateInfo(logger, 'background update success notice shown', {
    version: active.version,
    inferredFromActive: true,
  });
  const nextState: UpdateInstallState = {
    ...state,
    active: null,
    lastFailure: null,
    lastSuccess: {
      version: active.version,
      installedAt: notifiedAt,
      notifiedAt,
    },
  };
  await writeUpdateInstallState(nextState).catch(() => {});
  return nextState;
}

/**
 * `PYTHINKER_CODE_NO_AUTO_UPDATE` (or the legacy `PYTHINKER_CLI_NO_AUTO_UPDATE` alias)
 * fully disables the update preflight — no check, no background install, no
 * prompt. Migrated from pythinker-cli, where the variable gated all auto-update
 * behavior. Accepts the usual truthy values (`1`/`true`/`yes`/`on`).
 */
export function isAutoUpdateDisabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const truthy = (value?: string): boolean =>
    ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
  return truthy(env['PYTHINKER_CODE_NO_AUTO_UPDATE']) || truthy(env['PYTHINKER_CLI_NO_AUTO_UPDATE']);
}

export async function shouldAutoInstallUpdates(): Promise<boolean> {
  try {
    const config = await loadTuiConfig();
    return config.upgrade.autoInstall;
  } catch {
    return true;
  }
}

function trackUpdatePrompted(
  track: RunUpdatePreflightOptions['track'],
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  decision: UpdateDecision,
  rolloutTelemetry: RolloutTelemetry,
): void {
  trackUpdateEvent(track, 'update_prompted', {
    current: currentVersion,
    latest: target.version,
    current_version: currentVersion,
    target_version: target.version,
    source,
    decision,
    ...rolloutTelemetry,
  });
}

function trackUpdateEvent(
  track: RunUpdatePreflightOptions['track'],
  event: string,
  properties: TelemetryProperties,
): void {
  try {
    track?.(event, properties);
  } catch {
    // Telemetry must never affect update prompting.
  }
}

function logUpdateInfo(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.info(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}

function logUpdateWarn(logger: UpdateLogger, message: string, payload: Record<string, unknown>): void {
  try {
    logger.warn(message, payload);
  } catch {
    // Diagnostic logging must never affect update prompting.
  }
}

async function promptInstall(
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  installCommand: string,
): Promise<InstallPromptChoiceValue> {
  const options: InstallPromptOptions = {
    currentVersion,
    target,
    installSource: source,
    installCommand,
  };
  return promptForInstallChoice(options);
}

export async function installUpdate(
  source: InstallSource,
  version: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const { cmd, args, env } = spawnForSource(source, version, platform);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      stdio: 'inherit',
      env: env === undefined ? undefined : { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal !== null ? `signal ${signal}` : `code ${String(code)}`;
      reject(new Error(`${cmd} exited with ${detail}`));
    });
  });
}

async function waitForChildSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      child.on('error', () => {});
      resolve();
    };
    const onError = (error: Error): void => {
      child.off('spawn', onSpawn);
      reject(error);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function updateHelperCommand(
  operation: 'prepare-homebrew',
  jobId: string,
  version: string,
  requestedBy: UpdateRequestOrigin,
): SpawnCommand {
  const launcherPath = process.argv[1];
  if (launcherPath === undefined) throw new Error('cannot locate the Pythinker Code launcher');
  return {
    cmd: process.execPath,
    args: [launcherPath, '__update_helper', operation, jobId, version, requestedBy],
  };
}

function preparedVersionCoversTarget(preparedVersion: string, targetVersion: string): boolean {
  return valid(preparedVersion) !== null && valid(targetVersion) !== null && gte(preparedVersion, targetVersion);
}

async function startBackgroundHomebrewPreparation(
  state: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  requestedBy: UpdateRequestOrigin,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<boolean> {
  const lock = await tryAcquireUpdateInstallLock({ version: target.version });
  if (lock === null) return false;

  try {
    const freshState = await readUpdateInstallState().catch(() => state);
    if (
      hasFreshActiveInstall(freshState) ||
      (freshState.pending !== null && preparedVersionCoversTarget(freshState.pending.version, target.version)) ||
      failureAttemptsFor(freshState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
    ) {
      return false;
    }

    const jobId = randomUUID();
    // A retained older verified `pending` stays installable if this newer
    // preparation fails; the helper's success path replaces it.
    const startedState: UpdateInstallState = {
      ...freshState,
      active: {
        version: target.version,
        source: 'homebrew',
        operation: 'prepare',
        jobId,
        startedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(startedState);

    try {
      const { cmd, args } = updateHelperCommand(
        'prepare-homebrew',
        jobId,
        target.version,
        requestedBy,
      );
      const child = spawn(cmd, [...args], {
        cwd: homedir(),
        detached: true,
        env: { ...process.env, [UPDATE_HELPER_ENV]: '1' },
        stdio: 'ignore',
      });
      await waitForChildSpawn(child);
      child.unref();
    } catch (error) {
      const attempts = failureAttemptsFor(startedState, target, 'prepare') + 1;
      await writeUpdateInstallState({
        ...startedState,
        active: null,
        lastFailure: {
          version: target.version,
          failedAt: nowIso(),
          attempts,
          operation: 'prepare',
          message: formatErrorMessage(error),
        },
      }).catch(() => {});
      throw error;
    }

    trackUpdateEvent(track, 'update_background_prepare_started', {
      current_version: currentVersion,
      target_version: target.version,
      source: 'homebrew',
      ...rolloutTelemetry,
    });
    logUpdateInfo(logger, 'background update preparation started', {
      currentVersion,
      targetVersion: target.version,
      source: 'homebrew',
      jobId,
    });
    return true;
  } finally {
    await lock.release().catch(() => {});
  }
}

async function startBackgroundInstall(
  state: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<boolean> {
  const lock = await tryAcquireUpdateInstallLock({ version: target.version });
  if (lock === null) return false;

  let finalizerOwnsLock = false;
  try {
    const freshState = await readUpdateInstallState().catch(() => state);
    if (
      hasFreshActiveInstall(freshState) ||
      failureAttemptsFor(freshState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
    ) {
      return false;
    }

    let startedState: UpdateInstallState = {
      ...freshState,
      active: {
        version: target.version,
        source,
        startedAt: nowIso(),
      },
    };
    await writeUpdateInstallState(startedState);
    trackUpdateEvent(track, 'update_background_install_started', {
      current_version: currentVersion,
      target_version: target.version,
      source,
      ...rolloutTelemetry,
    });
    logUpdateInfo(logger, 'background update install started', {
      currentVersion,
      targetVersion: target.version,
      source,
    });

    const { cmd, args, env } = spawnForSource(source, target.version, platform);
    // The child can exit before the pid-persist below finishes, so buffer
    // the terminal outcome until the handler is "ready".
    let ready = false;
    let settled = false;
    let pendingOutcome: boolean | undefined;

    const finish = async (succeeded: boolean): Promise<void> => {
      if (!ready) {
        pendingOutcome ??= succeeded;
        return;
      }
      if (settled) return;
      settled = true;
      const attempts = failureAttemptsFor(startedState, target, 'install') + 1;

      const nextState: UpdateInstallState = succeeded
        ? {
          ...startedState,
          active: null,
          lastFailure: null,
          lastSuccess: {
            version: target.version,
            installedAt: nowIso(),
            notifiedAt: null,
          },
        }
        : {
          ...startedState,
          active: null,
          lastFailure: {
            version: target.version,
            failedAt: nowIso(),
            attempts,
            operation: 'install',
          },
        };
      try {
        await writeUpdateInstallState(nextState).catch(() => {});
        if (succeeded) {
          trackUpdateEvent(track, 'update_background_install_succeeded', {
            target_version: target.version,
            source,
          });
          logUpdateInfo(logger, 'background update install succeeded', {
            targetVersion: target.version,
            source,
          });
          return;
        }
        trackUpdateEvent(track, 'update_background_install_failed', {
          target_version: target.version,
          source,
          attempts,
        });
        logUpdateWarn(logger, 'background update install failed', {
          targetVersion: target.version,
          source,
          attempts,
        });
      } finally {
        await lock.release().catch(() => {});
      }
    };

    const child = spawn(cmd, [...args], {
      detached: true,
      stdio: 'ignore',
      env: env === undefined ? undefined : { ...process.env, ...env },
    });
    child.once('error', () => { void finish(false); });
    child.once('exit', (code) => { void finish(code === 0); });
    if (child.pid !== undefined && child.pid > 0) {
      const stateWithPid: UpdateInstallState = {
        ...startedState,
        active: startedState.active === null
          ? null
          : { ...startedState.active, pid: child.pid },
      };
      try {
        await writeUpdateInstallState(stateWithPid);
        startedState = stateWithPid;
      } catch {
        // The pre-spawn state remains a conservative lease and eventually
        // expires even when persisting the child pid fails.
      }
    }
    // From here on the finalizer owns the lock and releases it only after
    // the terminal state write settles, so a concurrent preflight cannot
    // start a second install for the same target mid-finalize.
    child.unref();
    finalizerOwnsLock = true;
    ready = true;
    if (pendingOutcome !== undefined) void finish(pendingOutcome);
    return true;
  // When startup failed before handoff, release the lock here; the
  // finalizer releases it once the terminal state write completes.
  } finally {
    if (!finalizerOwnsLock) {
      await lock.release().catch(() => {});
    }
  }
}

async function tryStartAutomaticBackgroundInstall(
  installState: UpdateInstallState,
  currentVersion: string,
  target: UpdateTarget,
  source: InstallSource,
  platform: NodeJS.Platform,
  track: RunUpdatePreflightOptions['track'],
  logger: UpdateLogger,
  rolloutTelemetry: RolloutTelemetry,
): Promise<boolean> {
  const autoInstallUpdates = await shouldAutoInstallUpdates();
  if (!autoInstallUpdates) return false;
  if (failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
    return false;
  }
  if (hasFreshActiveInstall(installState)) return true;

  if (source === 'homebrew') {
    if (
      installState.pending !== null &&
      preparedVersionCoversTarget(installState.pending.version, target.version)
    ) return true;
    try {
      await startBackgroundHomebrewPreparation(
        installState,
        currentVersion,
        target,
        'automatic',
        track,
        logger,
        rolloutTelemetry,
      );
      return true;
    } catch (error) {
      logUpdateWarn(logger, 'background update preparation could not start', {
        targetVersion: target.version,
        source,
        error: formatErrorMessage(error),
      });
      return false;
    }
  }

  if (!canAutoInstall(source, platform)) return false;
  try {
    await startBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      track,
      logger,
      rolloutTelemetry,
    );
    return true;
  } catch (error) {
    logUpdateWarn(logger, 'background update install could not start', {
      targetVersion: target.version,
      source,
      error: formatErrorMessage(error),
    });
    return false;
  }
}

export type ManualUpdateResult =
  | { readonly status: 'up-to-date' }
  | { readonly status: 'check-failed'; readonly message: string }
  | { readonly status: 'started'; readonly version: string; readonly installOnRestart: boolean }
  | {
    readonly status: 'in-progress';
    readonly version: string;
    readonly installOnRestart: boolean;
    readonly readyToInstall: boolean;
  }
  | {
    readonly status: 'manual';
    readonly version: string;
    readonly command: string;
    readonly source: InstallSource;
  };

/**
 * Explicit user-requested update (TUI `/update`). Unlike the passive
 * preflight it ignores the rollout delay and the `auto_install` preference —
 * the user asked, so we install or prepare the Homebrew update — while reusing
 * the background lifecycle, lock, and failure bookkeeping. The env kill-switch is also ignored:
 * it gates automatic behavior, not explicit requests (matching `pythinker upgrade`).
 */
export async function startManualUpdate(
  currentVersion: string,
  logger: UpdateLogger = log,
): Promise<ManualUpdateResult> {
  let cache: UpdateCache;
  try {
    cache = await refreshUpdateCache();
  } catch (error) {
    return { status: 'check-failed', message: formatErrorMessage(error) };
  }
  const target = selectUpdateTarget(currentVersion, cache.latest);
  if (target === null) return { status: 'up-to-date' };

  const platform = process.platform;
  const source = await detectInstallSource().catch(() => 'unsupported' as const);
  const installState = await readUpdateInstallState().catch(() => emptyUpdateInstallState());
  if (hasFreshActiveInstall(installState)) {
    return {
      status: 'in-progress',
      version: installState.active?.version ?? target.version,
      installOnRestart: installState.active?.source === 'homebrew',
      readyToInstall: false,
    };
  }
  if (
    source === 'homebrew' &&
    installState.pending !== null &&
    preparedVersionCoversTarget(installState.pending.version, target.version)
  ) {
    const pending = installState.pending;
    if (pending.requestedBy === 'automatic') {
      try {
        await writeUpdateInstallState({
          ...installState,
          pending: { ...pending, requestedBy: 'manual' },
        });
      } catch (error) {
        return { status: 'check-failed', message: formatErrorMessage(error) };
      }
    }
    return {
      status: 'in-progress',
      version: pending.version,
      installOnRestart: true,
      readyToInstall: true,
    };
  }
  // Repeated background failures fall back to the copyable command instead of
  // claiming "started" for work the background lifecycle would refuse.
  if (failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD) {
    return {
      status: 'manual',
      version: target.version,
      command: installCommandFor(source, target.version, platform),
      source,
    };
  }

  try {
    const rolloutTelemetry = rolloutTelemetryFor(
      resolveUpdateDeviceId(),
      target.version,
      cache.manifest,
      true,
    );
    if (source === 'homebrew') {
      const started = await startBackgroundHomebrewPreparation(
        installState,
        currentVersion,
        target,
        'manual',
        undefined,
        logger,
        rolloutTelemetry,
      );
      // Another process holds the lock or the under-lock re-check refused:
      // nothing new was started, so don't claim it was.
      if (!started) {
        return {
          status: 'in-progress',
          version: target.version,
          installOnRestart: true,
          readyToInstall: false,
        };
      }
      return { status: 'started', version: target.version, installOnRestart: true };
    }
    if (!canAutoInstall(source, platform)) {
      return {
        status: 'manual',
        version: target.version,
        command: installCommandFor(source, target.version, platform),
        source,
      };
    }
    const started = await startBackgroundInstall(
      installState,
      currentVersion,
      target,
      source,
      platform,
      undefined,
      logger,
      rolloutTelemetry,
    );
    if (!started) {
      return {
        status: 'in-progress',
        version: target.version,
        installOnRestart: false,
        readyToInstall: false,
      };
    }
    return { status: 'started', version: target.version, installOnRestart: false };
  } catch (error) {
    return { status: 'check-failed', message: formatErrorMessage(error) };
  }
}

export function decideUpdateAction(
  target: UpdateTarget | null,
  isInteractive: boolean,
  source: InstallSource,
  platform: NodeJS.Platform,
): UpdateDecision {
  if (target === null || !isInteractive) return 'none';
  return canAutoInstall(source, platform) ? 'prompt-install' : 'manual-command';
}

export async function runUpdatePreflight(
  currentVersion: string,
  options: RunUpdatePreflightOptions = {},
): Promise<UpdatePreflightResult> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const logger = options.logger ?? log;
  const platform = process.platform;

  if (isAutoUpdateDisabledByEnv()) {
    return 'continue';
  }

  try {
    const isInteractive =
      options.isTTY ?? (process.stdin.isTTY && process.stdout.isTTY);
    const deviceId = resolveUpdateDeviceId();
    const bypassRollout = isRolloutBypassedByExperimentalEnv();
    let installState = await readUpdateInstallState().catch(() => emptyUpdateInstallState());
    if (isInteractive) {
      installState = await showPendingBackgroundInstallNotice(
        installState,
        currentVersion,
        stdout,
        options.track,
        logger,
      );
    }

    const cache = await readUpdateCache().catch(() => null);
    const cachedManifest = cache?.manifest ?? null;
    const cachedDecision = decidePassiveUpdateTarget(
      currentVersion,
      cache?.latest ?? null,
      cachedManifest,
      deviceId,
      new Date(),
      bypassRollout,
    );
    logRolloutDecision('startup-cache', currentVersion, cache?.latest ?? null, cachedManifest, cachedDecision);
    const target = cachedDecision.target;
    if (target === null) {
      refreshAndMaybeInstallInBackground(
        currentVersion,
        deviceId,
        bypassRollout,
        isInteractive,
        installState,
        platform,
        options.track,
        logger,
      );
      return 'continue';
    }

    const source: InstallSource =
      !isInteractive
        ? 'unsupported'
        : await detectInstallSource().catch(() => 'unsupported' as const);

    const decision = decideUpdateAction(target, isInteractive, source, platform);
    if (decision === 'none') {
      refreshInBackground();
      return 'continue';
    }

    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        target,
        source,
        platform,
        options.track,
        logger,
        rolloutTelemetryFor(deviceId, target.version, cachedManifest, bypassRollout),
      )
    ) {
      refreshInBackground();
      return 'continue';
    }

    const userVisibleUpdate = await refreshUserVisibleUpdateTarget(
      currentVersion,
      deviceId,
      bypassRollout,
      target,
      cachedManifest,
    );
    const userVisibleTarget = userVisibleUpdate.target;
    if (userVisibleTarget === null) return 'continue';
    const userVisibleRollout = rolloutTelemetryFor(
      deviceId,
      userVisibleTarget.version,
      userVisibleUpdate.manifest,
      bypassRollout,
    );
    if (
      await tryStartAutomaticBackgroundInstall(
        installState,
        currentVersion,
        userVisibleTarget,
        source,
        platform,
        options.track,
        logger,
        userVisibleRollout,
      )
    ) {
      return 'continue';
    }

    const installCommand = installCommandFor(source, userVisibleTarget.version, platform);
    trackUpdatePrompted(options.track, currentVersion, userVisibleTarget, source, decision, userVisibleRollout);

    if (decision === 'manual-command') {
      stdout.write(renderManualUpdateMessage(
        currentVersion,
        userVisibleTarget,
        source,
        installCommand,
      ));
      return 'continue';
    }

    const choice = await promptInstall(currentVersion, userVisibleTarget, source, installCommand);
    if (choice === 'skip') return 'continue';

    try {
      await installUpdate(source, userVisibleTarget.version, platform);
      stdout.write(renderInstallSuccessMessage(userVisibleTarget));
      return 'exit';
    } catch (error) {
      stderr.write(
        `warning: failed to install ${NPM_PACKAGE_NAME}@${userVisibleTarget.version}: ` +
          `${formatErrorMessage(error)}\n`,
      );
      return 'continue';
    }
  } catch {
    return 'continue';
  }
}
