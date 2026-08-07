import type * as ChildProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readUpdateCache } from '#/cli/update/cache';
import {
  emptyUpdateInstallState,
  readUpdateInstallState,
  writeUpdateInstallState,
} from '#/cli/update/install-state';
import { canAutoInstall, runUpdatePreflight, spawnForSource, startManualUpdate } from '#/cli/update/preflight';
import { promptForInstallChoice } from '#/cli/update/prompt';
import type * as PromptModule from '#/cli/update/prompt';
import { refreshUpdateCache } from '#/cli/update/refresh';
import type * as RefreshModule from '#/cli/update/refresh';
import type * as RolloutModule from '#/cli/update/rollout';
import { detectInstallSource } from '#/cli/update/source';
import {
  emptyUpdateCache,
  type UpdateCache,
  type UpdateInstallState,
  type UpdateManifest,
  type UpdatePreparedHomebrew,
} from '#/cli/update/types';
import {
  DEFAULT_STATUS_LINE_CONFIG,
  type TuiConfig,
} from '#/tui/config';
import { getUpdateInstallStateFile } from '#/utils/paths';

const mocks = vi.hoisted(() => ({
  readUpdateCache: vi.fn(),
  readUpdateInstallState: vi.fn(),
  writeUpdateInstallState: vi.fn(),
  tryAcquireUpdateInstallLock: vi.fn(),
  loadTuiConfig: vi.fn(),
  detectInstallSource: vi.fn(),
  promptForInstallChoice: vi.fn(),
  refreshUpdateCache: vi.fn(),
  resolveUpdateDeviceId: vi.fn(),
  appendRolloutDecisionLog: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../../src/cli/update/cache', () => ({
  readUpdateCache: mocks.readUpdateCache,
}));

vi.mock('../../../src/cli/update/install-lock', () => ({
  tryAcquireUpdateInstallLock: mocks.tryAcquireUpdateInstallLock,
}));

// Only the file IO is faked: `hasFreshActiveInstall` is the lease rule under
// test in several cases below, so it must be the real one.
vi.mock('../../../src/cli/update/install-state', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/cli/update/install-state.js')
  >('../../../src/cli/update/install-state');
  return {
    ...actual,
    readUpdateInstallState: mocks.readUpdateInstallState,
    writeUpdateInstallState: mocks.writeUpdateInstallState,
  };
});

// The reconciliation lives inside install-state.ts and calls its own module's
// writer directly, which the module mock above cannot rewire. Mocking the
// persistence layer catches those writes too — and keeps them off the real
// home directory.
vi.mock('../../../src/utils/persistence', () => ({
  readJsonFile: mocks.readJsonFile,
  writeJsonFile: mocks.writeJsonFile,
}));

vi.mock('../../../src/tui/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/tui/config.js')>(
    '../../../src/tui/config.js',
  );
  return {
    ...actual,
    loadTuiConfig: mocks.loadTuiConfig,
    TuiConfigParseError: class TuiConfigParseError extends Error {
      readonly fallback: TuiConfig;

      constructor(fallback: TuiConfig) {
        super('Invalid client preferences in ~/.pythinker-code/tui.toml; using defaults.');
        this.fallback = fallback;
      }
    },
  };
});

vi.mock('../../../src/cli/update/source', () => ({
  detectInstallSource: mocks.detectInstallSource,
}));

vi.mock('../../../src/cli/update/prompt', async () => {
  const actual = await vi.importActual<typeof PromptModule>('../../../src/cli/update/prompt.js');
  return {
    ...actual,
    promptForInstallChoice: mocks.promptForInstallChoice,
  };
});

vi.mock('../../../src/cli/update/refresh', async () => {
  const actual = await vi.importActual<typeof RefreshModule>('../../../src/cli/update/refresh.js');
  return {
    ...actual,
    refreshUpdateCache: mocks.refreshUpdateCache,
  };
});

vi.mock('../../../src/cli/update/rollout', async () => {
  const actual = await vi.importActual<typeof RolloutModule>('../../../src/cli/update/rollout.js');
  return {
    ...actual,
    resolveUpdateDeviceId: mocks.resolveUpdateDeviceId,
    // Stubbed so preflight tests never write a real rollout.log.
    appendRolloutDecisionLog: mocks.appendRolloutDecisionLog,
  };
});

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof ChildProcess>('node:child_process');
  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

function cacheWith(version: string): UpdateCache {
  return {
    source: 'cdn',
    checkedAt: '2026-04-23T08:00:00.000Z',
    latest: version,
    manifest: null,
  };
}

function manifestFor(version: string, overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    version,
    publishedAt: '2020-01-01T00:00:00.000Z',
    rollout: [],
    ...overrides,
  };
}

function cacheWithManifest(manifest: UpdateManifest): UpdateCache {
  return {
    source: 'cdn',
    checkedAt: '2026-04-23T08:00:00.000Z',
    latest: manifest.version,
    manifest,
  };
}

/** Every bucket delayed by 24h and the clock just started: nobody is eligible. */
function heldForEveryone(version: string): UpdateManifest {
  return manifestFor(version, {
    publishedAt: new Date(Date.now() - 1_000).toISOString(),
    rollout: [{ percent: 100, delaySeconds: 86_400 }],
  });
}

/** Every bucket immediate and publishedAt long past: everybody is eligible. */
function releasedForEveryone(version: string): UpdateManifest {
  return manifestFor(version, {
    rollout: [{ percent: 100, delaySeconds: 0 }],
  });
}

/** A manifest advertising an artifact for a platform other than the running one. */
function manifestOmittingRunningTarget(version: string): UpdateManifest {
  const otherArch = process.arch === 'arm64' ? 'x64' : 'arm64';
  return manifestFor(version, {
    platforms: {
      [`${process.platform}-${otherArch}`]: {
        url: `https://code.pythinker.com/pythinker-code-${version}.zip`,
        sha256: 'a'.repeat(64),
      },
    },
  });
}

/** A manifest advertising an artifact for the running platform. */
function manifestForRunningTarget(version: string): UpdateManifest {
  return manifestFor(version, {
    platforms: {
      [`${process.platform}-${process.arch}`]: {
        url: `https://code.pythinker.com/pythinker-code-${version}.zip`,
        sha256: 'a'.repeat(64),
      },
    },
  });
}

function installState(overrides: Partial<UpdateInstallState> = {}): UpdateInstallState {
  return {
    active: null,
    pending: null,
    lastFailure: null,
    lastSuccess: null,
    ...overrides,
  };
}

function preparedHomebrewUpdate(): UpdatePreparedHomebrew {
  return {
    jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
    source: 'homebrew',
    version: '0.5.0',
    preparedAt: '2026-08-04T08:00:00.000Z',
    requestedBy: 'automatic',
    formulaUrl: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
    artifactKind: 'source',
    artifactSha256: 'a'.repeat(64),
    formulaFileSha256: 'b'.repeat(64),
    artifactPath: '/tmp/cache/pythinker-code-0.5.0.tgz',
  };
}

function tuiConfig(overrides: Partial<TuiConfig> = {}): TuiConfig {
  return {
    theme: 'auto',
    layout: 'fixed',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
    ...overrides,
    copyFullResponse: overrides.copyFullResponse ?? false,
  };
}

function disableAutoInstall(): void {
  mocks.loadTuiConfig.mockResolvedValue(tuiConfig({ upgrade: { autoInstall: false } }));
}

