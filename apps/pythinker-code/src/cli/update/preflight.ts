import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { Readable } from 'node:stream';

import { gt, gte, valid } from 'semver';

import { log, type Logger } from '@pythoughts/pythinker-code-sdk';
import type { TelemetryProperties } from '@pythoughts/pythinker-telemetry';

import {
  NATIVE_INSTALL_COMMAND_UNIX,
  NATIVE_INSTALL_COMMAND_WIN,
  PYTHINKER_CODE_INSTALL_SH_URL,
} from '#/constant/app';
import { loadTuiConfig } from '#/tui/config';

import { readUpdateCache } from './cache';
import { formatErrorMessage } from './format-error';
import { tryAcquireUpdateInstallLock } from './install-lock';
import {
  emptyUpdateInstallState,
  failureAttemptsFor,
  hasFreshActiveInstall,
  readUpdateInstallState,
  reconcileAbandonedInstall,
  writeUpdateInstallState,
} from './install-state';
import {
  CHANGELOG_URL,
  promptForInstallChoice,
  type InstallPromptChoiceValue,
  type InstallPromptOptions,
} from './prompt';
import { refreshUpdateCache } from './refresh';
import { isTargetInstallable, selectUpdateTarget } from './select';
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
  type UpdateInstallProgress,
  type UpdateInstallState,
  type UpdateCache,
  type UpdateManifest,
  type UpdatePreflightResult,
  type UpdateRequestOrigin,
  type UpdateTarget,
} from './types';
import { verifyInstalledVersion, type InstallVerification } from './verify-install';

export type { UpdatePreflightResult } from './types';

/** Reused for the paths that never reach verification (a failed install). */
const OK_VERIFICATION: InstallVerification = { ok: true };

export interface RunUpdatePreflightOptions {
  readonly stdout?: { write(chunk: string): boolean };
  readonly stderr?: { write(chunk: string): boolean };
  readonly isTTY?: boolean;
  readonly track?: (event: string, properties?: TelemetryProperties) => void;
  readonly logger?: UpdateLogger;
}

const AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD = 2;
const USER_VISIBLE_UPDATE_REFRESH_TIMEOUT_MS = 1_000;
const UPDATE_HELPER_ENV = 'PYTHINKER_CODE_UPDATE_HELPER';

type UpdateLogger = Pick<Logger, 'info' | 'warn'>;