function captureOutput(): {
  stdout: string[];
  stderr: string[];
  options: {
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
    isTTY: boolean;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    options: {
      stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
      isTTY: true,
    },
  };
}

type TestLogFn = ReturnType<typeof vi.fn<(message: string, payload?: unknown) => void>>;

function captureLogger(): {
  info: TestLogFn;
  warn: TestLogFn;
  error: TestLogFn;
  debug: TestLogFn;
} {
  return {
    info: vi.fn<(message: string, payload?: unknown) => void>(),
    warn: vi.fn<(message: string, payload?: unknown) => void>(),
    error: vi.fn<(message: string, payload?: unknown) => void>(),
    debug: vi.fn<(message: string, payload?: unknown) => void>(),
  };
}

function mockSpawnExit(code: number, signal: NodeJS.Signals | null = null): void {
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { pid: 42_424, unref: vi.fn() });
    queueMicrotask(() => { child.emit('exit', code, signal); });
    return child;
  });
}

/**
 * Like mockSpawnExit, but the installer also writes to stderr. The child only
 * exposes a stderr stream when the caller actually asked for a pipe — the real
 * `stdio: 'ignore'` gives none — so a regression back to discarded output makes
 * the message assertion fail instead of silently still passing.
 */
function mockSpawnExitWithStderr(code: number, stderrText: string): void {
  mocks.spawn.mockImplementation((_cmd: string, _args: string[], options?: { stdio?: unknown }) => {
    const stdio = options?.stdio;
    const stderrPiped = Array.isArray(stdio) && stdio[2] === 'pipe';
    const stderr = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
      unref: vi.fn(),
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 42_424,
      unref: vi.fn(),
      stderr: stderrPiped ? stderr : null,
    });
    queueMicrotask(() => {
      if (stderrPiped) stderr.emit('data', stderrText);
      child.emit('exit', code, null);
    });
    return child;
  });
}

/**
 * Like mockSpawnExitWithStderr, but stderr arrives as several separate chunks
 * so the line reader has to reassemble a progress line split mid-way across
 * 'data' events.
 */
function mockSpawnExitWithChunkedStderr(code: number, chunks: string[]): void {
  mocks.spawn.mockImplementation((_cmd: string, _args: string[], options?: { stdio?: unknown }) => {
    const stdio = options?.stdio;
    const stderrPiped = Array.isArray(stdio) && stdio[2] === 'pipe';
    const stderr = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
      unref: vi.fn(),
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 42_424,
      unref: vi.fn(),
      stderr: stderrPiped ? stderr : null,
    });
    queueMicrotask(() => {
      if (stderrPiped) {
        for (const chunk of chunks) stderr.emit('data', chunk);
      }
      child.emit('exit', code, null);
    });
    return child;
  });
}

/**
 * Like mockSpawnExitWithStderr, but stderr chunks and the exit arrive on real
 * timers, so the parent's write throttle sees realistic time deltas.
 */
function mockSpawnExitWithTimedStderr(
  code: number,
  chunks: Array<{ atMs: number; text: string }>,
  exitAtMs: number,
): void {
  mocks.spawn.mockImplementation((_cmd: string, _args: string[], options?: { stdio?: unknown }) => {
    const stdio = options?.stdio;
    const stderrPiped = Array.isArray(stdio) && stdio[2] === 'pipe';
    const stderr = Object.assign(new EventEmitter(), {
      setEncoding: vi.fn(),
      unref: vi.fn(),
    });
    const child = Object.assign(new EventEmitter(), {
      pid: 42_424,
      unref: vi.fn(),
      stderr: stderrPiped ? stderr : null,
    });
    for (const chunk of chunks) {
      setTimeout(() => {
        if (stderrPiped) stderr.emit('data', chunk.text);
      }, chunk.atMs);
    }
    setTimeout(() => { child.emit('exit', code, null); }, exitAtMs);
    return child;
  });
}

/** The failure messages written by the background-install finalizer, in order. */
function progressFailureMessages(): string[] {
  return mocks.writeUpdateInstallState.mock.calls
    .map((call) => call[0])
    .filter((state) => state !== undefined && state !== null && state.lastFailure !== undefined && state.lastFailure !== null)
    .map((state) => state.lastFailure.message);
}

/** The states written with an active record carrying progress, in order. */
function progressActiveStates(): unknown[] {
  return mocks.writeUpdateInstallState.mock.calls
    .map((call) => call[0])
    .filter((state) => state !== undefined && state !== null && state.active?.progress !== undefined);
}

/** The terminal success records written by the finalizer, in order. */
function successOutcomeStates(): unknown[] {
  return mocks.writeUpdateInstallState.mock.calls
    .map((call) => call[0])
    .filter((state) => state !== undefined && state !== null
      && state.active === null && state.lastSuccess !== undefined && state.lastSuccess !== null);
}

async function flushBackgroundInstall(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('runUpdatePreflight', () => {
  beforeEach(() => {
    mocks.readUpdateInstallState.mockResolvedValue(emptyUpdateInstallState());
    mocks.writeUpdateInstallState.mockResolvedValue(undefined);
    mocks.readJsonFile.mockResolvedValue(null);
    mocks.writeJsonFile.mockResolvedValue(undefined);
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.resolveUpdateDeviceId.mockReturnValue('test-device');
    mocks.appendRolloutDecisionLog.mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

  it('skips all update work when PYTHINKER_CODE_NO_AUTO_UPDATE is set', async () => {
    vi.stubEnv('PYTHINKER_CODE_NO_AUTO_UPDATE', '1');
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(readUpdateCache).not.toHaveBeenCalled();
    expect(refreshUpdateCache).not.toHaveBeenCalled();
    expect(detectInstallSource).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('also honors the legacy PYTHINKER_CLI_NO_AUTO_UPDATE alias', async () => {
    vi.stubEnv('PYTHINKER_CLI_NO_AUTO_UPDATE', 'true');
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(readUpdateCache).not.toHaveBeenCalled();
    expect(detectInstallSource).not.toHaveBeenCalled();
  });

  it('starts an automatic update from the first fresh check when the cache is empty', async () => {
    mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(readUpdateCache).toHaveBeenCalledTimes(1);
    expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(detectInstallSource).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('does not start a fresh-check background install when automatic updates are disabled', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
    expect(detectInstallSource).toHaveBeenCalledTimes(1);
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('skips when non-interactive', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    const { options } = captureOutput();
    await expect(
      runUpdatePreflight('0.4.0', { ...options, isTTY: false }),
    ).resolves.toBe('continue');
    expect(detectInstallSource).not.toHaveBeenCalled();
  });

  it('does not start a fresh-check background install when non-interactive', async () => {
    mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    const { options } = captureOutput();

    await expect(
      runUpdatePreflight('0.4.0', { ...options, isTTY: false }),
    ).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
    expect(detectInstallSource).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('npm-global: prompts and spawns npm install -g when automatic updates are disabled', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('exit');
    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        installCommand: 'npm install -g @pythoughts/pythinker-code@0.5.0',
        installSource: 'npm-global',
      }),
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { stdio: 'inherit' },
    );
    expect(stdout.join('')).toContain('Updated @pythoughts/pythinker-code to 0.5.0');
  });

  it('refreshes a stale cached target before showing the foreground install prompt', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.7.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('exit');

    expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { version: '0.7.0' },
        installCommand: 'npm install -g @pythoughts/pythinker-code@0.7.0',
      }),
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.7.0'],
      { stdio: 'inherit' },
    );
    expect(stdout.join('')).toContain('Updated @pythoughts/pythinker-code to 0.7.0');
  });

  it('falls back to the cached foreground prompt target when the refresh hangs', async () => {
    vi.useFakeTimers();
    try {
      disableAutoInstall();
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
      mocks.refreshUpdateCache.mockReturnValue(new Promise(() => {}));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mocks.promptForInstallChoice.mockResolvedValue('skip');
      const { options } = captureOutput();

      const result = runUpdatePreflight('0.5.0', options);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBe('continue');
      expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { version: '0.6.0' },
          installCommand: 'npm install -g @pythoughts/pythinker-code@0.6.0',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the background install for the refreshed version, never the cached one', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.11.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.9.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/u),
      ['install', '-g', '@pythoughts/pythinker-code@0.11.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(mocks.spawn).not.toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/u),
      ['install', '-g', '@pythoughts/pythinker-code@0.10.0'],
      expect.anything(),
    );
  });

  it('starts nothing when the refresh offers no newer version than the current one', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.9.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.9.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('falls back to the cached target when the refresh rejects', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockRejectedValue(new Error('offline'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.9.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/u),
      ['install', '-g', '@pythoughts/pythinker-code@0.10.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('falls back to the cached target when the refresh hangs past the 1-second budget', async () => {
    vi.useFakeTimers();
    try {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockReturnValue(new Promise(() => {}));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExit(0);
      const { options } = captureOutput();

      const result = runUpdatePreflight('0.9.0', options);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBe('continue');
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      expect(mocks.spawn).toHaveBeenCalledWith(
        expect.stringMatching(/^npm(\.cmd)?$/u),
        ['install', '-g', '@pythoughts/pythinker-code@0.10.0'],
        { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('native: offers and installs nothing when the refreshed manifest omits the running platform', async () => {
    const cached = cacheWithManifest(manifestForRunningTarget('0.10.0'));
    const refreshed = cacheWithManifest(manifestOmittingRunningTarget('0.11.0'));
    mocks.readUpdateCache.mockResolvedValue(cached);
    mocks.refreshUpdateCache.mockResolvedValue(refreshed);
    mocks.detectInstallSource.mockResolvedValue('native');
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.9.0', options)).resolves.toBe('continue');

    expect(stdout.join('')).toBe('');
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('decides from the cache and from the refresh exactly once each per launch', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.11.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.9.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    const phases = mocks.appendRolloutDecisionLog.mock.calls.map((call) => call[0].phase);
    expect(phases.filter((phase) => phase === 'startup-cache')).toHaveLength(1);
    expect(phases.filter((phase) => phase === 'prompt-refresh')).toHaveLength(1);
    expect(phases.filter((phase) => phase === 'background-refresh')).toHaveLength(0);
  });

  it('pnpm-global: spawns pnpm add -g', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('pnpm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { options } = captureOutput();
    await runUpdatePreflight('0.4.0', options);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^pnpm(\.cmd)?$/),
      ['add', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { stdio: 'inherit' },
    );
  });

  it('yarn-global: spawns yarn global add', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('yarn-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { options } = captureOutput();
    await runUpdatePreflight('0.4.0', options);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^yarn(\.cmd)?$/),
      ['global', 'add', '@pythoughts/pythinker-code@0.5.0'],
      { stdio: 'inherit' },
    );
  });

  it('bun-global: spawns bun add -g', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('bun-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { options } = captureOutput();
    await runUpdatePreflight('0.4.0', options);
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^bun(\.exe)?$/),
      ['add', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { stdio: 'inherit' },
    );
  });

  it('homebrew: prepares the update in a detached helper for activation on restart', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('homebrew');
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release,
    });
    const child = Object.assign(new EventEmitter(), { pid: 42_424, unref: vi.fn() });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => { child.emit('spawn'); });
      return child;
    });
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(stdout).toEqual([]);
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        process.argv[1],
        '__update_helper',
        'prepare-homebrew',
        expect.any(String),
        '0.5.0',
        'automatic',
      ],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      active: expect.objectContaining({
        version: '0.5.0',
        source: 'homebrew',
        operation: 'prepare',
        jobId: expect.any(String),
      }),
    }));
    expect(child.unref).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('native on darwin: spawns bash -c with pipefail-guarded curl|bash', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('native');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const { options } = captureOutput();
      await runUpdatePreflight('0.4.0', options);
      const call = mocks.spawn.mock.calls[0];
      expect(call?.[0]).toBe('bash');
      expect(call?.[2]).toEqual({ stdio: 'inherit' });
      const [flag, script] = call?.[1] as string[];
      expect(flag).toBe('-c');
      // pipefail must come before the pipeline so a failed `curl` is not masked
      // by the trailing `bash` exiting 0 (see "surfaces a failed curl" below).
      expect(script).toContain('set -o pipefail');
      expect(script).toContain('curl -fsSL https://code.pythinker.com/pythinker-code/install.sh');
      // Pin the decided version, the same guarantee PYTHINKER_VERSION gives on
      // Windows. Unpinned, the script installs whatever the CDN calls latest,
      // which can differ from the version the rollout chose.
      expect(script).toContain('| bash -s -- --version 0.5.0');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('native on win32: starts a background powershell install, no manual prompt', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('native');
    mockSpawnExit(0);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const { stdout, options } = captureOutput();
      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();
      expect(stdout.join('')).toBe('');
      expect(promptForInstallChoice).not.toHaveBeenCalled();
      expect(mocks.spawn).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          'irm https://code.pythinker.com/pythinker-code/install.ps1 | iex',
        ],
        {
          detached: true,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: expect.objectContaining({ PYTHINKER_VERSION: '0.5.0' }),
        },
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('native: offers and installs nothing when the manifest omits the running platform', async () => {
    const omitted = cacheWithManifest(manifestOmittingRunningTarget('0.5.0'));
    mocks.readUpdateCache.mockResolvedValue(omitted);
    mocks.refreshUpdateCache.mockResolvedValue(omitted);
    mocks.detectInstallSource.mockResolvedValue('native');
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(stdout.join('')).toBe('');
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(detectInstallSource).toHaveBeenCalledTimes(1);
  });

  it('native: prompts and installs when the manifest advertises the running platform', async () => {
    disableAutoInstall();
    const advertised = cacheWithManifest(manifestForRunningTarget('0.5.0'));
    mocks.readUpdateCache.mockResolvedValue(advertised);
    mocks.refreshUpdateCache.mockResolvedValue(advertised);
    mocks.detectInstallSource.mockResolvedValue('native');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('exit');

    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
      expect.objectContaining({ installSource: 'native' }),
    );
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('npm-global: still prompts and installs when the manifest omits the running platform', async () => {
    disableAutoInstall();
    const omitted = cacheWithManifest(manifestOmittingRunningTarget('0.5.0'));
    mocks.readUpdateCache.mockResolvedValue(omitted);
    mocks.refreshUpdateCache.mockResolvedValue(omitted);
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('exit');

    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
      expect.objectContaining({ installSource: 'npm-global' }),
    );
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/u),
      ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { stdio: 'inherit' },
    );
  });

  it('unsupported: prints fallback npm command', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('unsupported');
    const { stdout, options } = captureOutput();
    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(stdout.join('')).toContain('npm install -g @pythoughts/pythinker-code@0.5.0');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('declined install continues without spawn', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();
    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not prompt for a foreground install while a fresh active install is running', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.tryAcquireUpdateInstallLock).not.toHaveBeenCalled();
  });

  it('acquires the install lock only after the prompt resolves and releases it afterwards', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release,
    });
    let resolvePrompt: ((value: 'install') => void) | undefined;
    const prompt = new Promise<'install'>((resolve) => { resolvePrompt = resolve; });
    mocks.promptForInstallChoice.mockReturnValue(prompt);
    const { stdout, options } = captureOutput();

    const running = runUpdatePreflight('0.4.0', options);

    // Let the flow actually reach the prompt first. Asserting straight after the
    // call was vacuous: nothing had run past the first await, so "no lock yet"
    // held wherever the acquisition sat, and the ordering claim in the test name
    // went unchecked.
    await vi.waitFor(() => {
      expect(mocks.promptForInstallChoice).toHaveBeenCalled();
    });
    expect(mocks.tryAcquireUpdateInstallLock).not.toHaveBeenCalled();
    resolvePrompt?.('install');
    await expect(running).resolves.toBe('exit');
    expect(mocks.tryAcquireUpdateInstallLock).toHaveBeenCalledWith({ version: '0.5.0' });
    expect(release).toHaveBeenCalledOnce();
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      active: null,
      lastFailure: null,
      lastSuccess: {
        version: '0.5.0',
        installedAt: expect.any(String),
        notifiedAt: null,
      },
    }));
    expect(stdout.join('')).toContain('Updated @pythoughts/pythinker-code to 0.5.0');
  });

  it('releases the lock and records the failure when the foreground install fails', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(1);
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release,
    });
    const { stderr, options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(stderr.join('')).toContain('warning: failed to install');
    expect(release).toHaveBeenCalledOnce();
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      active: null,
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        attempts: 1,
        operation: 'install',
        failedAt: expect.any(String),
      }),
      lastSuccess: null,
    }));
  });

  it('warns and continues when spawn exits non-zero, without claiming success', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('install');
    mockSpawnExit(1);
    const { stdout, stderr, options } = captureOutput();
    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(stderr.join('')).toContain('warning: failed to install');
    // A failed install must never print the "Updated …" success line.
    expect(stdout.join('')).not.toContain('Updated @pythoughts/pythinker-code');
  });

  it('starts an automatic update in the background by default', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      active: expect.objectContaining({
        version: '0.5.0',
        source: 'npm-global',
        startedAt: expect.any(String),
      }),
      lastFailure: null,
    }));

    await flushBackgroundInstall();

    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      active: null,
      lastFailure: null,
      lastSuccess: expect.objectContaining({
        version: '0.5.0',
        installedAt: expect.any(String),
        notifiedAt: null,
      }),
    }));
  });

  it('treats a fresh legacy active record as a conservative lease for the same target', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('blocks a changed target with a fresh PID-less lease without showing a success notice', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

    expect(stdout).toEqual([]);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.tryAcquireUpdateInstallLock).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('retries a stale legacy active record that has no installer pid', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString(),
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('does not retry the same target while the recorded installer pid is still alive', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('blocks a changed target while the previous target installer pid remains alive within the TTL', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() - (6 * 60 * 60 * 1_000 - 60_000)).toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.tryAcquireUpdateInstallLock).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('recovers a changed target after the previous installer pid outlives the TTL ceiling', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() - (6 * 60 * 60 * 1_000 + 60_000)).toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/u),
      ['install', '-g', '@pythoughts/pythinker-code@0.6.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('tolerates a small clock rollback while the recorded installer pid is alive', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() + 60_000).toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(promptForInstallChoice).not.toHaveBeenCalled();
  });

  it('retries an active record whose timestamp is far in the future', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('recovers a changed target after a stale PID-less lease expires', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString(),
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.6.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('recovers a changed target when the previous installer pid is dead', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
        pid: 999_999_999,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.6.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('parks a doomed version after two abandoned installs are reconciled', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    let persisted: UpdateInstallState = installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
        pid: 999_999_999,
      },
    });
    // The reconciliation writes through install-state's own writer, which the
    // module mock cannot intercept — capture that path via the persistence
    // mock so both write routes feed the same simulated state file.
    mocks.writeUpdateInstallState.mockImplementation(
      async (state: UpdateInstallState) => { persisted = state; },
    );
    mocks.writeJsonFile.mockImplementation(
      async (_filePath: string, _schema: unknown, value: UpdateInstallState) => { persisted = value; },
    );
    mocks.readUpdateInstallState.mockImplementation(async () => persisted);
    // Each launch's installer dies without recording an outcome, so the next
    // launch finds only an abandoned active record.
    mocks.spawn.mockImplementation(
      () => Object.assign(new EventEmitter(), { pid: 999_999_999, unref: vi.fn() }),
    );
    const { options } = captureOutput();

    // First launch: the abandoned record is reconciled to one attempt and the
    // version is still attempted in the background.
    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(persisted.lastFailure?.attempts).toBe(1);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    // Second launch: the counter reaches the parking threshold and the
    // automatic path refuses to start the installer again — assert the
    // refusal, not just the counter.
    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    expect(persisted.lastFailure?.attempts).toBe(2);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.tryAcquireUpdateInstallLock).toHaveBeenCalledTimes(1);
  });

  it('recovers a changed target from a far-future active timestamp', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        pid: process.pid,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.6.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.6.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('finalizes and releases after persisting the child pid fails', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release,
    });
    mocks.writeUpdateInstallState
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cannot persist child pid'))
      .mockResolvedValueOnce(undefined);
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(writeUpdateInstallState).toHaveBeenCalledTimes(3);
    expect(writeUpdateInstallState).toHaveBeenNthCalledWith(2, expect.objectContaining({
      active: expect.objectContaining({ pid: 42_424 }),
    }));
    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      active: null,
      lastSuccess: expect.objectContaining({ version: '0.5.0' }),
    }));
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.writeUpdateInstallState.mock.invocationCallOrder[2])
      .toBeLessThan(release.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
  });

  it('keeps the install lock until a delayed terminal state write completes', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    let held = false;
    const release = vi.fn(async () => { held = false; });
    mocks.tryAcquireUpdateInstallLock.mockImplementation(async () => {
      if (held) return null;
      held = true;
      return {
        filePath: '/tmp/pythinker-update-install.lock',
        release,
      };
    });
    const child = Object.assign(new EventEmitter(), { pid: 42_424, unref: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    let resolveTerminalWrite: (() => void) | undefined;
    let terminalWriteStarted = false;
    const terminalWrite = new Promise<void>((resolve) => {
      resolveTerminalWrite = resolve;
    });
    mocks.writeUpdateInstallState.mockImplementation((state: UpdateInstallState) => {
      if (state.active !== null) return Promise.resolve();
      terminalWriteStarted = true;
      return terminalWrite;
    });
    const first = captureOutput();
    const second = captureOutput();

    await expect(runUpdatePreflight('0.4.0', first.options)).resolves.toBe('continue');
    child.emit('exit', 0, null);
    await Promise.resolve();

    expect(terminalWriteStarted).toBe(true);
    expect(held).toBe(true);
    expect(release).not.toHaveBeenCalled();

    await expect(runUpdatePreflight('0.4.0', second.options)).resolves.toBe('continue');

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.tryAcquireUpdateInstallLock).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();

    resolveTerminalWrite?.();
    await flushBackgroundInstall();

    expect(release).toHaveBeenCalledOnce();
    expect(held).toBe(false);
  });

  it('falls back to the foreground prompt when background startup fails', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.writeUpdateInstallState.mockRejectedValue(new Error('updates directory is read-only'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(promptForInstallChoice).toHaveBeenCalledWith(expect.objectContaining({
      target: { version: '0.5.0' },
    }));
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('tracks and logs successful background update installs', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();
    const track = vi.fn();
    const logger = captureLogger();

    await expect(runUpdatePreflight('0.4.0', { ...options, track, logger })).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(track).toHaveBeenCalledWith('update_background_install_started', expect.objectContaining({
      current_version: '0.4.0',
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(track).toHaveBeenCalledWith('update_background_install_succeeded', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
    }));
    expect(logger.info).toHaveBeenCalledWith('background update install started', expect.objectContaining({
      currentVersion: '0.4.0',
      targetVersion: '0.5.0',
      source: 'npm-global',
    }));
    expect(logger.info).toHaveBeenCalledWith('background update install succeeded', expect.objectContaining({
      targetVersion: '0.5.0',
      source: 'npm-global',
    }));
  });

  it('defaults to automatic background updates when client preferences cannot be loaded', async () => {
    mocks.loadTuiConfig.mockRejectedValue(new Error('broken tui.toml'));
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(\.cmd)?$/),
      ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
      { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
    );
  });

  it('starts only one background update when two sessions preflight concurrently', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    let acquired = false;
    mocks.tryAcquireUpdateInstallLock.mockImplementation(async () => {
      if (acquired) return null;
      acquired = true;
      return {
        filePath: '/tmp/pythinker-update-install.lock',
        release: vi.fn().mockResolvedValue(undefined),
      };
    });
    mockSpawnExit(0);
    const first = captureOutput();
    const second = captureOutput();

    await expect(Promise.all([
      runUpdatePreflight('0.4.0', first.options),
      runUpdatePreflight('0.4.0', second.options),
    ])).resolves.toEqual(['continue', 'continue']);

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('records the first background failure silently so the next launch can retry', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(1);
    const { stderr, options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(stderr.join('')).toBe('');
    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      active: null,
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        attempts: 1,
        failedAt: expect.any(String),
      }),
      lastSuccess: null,
    }));
  });

  it('records the installer stderr in the failure message', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExitWithStderr(1, 'bash: line 900: BASH_SOURCE[0]: unbound variable\n');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        // Without the installer's own text a failure is undiagnosable: the
        // exit code alone never said which line of install.sh blew up.
        message: expect.stringContaining('BASH_SOURCE[0]: unbound variable'),
      }),
    }));
  });

  it('shows why the previous automatic install failed when prompting', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    disableAutoInstall();
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-08-05T02:25:45.813Z',
        attempts: 2,
        operation: 'install',
        message: 'bash exited with code 1: BASH_SOURCE[0]: unbound variable',
      },
    }));
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(expect.objectContaining({
      previousFailure: expect.stringContaining('BASH_SOURCE[0]: unbound variable'),
    }));
  });

  it('does not surface a failure recorded against a different version', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    disableAutoInstall();
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.4.9',
        failedAt: '2026-08-05T02:25:45.813Z',
        attempts: 1,
        operation: 'install',
        message: 'stale failure from an older target',
      },
    }));
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(expect.objectContaining({
      previousFailure: undefined,
    }));
  });

  it('tracks and logs background update install failures without writing stderr', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState());
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(1);
    const { stderr, options } = captureOutput();
    const track = vi.fn();
    const logger = captureLogger();

    await expect(runUpdatePreflight('0.4.0', { ...options, track, logger })).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(stderr.join('')).toBe('');
    expect(track).toHaveBeenCalledWith('update_background_install_failed', expect.objectContaining({
      target_version: '0.5.0',
      source: 'npm-global',
      attempts: 1,
    }));
    expect(logger.warn).toHaveBeenCalledWith('background update install failed', expect.objectContaining({
      targetVersion: '0.5.0',
      source: 'npm-global',
      attempts: 1,
    }));
  });

  it('retries automatic update once after the first background failure', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-04-23T08:00:00.000Z',
        attempts: 1,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(1);
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
    await flushBackgroundInstall();

    expect(promptForInstallChoice).not.toHaveBeenCalled();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        attempts: 2,
      }),
    }));
  });

  it('prompts for manual foreground install after two background failures', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-04-23T08:00:00.000Z',
        attempts: 2,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();

    await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

    expect(promptForInstallChoice).toHaveBeenCalledWith(expect.objectContaining({
      target: { version: '0.5.0' },
      installSource: 'npm-global',
    }));
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('shows a one-shot notice after a background update succeeds and the new version starts', async () => {
    mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastSuccess: {
        version: '0.5.0',
        installedAt: '2026-04-23T08:00:00.000Z',
        notifiedAt: null,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(emptyUpdateCache());
    const { stdout, options } = captureOutput();
    const track = vi.fn();
    const logger = captureLogger();

    await expect(runUpdatePreflight('0.5.0', { ...options, track, logger })).resolves.toBe('continue');

    const rendered = stdout.join('');
    expect(rendered).toContain('Pythinker Code updated to v0.5.0');
    expect(rendered).toContain(
      'https://pythoughts-labs.github.io/pythinker-code/release-notes/changelog.html',
    );
    expect(track).toHaveBeenCalledWith('update_success_notice_shown', expect.objectContaining({
      version: '0.5.0',
      inferred_from_active: false,
    }));
    expect(logger.info).toHaveBeenCalledWith('background update success notice shown', expect.objectContaining({
      version: '0.5.0',
      inferredFromActive: false,
    }));
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      lastSuccess: expect.objectContaining({
        version: '0.5.0',
        notifiedAt: expect.any(String),
      }),
    }));
    expect(detectInstallSource).not.toHaveBeenCalled();
  });

  it('shows an explicit success notice without clearing a newer active lease', async () => {
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.7.0'));
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.6.0',
        source: 'npm-global',
        startedAt: new Date().toISOString(),
      },
      lastSuccess: {
        version: '0.5.0',
        installedAt: '2026-04-23T08:00:00.000Z',
        notifiedAt: null,
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.7.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

    expect(stdout.join('')).toContain('Pythinker Code updated to v0.5.0');
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      active: expect.objectContaining({ version: '0.6.0' }),
      lastSuccess: expect.objectContaining({
        version: '0.5.0',
        notifiedAt: expect.any(String),
      }),
    }));
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.tryAcquireUpdateInstallLock).not.toHaveBeenCalled();
  });

  it('records an abandoned install as a failure instead of inferring a success notice', async () => {
    mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: {
        version: '0.5.0',
        source: 'npm-global',
        startedAt: '2026-04-23T08:00:00.000Z',
      },
    }));
    mocks.refreshUpdateCache.mockResolvedValue(emptyUpdateCache());
    const { stdout, options } = captureOutput();

    await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

    // A stale active record is an abandoned install, not an inferred success:
    // it is reconciled into a recorded failure and never shows the notice.
    expect(stdout.join('')).toBe('');
    expect(mocks.writeJsonFile).toHaveBeenCalledWith(
      getUpdateInstallStateFile(),
      expect.anything(),
      expect.objectContaining({
        active: null,
        lastFailure: expect.objectContaining({
          version: '0.5.0',
          attempts: 1,
          message: expect.stringContaining('abandoned'),
        }),
      }),
      expect.objectContaining({ durable: true }),
    );
  });

  it('tracks update_prompted telemetry', async () => {
    disableAutoInstall();
    mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.promptForInstallChoice.mockResolvedValue('skip');
    const { options } = captureOutput();
    const track = vi.fn();
    await runUpdatePreflight('0.4.0', { ...options, track });
    expect(track).toHaveBeenCalledWith('update_prompted', expect.objectContaining({
      current: '0.4.0',
      latest: '0.5.0',
      decision: 'prompt-install',
      source: 'npm-global',
    }));
  });

  describe('rollout gating', () => {
    it('hides a cached update whose batch is not yet eligible', async () => {
      const held = cacheWithManifest(heldForEveryone('0.5.0'));
      mocks.readUpdateCache.mockResolvedValue(held);
      mocks.refreshUpdateCache.mockResolvedValue(held);
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      const { stdout, options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(stdout.join('')).toBe('');
      expect(promptForInstallChoice).not.toHaveBeenCalled();
      expect(detectInstallSource).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
      // The launch still refreshes the cache in the background so the device
      // flips to eligible purely by time passing.
      expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
      // Both checks of this launch are recorded in the rollout log.
      expect(mocks.appendRolloutDecisionLog).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'startup-cache',
        reason: 'held',
        current: '0.4.0',
        latest: '0.5.0',
        bucket: expect.any(Number),
        delaySeconds: 86_400,
        eligibleAt: expect.any(String),
      }));
      expect(mocks.appendRolloutDecisionLog).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'background-refresh',
        reason: 'held',
      }));
    });

    it('starts the background install once the device batch is eligible', async () => {
      const released = cacheWithManifest(releasedForEveryone('0.5.0'));
      mocks.readUpdateCache.mockResolvedValue(released);
      mocks.refreshUpdateCache.mockResolvedValue(released);
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExit(0);
      const { options } = captureOutput();
      const track = vi.fn();

      await expect(runUpdatePreflight('0.4.0', { ...options, track })).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(mocks.spawn).toHaveBeenCalledWith(
        expect.stringMatching(/^npm(\.cmd)?$/),
        ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
        { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      expect(track).toHaveBeenCalledWith('update_background_install_started', expect.objectContaining({
        target_version: '0.5.0',
        rollout_bucket: expect.any(Number),
        rollout_delay_seconds: 0,
        rollout_from_manifest: true,
      }));
      expect(mocks.appendRolloutDecisionLog).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'startup-cache',
        reason: 'eligible',
        target: '0.5.0',
      }));
    });

    it('prompts with rollout telemetry when eligible and auto-install is disabled', async () => {
      disableAutoInstall();
      const released = cacheWithManifest(releasedForEveryone('0.5.0'));
      mocks.readUpdateCache.mockResolvedValue(released);
      mocks.refreshUpdateCache.mockResolvedValue(released);
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mocks.promptForInstallChoice.mockResolvedValue('skip');
      const { options } = captureOutput();
      const track = vi.fn();

      await expect(runUpdatePreflight('0.4.0', { ...options, track })).resolves.toBe('continue');

      expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
        expect.objectContaining({ target: { version: '0.5.0' } }),
      );
      expect(track).toHaveBeenCalledWith('update_prompted', expect.objectContaining({
        latest: '0.5.0',
        rollout_bucket: expect.any(Number),
        rollout_delay_seconds: 0,
        rollout_from_manifest: true,
      }));
    });

    it('uses the refreshed manifest for rollout telemetry when the prompt target changes', async () => {
      disableAutoInstall();
      const cached = cacheWithManifest(manifestFor('0.6.0', {
        publishedAt: '2020-01-01T00:00:00.000Z',
        rollout: [{ percent: 100, delaySeconds: 0 }],
      }));
      const refreshed = cacheWithManifest(manifestFor('0.7.0', {
        publishedAt: '2020-01-01T00:00:00.000Z',
        rollout: [{ percent: 100, delaySeconds: 43_200 }],
      }));
      mocks.readUpdateCache.mockResolvedValue(cached);
      mocks.refreshUpdateCache.mockResolvedValue(refreshed);
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mocks.promptForInstallChoice.mockResolvedValue('skip');
      const { options } = captureOutput();
      const track = vi.fn();

      await expect(runUpdatePreflight('0.5.0', { ...options, track })).resolves.toBe('continue');

      expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
        expect.objectContaining({ target: { version: '0.7.0' } }),
      );
      expect(track).toHaveBeenCalledWith('update_prompted', expect.objectContaining({
        latest: '0.7.0',
        rollout_bucket: expect.any(Number),
        rollout_delay_seconds: 43_200,
        rollout_from_manifest: true,
      }));
    });

    it('suppresses the manual-command notice while a homebrew device batch is held', async () => {
      const held = cacheWithManifest(heldForEveryone('0.5.0'));
      mocks.readUpdateCache.mockResolvedValue(held);
      mocks.refreshUpdateCache.mockResolvedValue(held);
      mocks.detectInstallSource.mockResolvedValue('homebrew');
      const { stdout, options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(stdout.join('')).toBe('');
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

    it('does not start a fresh-check background install while the refreshed manifest is held', async () => {
      mocks.readUpdateCache.mockResolvedValue(emptyUpdateCache());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(heldForEveryone('0.5.0')));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
      expect(detectInstallSource).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

    it('stays silent when the user-visible refresh reveals a held newer version', async () => {
      disableAutoInstall();
      mocks.readUpdateCache.mockResolvedValue(cacheWithManifest(releasedForEveryone('0.6.0')));
      mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(heldForEveryone('0.7.0')));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      const { stdout, options } = captureOutput();

      await expect(runUpdatePreflight('0.5.0', options)).resolves.toBe('continue');

      expect(stdout.join('')).toBe('');
      expect(promptForInstallChoice).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

    it('PYTHINKER_CODE_EXPERIMENTAL_FLAG bypasses the rollout: held devices still update', async () => {
      vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_FLAG', '1');
      const held = cacheWithManifest(heldForEveryone('0.5.0'));
      mocks.readUpdateCache.mockResolvedValue(held);
      mocks.refreshUpdateCache.mockResolvedValue(held);
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExit(0);
      const { options } = captureOutput();
      const track = vi.fn();

      await expect(runUpdatePreflight('0.4.0', { ...options, track })).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(mocks.spawn).toHaveBeenCalledWith(
        expect.stringMatching(/^npm(\.cmd)?$/),
        ['install', '-g', '@pythoughts/pythinker-code@0.5.0'],
        { detached: true, windowsHide: false, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      expect(track).toHaveBeenCalledWith('update_background_install_started', expect.objectContaining({
        target_version: '0.5.0',
        rollout_bypassed: true,
      }));
      expect(mocks.appendRolloutDecisionLog).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'startup-cache',
        reason: 'experimental',
        target: '0.5.0',
      }));
    });

    it('PYTHINKER_CODE_NO_AUTO_UPDATE still wins over the experimental flag', async () => {
      vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_FLAG', '1');
      vi.stubEnv('PYTHINKER_CODE_NO_AUTO_UPDATE', '1');
      mocks.readUpdateCache.mockResolvedValue(cacheWithManifest(releasedForEveryone('0.5.0')));
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

      expect(readUpdateCache).not.toHaveBeenCalled();
      expect(mocks.spawn).not.toHaveBeenCalled();
    });

    it('treats any plan older than 24h as fully rolled out', async () => {
      disableAutoInstall();
      const staleRollout = manifestFor('0.5.0', {
        publishedAt: new Date(Date.now() - 25 * 3_600 * 1_000).toISOString(),
        rollout: [
          { percent: 30, delaySeconds: 0 },
          { percent: 30, delaySeconds: 43_200 },
          { percent: 40, delaySeconds: 86_400 },
        ],
      });
      mocks.readUpdateCache.mockResolvedValue(cacheWithManifest(staleRollout));
      mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(staleRollout));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mocks.promptForInstallChoice.mockResolvedValue('skip');
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');

      expect(mocks.promptForInstallChoice).toHaveBeenCalledWith(
        expect.objectContaining({ target: { version: '0.5.0' } }),
      );
    });
  });

  describe('background installer progress lines', () => {
    it('reassembles a progress line split across data events into one update', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithChunkedStderr(0, [
        'progress: state=downloading percent=4',
        '2 transferred=5320',
        '000 total=12600000\n',
      ]);
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({
            state: 'downloading',
            percent: 42,
            transferred: 5_320_000,
            total: 12_600_000,
          }),
        }),
      }));
    });

    /**
     * The exact bytes a real `install.sh` run emitted while downloading the
     * 0.9.2 release, captured from its stderr. Pinning them here means the
     * emitter and this parser cannot drift apart silently.
     */
    it('parses the bytes a real installer run actually emitted', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithStderr(
        0,
        'progress: state=downloading percent=0 transferred=0 total=55795679\n'
        + 'progress: state=downloading percent=49 transferred=27103232 total=55795679\n'
        + 'progress: state=done transferred=55795679\n',
      );
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      // All three lines arrive in one chunk, so the 2-second write throttle
      // keeps the first downloading update and drops the second; the terminal
      // state always bypasses the throttle.
      expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({
            state: 'downloading',
            percent: 0,
            transferred: 0,
            total: 55_795_679,
          }),
        }),
      }));
      expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({ state: 'done', transferred: 55_795_679 }),
        }),
      }));
    });

    /**
     * The state file is written as a temp file plus rename, so the last rename
     * wins. The installer's terminal `state=done` line writes just as the child
     * exits, so an unawaited progress write can rename over the outcome —
     * restoring `active` and dropping `lastSuccess`. The next launch reads that
     * as an abandoned install and records a failure for a version that
     * installed cleanly, which at two attempts parks it for good.
     */
    it('never lets a slow progress write rename over the install outcome', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      // Hold the progress write open; every other write settles at once.
      let releaseProgressWrite: (() => void) | undefined;
      mocks.writeUpdateInstallState.mockImplementation(
        (state: { active?: { progress?: unknown } | null }) => (
          state.active?.progress === undefined
            ? Promise.resolve()
            : new Promise<void>((resolve) => { releaseProgressWrite = resolve; })
        ),
      );
      mockSpawnExitWithStderr(0, 'progress: state=done transferred=55795679\n');
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      // The progress write is still in flight, so the outcome must not be out yet.
      expect(progressActiveStates()).toHaveLength(1);
      expect(successOutcomeStates()).toEqual([]);

      releaseProgressWrite?.();
      await flushBackgroundInstall();
      await flushBackgroundInstall();

      expect(successOutcomeStates()).toHaveLength(1);
      // The outcome is the last thing written, so it survives on disk.
      expect(mocks.writeUpdateInstallState.mock.calls.at(-1)?.[0]).toMatchObject({
        active: null,
        lastSuccess: expect.objectContaining({ version: '0.5.0' }),
      });
    });

    it('keeps progress lines out of the failure tail and ordinary stderr lines in it', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithStderr(
        1,
        'progress: state=downloading percent=42 transferred=5320000 total=12600000\n'
        + 'bash: line 900: BASH_SOURCE[0]: unbound variable\n',
      );
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      const messages = progressFailureMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('BASH_SOURCE[0]: unbound variable');
      expect(messages[0]).not.toContain('progress: state=downloading');
      expect(messages[0]).not.toContain('percent=42');
    });

    it('leaves the real error in the tail after a hundred progress lines', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      const progressLines = Array.from({ length: 100 }, (_, i) => (
        `progress: state=downloading percent=${i} transferred=${(i + 1) * 1000} total=12600000\n`
      )).join('');
      mockSpawnExitWithStderr(1, `${progressLines}npm ERR! real failure\n`);
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      const messages = progressFailureMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('npm ERR! real failure');
      expect(messages[0]).not.toContain('progress:');
      expect(messages[0]).not.toContain('percent=');
    });

    it('ignores unknown keys and non-numeric percent values without throwing', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithStderr(
        0,
        'progress: state=downloading percent=not-a-number transferred=5320000 total=12600000 mystery=1\n',
      );
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({
            state: 'downloading',
            transferred: 5_320_000,
            total: 12_600_000,
            percent: undefined,
          }),
        }),
      }));
    });

    it('accepts a downloading update without a total and without a percent', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithStderr(0, 'progress: state=downloading transferred=5320000\n');
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await flushBackgroundInstall();

      expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({
            state: 'downloading',
            transferred: 5_320_000,
            percent: undefined,
            total: undefined,
          }),
        }),
      }));
    });

    it('throttles progress writes to one per two seconds but never drops the terminal update', async () => {
      mocks.readUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.readUpdateInstallState.mockResolvedValue(installState());
      mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
      mocks.detectInstallSource.mockResolvedValue('npm-global');
      mockSpawnExitWithTimedStderr(
        0,
        [
          { atMs: 0, text: 'progress: state=downloading percent=10 transferred=1000 total=10000\n' },
          { atMs: 100, text: 'progress: state=downloading percent=20 transferred=2000 total=10000\n' },
          { atMs: 250, text: 'progress: state=done transferred=10000\n' },
        ],
        320,
      );
      const { options } = captureOutput();

      await expect(runUpdatePreflight('0.4.0', options)).resolves.toBe('continue');
      await new Promise((resolve) => setTimeout(resolve, 500));

      const progressStates = progressActiveStates();
      expect(progressStates).toHaveLength(2);
      expect(progressStates[0]).toEqual(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({ state: 'downloading', percent: 10 }),
        }),
      }));
      expect(progressStates[1]).toEqual(expect.objectContaining({
        active: expect.objectContaining({
          progress: expect.objectContaining({ state: 'done', transferred: 10_000 }),
        }),
      }));
    });
  });
});