function withCmdSuffix(base: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${base}.cmd` : base;
}

function bunCommand(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

/**
 * Node ≥18.20/20.12 refuses to spawn a `.cmd`/`.bat` file without a shell
 * (CVE-2024-27980) and fails with `EINVAL`, which is every npm-family update
 * on Windows: `npm.cmd`, `pnpm.cmd`, `yarn.cmd`. Only the package manager
 * wrappers need it — the arguments are a fixed flag list plus
 * `<package>@<semver>`, so nothing here reaches the shell as data.
 */
export function needsShell(cmd: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false;
  const lower = cmd.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
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
      //
      // `-s -- --version` pins the install to the version this preflight
      // decided on, the same guarantee PYTHINKER_VERSION gives on Windows.
      // Without it the script installs whatever the CDN currently calls
      // latest, which can differ from the rollout's target.
      return {
        cmd: 'bash',
        args: [
          '-c',
          `set -o pipefail; curl -fsSL ${PYTHINKER_CODE_INSTALL_SH_URL} | bash -s -- --version ${version}`,
        ],
      };
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
  return (
    `Updated ${NPM_PACKAGE_NAME} to ${target.version}. ` +
    'Close this terminal and open a new one to use the new version.\n'
  );
}

function renderBackgroundInstallSuccessNotice(version: string): string {
  const displayVersion = version.startsWith('v') ? version : `v${version}`;
  return `Pythinker Code updated to ${displayVersion}\nChangelog: ${CHANGELOG_URL}\n`;
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
  previousFailure: string | undefined,
): Promise<InstallPromptChoiceValue> {
  const options: InstallPromptOptions = {
    currentVersion,
    target,
    installSource: source,
    installCommand,
    previousFailure,
  };
  return promptForInstallChoice(options);
}

/**
 * A recorded failure is only worth showing when it is about the version the
 * prompt is offering — an older version's failure is stale noise.
 */
function failureMessageFor(
  state: UpdateInstallState,
  target: UpdateTarget,
): string | undefined {
  const failure = state.lastFailure;
  if (failure === null || failure.version !== target.version) return undefined;
  return failure.message;
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
      shell: needsShell(cmd, platform),
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
  // Exit code 0 is the installer's opinion; this is the fact. Rejecting here
  // routes a silent no-op install into the same failure reporting a crashed
  // installer gets, instead of printing "Updated …" over an unchanged binary.
  const verification = await verifyInstalledVersion(source, version);
  if (!verification.ok) throw new Error(verification.reason);
}

/** Keep the tail only: installers can be chatty, and the state file is small. */
const INSTALLER_STDERR_TAIL_CHARS = 2000;
/** At most one active-record progress write every 2s; terminal states bypass it. */
const INSTALLER_PROGRESS_WRITE_INTERVAL_MS = 2_000;
const INSTALLER_PROGRESS_PREFIX = 'progress: ';

function isInstallerProgressState(value: string): value is UpdateInstallProgress['state'] {
  return value === 'downloading' || value === 'waiting' || value === 'done' || value === 'failed';
}

/**
 * Parse one `progress: key=value key=value` line from the installer's stderr.
 * Unknown or malformed keys are skipped — an installer from a different
 * release must never crash the parent. Returns null when the line carries no
 * usable state.
 */
function parseInstallerProgressLine(line: string): UpdateInstallProgress | null {
  let state: UpdateInstallProgress['state'] | undefined;
  let percent: number | undefined;
  let transferred: number | undefined;
  let total: number | undefined;
  for (const field of line.slice(INSTALLER_PROGRESS_PREFIX.length).split(/\s+/u)) {
    const eq = field.indexOf('=');
    if (eq <= 0) continue;
    const key = field.slice(0, eq);
    const value = field.slice(eq + 1);
    switch (key) {
      case 'state':
        if (isInstallerProgressState(value)) state = value;
        break;
      case 'percent':
        if (/^(?:100|[0-9]{1,2})$/u.test(value)) percent = Number(value);
        break;
      case 'transferred':
        if (/^[0-9]+$/u.test(value)) transferred = Number(value);
        break;
      case 'total':
        if (/^[0-9]+$/u.test(value)) total = Number(value);
        break;
      default:
        break;
    }
  }
  if (state === undefined) return null;
  return { state, percent, transferred, total, updatedAt: nowIso() };
}

/**
 * Read the installer's stderr as lines. `progress: …` lines are parsed and
 * handed to `onProgress`; they never enter the failure tail, or a long
 * download would evict the very error text the tail exists to preserve. All
 * other lines are kept in the trailing `INSTALLER_STDERR_TAIL_CHARS` window.
 * Returns a getter for that tail.
 */
function captureStderrTail(
  child: ReturnType<typeof spawn>,
  onProgress: (update: UpdateInstallProgress) => void,
): () => string | undefined {
  // Typed `Readable | null`, but absent entirely when stderr was not piped.
  const stream: Readable | null | undefined = child.stderr;
  if (stream === null || stream === undefined) return () => undefined;
  let tail = '';
  let partial = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    const lines = (partial + chunk).split('\n');
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith(INSTALLER_PROGRESS_PREFIX)) {
        const update = parseInstallerProgressLine(line);
        if (update !== null) onProgress(update);
      } else {
        tail = (tail + line + '\n').slice(-INSTALLER_STDERR_TAIL_CHARS);
      }
    }
  });
  // A detached installer outliving this process must not crash it, and the
  // pipe must not hold the event loop open on the way out. `child.stderr` is
  // typed as a plain Readable, but the pipe is a Socket at runtime and that is
  // where unref lives.
  stream.on('error', () => {});
  (stream as Readable & { unref?: () => void }).unref?.();
  return () => {
    // A final partial line without a newline is still installer text; include
    // it unless it is a truncated progress line.
    const complete = partial.length === 0 || partial.startsWith(INSTALLER_PROGRESS_PREFIX)
      ? tail
      : tail + partial;
    const trimmed = complete.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  };
}

function describeChildExit(cmd: string, code: number | null, signal: NodeJS.Signals | null): string {
  const detail = signal !== null ? `signal ${signal}` : `code ${String(code)}`;
  return `${cmd} exited with ${detail}`;
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

/**
 * Whether the target is strictly newer than the version an active install is
 * working on — the newer update can only start after the running one finishes.
 */
function targetSupersedesInstallingVersion(
  installingVersion: string,
  targetVersion: string,
): boolean {
  return valid(installingVersion) !== null && valid(targetVersion) !== null && gt(targetVersion, installingVersion);
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
    let pendingOutcome: { succeeded: boolean; reason: string } | undefined;
    // Progress writes are fire-and-forget, and the state file is written as a
    // temp file plus rename — so the last rename wins. The installer's terminal
    // `state=done` line bypasses the throttle and writes just as the child
    // exits, so without ordering that write can land *after* the outcome write
    // and restore `active` while dropping `lastSuccess`. The next launch reads
    // that as an abandoned install and records a failure for a version that
    // installed cleanly. One chain keeps the writes ordered and gives `finish`
    // something to drain.
    let progressWrites: Promise<void> = Promise.resolve();

    const finish = async (succeeded: boolean, reason: string): Promise<void> => {
      if (!ready) {
        pendingOutcome ??= { succeeded, reason };
        return;
      }
      if (settled) return;
      settled = true;
      // `settled` already stops new progress writes; drain the ones in flight so
      // none of them renames over the outcome below.
      await progressWrites;
      // An installer that exits 0 without replacing the binary must not be
      // recorded as a success: the footer would advertise "restart to apply"
      // for a version that never runs, on every launch, forever.
      const verification = succeeded
        ? await verifyInstalledVersion(source, target.version)
        : OK_VERIFICATION;
      const installed = succeeded && verification.ok;
      const outcomeReason = verification.ok ? reason : verification.reason;
      const attempts = failureAttemptsFor(startedState, target, 'install') + 1;
      const stderrTail = readStderrTail();
      const message = stderrTail === undefined ? outcomeReason : `${outcomeReason}: ${stderrTail}`;

      const nextState: UpdateInstallState = installed
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
            message,
          },
        };
      try {
        await writeUpdateInstallState(nextState).catch(() => {});
        if (installed) {
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
          message,
        });
      } finally {
        await lock.release().catch(() => {});
      }
    };

    const child = spawn(cmd, [...args], {
      detached: true,
      // A detached child gets its own console window on Windows regardless
      // of stdio; stdio: 'ignore' alone does not suppress it.
      windowsHide: platform === 'win32',
      shell: needsShell(cmd, platform),
      // stdout stays discarded (install progress is noise); stderr is piped so
      // the installer's machine-readable progress lines can be recorded and a
      // failure still keeps the installer's own error text.
      stdio: ['ignore', 'ignore', 'pipe'],
      env: env === undefined ? undefined : { ...process.env, ...env },
    });
    let lastProgressWriteAt = 0;
    const recordInstallerProgress = (update: UpdateInstallProgress): void => {
      // Once the outcome is being written, progress is history: writing it would
      // undo the terminal record.
      if (settled) return;
      // Terminal states always persist; intermediate ones at most every 2s.
      const terminal = update.state === 'done' || update.state === 'failed';
      if (
        !terminal
        && Date.now() - lastProgressWriteAt < INSTALLER_PROGRESS_WRITE_INTERVAL_MS
      ) return;
      if (startedState.active === null) return;
      lastProgressWriteAt = Date.now();
      const nextState: UpdateInstallState = {
        ...startedState,
        // Carry the pid explicitly: a progress line can arrive while the pid
        // write is still in flight, and writing the pre-pid record over it
        // would strip the pid this record's liveness check depends on.
        active: {
          ...startedState.active,
          pid: child.pid ?? startedState.active.pid,
          progress: update,
        },
      };
      progressWrites = progressWrites
        .then(() => writeUpdateInstallState(nextState))
        .catch((error) => {
          // A progress write is best-effort; it must never reject the spawn path
          // and must not break the chain for the writes queued behind it.
          logUpdateWarn(logger, 'could not record installer progress', {
            targetVersion: target.version,
            source,
            error: formatErrorMessage(error),
          });
        });
    };
    const readStderrTail = captureStderrTail(child, recordInstallerProgress);
    child.once('error', (error) => { void finish(false, formatErrorMessage(error)); });
    child.once('exit', (code, signal) => {
      void finish(code === 0, describeChildExit(cmd, code, signal));
    });
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
    if (pendingOutcome !== undefined) void finish(pendingOutcome.succeeded, pendingOutcome.reason);
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
    readonly installingVersion: string;
    /** Present only when it is newer than the version being installed. */
    readonly targetVersion?: string;
    readonly installOnRestart: boolean;
    readonly readyToInstall: boolean;
  }
  | {
    readonly status: 'manual';
    readonly version: string;
    readonly command: string;
    readonly source: InstallSource;
  }
  | {
    readonly status: 'failed';
    readonly version: string;
    readonly attempts: number;
    readonly failedAt: string;
    readonly message?: string;
    readonly command: string;
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
  // A native install consumes the manifest's platform artifact; without one
  // the update cannot succeed, so treat it as nothing to update.
  if (!isTargetInstallable(source, cache.manifest)) {
    return { status: 'up-to-date' };
  }
  let installState = await readUpdateInstallState().catch(() => emptyUpdateInstallState());
  installState = await reconcileAbandonedInstall(installState);
  if (hasFreshActiveInstall(installState)) {
    const installingVersion = installState.active?.version ?? target.version;
    return {
      status: 'in-progress',
      installingVersion,
      targetVersion: targetSupersedesInstallingVersion(installingVersion, target.version)
        ? target.version
        : undefined,
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
      installingVersion: pending.version,
      installOnRestart: true,
      readyToInstall: true,
    };
  }
  // A version parks once the failure counter hits the threshold: the
  // background lifecycle refuses to touch it again, so claiming "started" or
  // "in-progress" would be a lie and another retry would only burn another
  // launch on an install that already failed. Report the recorded failure
  // and the copyable command instead.
  const failure = installState.lastFailure;
  if (
    failure !== null &&
    failureAttemptsFor(installState, target) >= AUTO_INSTALL_FAILURE_PROMPT_THRESHOLD
  ) {
    return {
      status: 'failed',
      version: target.version,
      attempts: failure.attempts,
      failedAt: failure.failedAt,
      message: failure.message,
      command: installCommandFor(source, target.version, platform),
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
          installingVersion: target.version,
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
        installingVersion: target.version,
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
    installState = await reconcileAbandonedInstall(installState);
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

    // The cached target above only decides whether anything is worth
    // refreshing for; the bounded refresh below is this launch's single
    // decision. Everything after it uses the refreshed target and manifest,
    // with the cached pair as the fallback when the refresh fails or times
    // out. A null refreshed target means the refresh offers nothing.
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

    // A native install consumes the manifest's platform artifact; without one
    // the update cannot succeed, so do not offer or start it. Non-native
    // sources install from the registry/formula and are never gated here.
    if (!isTargetInstallable(source, userVisibleUpdate.manifest)) {
      return 'continue';
    }

    const decision = decideUpdateAction(userVisibleTarget, isInteractive, source, platform);
    if (decision === 'none') {
      return 'continue';
    }

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

    // An install that is already in flight must not be prompted for a second
    // time: the user would get a confusing double message for work that is
    // already running elsewhere.
    if (hasFreshActiveInstall(installState)) return 'continue';

    const choice = await promptInstall(
      currentVersion,
      userVisibleTarget,
      source,
      installCommand,
      failureMessageFor(installState, userVisibleTarget),
    );
    if (choice === 'skip') return 'continue';

    // Take the lock only after the prompt resolves: holding it across an
    // indefinite interactive wait would block the background path as long as
    // the prompt sits unanswered. A null handle means another installer is
    // already running — do not install on top of it.
    const lock = await tryAcquireUpdateInstallLock({ version: userVisibleTarget.version });
    if (lock === null) return 'continue';

    try {
      await installUpdate(source, userVisibleTarget.version, platform);
      await writeUpdateInstallState({
        ...installState,
        active: null,
        lastFailure: null,
        lastSuccess: {
          version: userVisibleTarget.version,
          installedAt: nowIso(),
          notifiedAt: null,
        },
      }).catch(() => {});
      stdout.write(renderInstallSuccessMessage(userVisibleTarget));
      return 'exit';
    } catch (error) {
      const attempts = failureAttemptsFor(installState, userVisibleTarget, 'install') + 1;
      await writeUpdateInstallState({
        ...installState,
        active: null,
        lastFailure: {
          version: userVisibleTarget.version,
          failedAt: nowIso(),
          attempts,
          operation: 'install',
          message: formatErrorMessage(error),
        },
      }).catch(() => {});
      stderr.write(
        `warning: failed to install ${NPM_PACKAGE_NAME}@${userVisibleTarget.version}: ` +
          `${formatErrorMessage(error)}\n`,
      );
      return 'continue';
    } finally {
      await lock.release().catch(() => {});
    }
  } catch {
    return 'continue';
  }
}