describe('spawnForSource native', () => {
  // No spawn mock here — we run real bash to prove the failure contract
  // end-to-end. `curl … | bash` reports only the trailing bash's exit status,
  // so a curl that never connects (exit 7, empty stdin → bash exits 0) is
  // masked and the update is wrongly reported as successful. `set -o pipefail`
  // makes the pipeline surface curl's failure. Shadowing `curl` with a shell
  // function keeps this offline and deterministic; skipped on Windows (no bash
  // to run this script with).
  it.skipIf(process.platform === 'win32')(
    'surfaces a failed curl download as a non-zero exit',
    () => {
      const { cmd, args } = spawnForSource('native', '0.5.0', 'darwin');
      const script = `curl() { return 7; }\n${args[1] ?? ''}`;
      const result = spawnSync(cmd, [args[0] ?? '-c', script], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status).toBeGreaterThan(0);
    },
  );

  it('darwin/linux: unchanged bash -c pipeline', () => {
    const { cmd, args } = spawnForSource('native', '0.5.0', 'darwin');
    expect(cmd).toBe('bash');
    expect(args[0]).toBe('-c');
    expect(args[1]).toContain('curl -fsSL https://code.pythinker.com/pythinker-code/install.sh');
  });

  it('win32: powershell.exe with -ExecutionPolicy Bypass and the irm|iex install command', () => {
    const { cmd, args, env } = spawnForSource('native', '0.5.0', 'win32');
    expect(cmd).toBe('powershell.exe');
    expect(args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'irm https://code.pythinker.com/pythinker-code/install.ps1 | iex',
    ]);
    // install.ps1 reads $env:PYTHINKER_VERSION instead of fetching the CDN's
    // current latest, so the selected update version is the one installed.
    expect(env).toEqual({ PYTHINKER_VERSION: '0.5.0' });
  });

  it('darwin/linux: no version env override (install.sh has no such hook)', () => {
    const { env } = spawnForSource('native', '0.5.0', 'darwin');
    expect(env).toBeUndefined();
  });
});

describe('canAutoInstall native', () => {
  it('is true on win32 (rename-aside replace no longer needs the platform gate)', () => {
    expect(canAutoInstall('native', 'win32')).toBe(true);
  });

  it('is true on darwin/linux', () => {
    expect(canAutoInstall('native', 'darwin')).toBe(true);
    expect(canAutoInstall('native', 'linux')).toBe(true);
  });
});

describe('startManualUpdate', () => {
  beforeEach(() => {
    mocks.readUpdateInstallState.mockResolvedValue(emptyUpdateInstallState());
    mocks.writeUpdateInstallState.mockResolvedValue(undefined);
    mocks.readJsonFile.mockResolvedValue(null);
    mocks.writeJsonFile.mockResolvedValue(undefined);
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.resolveUpdateDeviceId.mockReturnValue('test-device');
    mocks.appendRolloutDecisionLog.mockResolvedValue(undefined);
    mocks.tryAcquireUpdateInstallLock.mockResolvedValue({
      filePath: '/tmp/pythinker-update-install.lock',
      release: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

  it('reports up-to-date when the registry has nothing newer', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.4.0'));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({ status: 'up-to-date' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('native: reports up-to-date when the manifest omits the running platform', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(manifestOmittingRunningTarget('0.5.0')));
    mocks.detectInstallSource.mockResolvedValue('native');

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({ status: 'up-to-date' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('native: starts a background install when the manifest advertises the running platform', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(manifestForRunningTarget('0.5.0')));
    mocks.detectInstallSource.mockResolvedValue('native');
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
    await flushBackgroundInstall();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('npm-global: still starts the update when the manifest omits the running platform', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(manifestOmittingRunningTarget('0.5.0')));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
  });

  it('starts a background install for an auto-installable source', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
    await flushBackgroundInstall();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('ignores the rollout hold — an explicit request installs immediately', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWithManifest(heldForEveryone('0.5.0')));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
  });

  it('ignores auto_install=false — the user explicitly asked to update', async () => {
    disableAutoInstall();
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
  });

  it('prepares a Homebrew update for installation on the next launch', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('homebrew');
    const child = Object.assign(new EventEmitter(), { pid: 42_424, unref: vi.fn() });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => { child.emit('spawn'); });
      return child;
    });

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: true,
    });
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        process.argv[1],
        '__update_helper',
        'prepare-homebrew',
        expect.any(String),
        '0.5.0',
        'manual',
      ],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('clears the preparation lease when the detached helper cannot start', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('homebrew');
    mocks.spawn.mockImplementation(() => { throw new Error('spawn failed'); });

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'check-failed',
      message: 'spawn failed',
    });
    expect(writeUpdateInstallState).toHaveBeenLastCalledWith(expect.objectContaining({
      active: null,
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        operation: 'prepare',
        message: 'spawn failed',
      }),
    }));
  });

  it('promotes a prepared automatic update when the user explicitly requests it', async () => {
    const pending = preparedHomebrewUpdate();
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('homebrew');
    mocks.readUpdateInstallState.mockResolvedValue(installState({ pending }));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.5.0',
      installOnRestart: true,
      readyToInstall: true,
    });
    expect(writeUpdateInstallState).toHaveBeenCalledWith(expect.objectContaining({
      pending: { ...pending, requestedBy: 'manual' },
    }));
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reports an install already in progress instead of double-starting', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: { version: '0.5.0', source: 'npm-global', startedAt: new Date().toISOString() },
    }));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.5.0',
      installOnRestart: false,
      readyToInstall: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reports both the running older install and the newer target it will follow', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.11.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: { version: '0.10.0', source: 'npm-global', startedAt: new Date().toISOString() },
    }));

    await expect(startManualUpdate('0.9.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.10.0',
      targetVersion: '0.11.0',
      installOnRestart: false,
      readyToInstall: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('does not claim the target supersedes an active install of a newer version', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.10.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: { version: '0.11.0', source: 'npm-global', startedAt: new Date().toISOString() },
    }));

    await expect(startManualUpdate('0.9.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.11.0',
      installOnRestart: false,
      readyToInstall: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('keeps installOnRestart for a fresh homebrew active install', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('homebrew');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: { version: '0.5.0', source: 'homebrew', startedAt: new Date().toISOString() },
    }));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.5.0',
      installOnRestart: true,
      readyToInstall: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reports a parked version as failed with the recorded attempts and reason', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-08-05T08:00:00.000Z',
        attempts: 2,
        operation: 'install',
        message: 'npm exited with code 1',
      },
    }));

    const result = await startManualUpdate('0.4.0');
    expect(result).toEqual({
      status: 'failed',
      version: '0.5.0',
      attempts: 2,
      failedAt: '2026-08-05T08:00:00.000Z',
      message: 'npm exited with code 1',
      command: 'npm install -g @pythoughts/pythinker-code@0.5.0',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('still attempts the install one failure below the parked threshold', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-08-05T08:00:00.000Z',
        attempts: 1,
        message: 'npm exited with code 1',
      },
    }));
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
    await flushBackgroundInstall();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('still attempts the install when the parked failures belong to another version', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.4.1',
        failedAt: '2026-08-05T08:00:00.000Z',
        attempts: 2,
        message: 'npm exited with code 1',
      },
    }));
    mockSpawnExit(0);

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'started',
      version: '0.5.0',
      installOnRestart: false,
    });
    await flushBackgroundInstall();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('reports in-progress when a fresh install runs despite a parked failure', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      active: { version: '0.5.0', source: 'npm-global', startedAt: new Date().toISOString() },
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-08-05T08:00:00.000Z',
        attempts: 2,
        message: 'npm exited with code 1',
      },
    }));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'in-progress',
      installingVersion: '0.5.0',
      installOnRestart: false,
      readyToInstall: false,
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('omits the reason when the recorded failure carries none', async () => {
    mocks.refreshUpdateCache.mockResolvedValue(cacheWith('0.5.0'));
    mocks.detectInstallSource.mockResolvedValue('npm-global');
    mocks.readUpdateInstallState.mockResolvedValue(installState({
      lastFailure: {
        version: '0.5.0',
        failedAt: '2026-08-05T08:00:00.000Z',
        attempts: 2,
      },
    }));

    const result = await startManualUpdate('0.4.0');
    expect(result).toEqual({
      status: 'failed',
      version: '0.5.0',
      attempts: 2,
      failedAt: '2026-08-05T08:00:00.000Z',
      command: 'npm install -g @pythoughts/pythinker-code@0.5.0',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reports check-failed when the registry refresh fails', async () => {
    mocks.refreshUpdateCache.mockRejectedValue(new Error('offline'));

    await expect(startManualUpdate('0.4.0')).resolves.toEqual({
      status: 'check-failed',
      message: 'offline',
    });
  });
});
