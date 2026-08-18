import { execFileSync } from 'node:child_process';

import type { createPythinkerDeviceId as createPythinkerDeviceIdFn } from '@pymodel/pythinker-code-oauth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runShell } from '#/cli/run-shell';

import { captureProcessWrite, ExitCalled, mockProcessExit } from '../helpers/process';

type CreatePythinkerDeviceId = typeof createPythinkerDeviceIdFn;

const mocks = vi.hoisted(() => {
  type TuiConfigFallback = {
    theme: 'dark' | 'light' | 'auto';
    editorCommand: string | null;
    notifications: { enabled: boolean; condition: 'unfocused' | 'always' };
  };

  class TuiConfigParseError extends Error {
    readonly fallback: TuiConfigFallback;

    constructor(fallback: TuiConfigFallback) {
      super('Invalid TUI config in ~/.pythinker-code/tui.toml; using defaults.');
      this.fallback = fallback;
    }
  }

  const lifecycleTrack = vi.fn();

  return {
    loadTuiConfig: vi.fn(),
    detectTerminalTheme: vi.fn(),
    pythinkerHarnessConstructor: vi.fn(),
    pythinkerHarnessV2Constructor: vi.fn(),
    harnessEnsureConfigFile: vi.fn(),
    harnessGetConfig: vi.fn(async () => ({
      providers: {},
      defaultModel: 'k2',
      telemetry: true,
    })),
    harnessGetConfigDiagnostics: vi.fn(async () => ({ warnings: [] as readonly string[] })),
    harnessGetCachedAccessToken: vi.fn(),
    harnessClose: vi.fn(),
    detectPendingMigration: vi.fn<() => Promise<unknown>>(async () => null),
    harnessTrack: vi.fn(),
    pythinkerTuiConstructor: vi.fn(),
    tuiStart: vi.fn(),
    tuiGetStartupMcpMs: vi.fn(async () => 0),
    tuiGetCurrentSessionId: vi.fn(() => ''),
    tuiHasSessionContent: vi.fn(() => false),
    createPythinkerDeviceId: vi.fn<CreatePythinkerDeviceId>(() => 'device-1'),
    initializeTelemetry: vi.fn(),
    setCrashPhase: vi.fn(),
    shutdownTelemetry: vi.fn(),
    telemetryTrack: vi.fn(),
    setTelemetryContext: vi.fn(),
    lifecycleTrack,
    withTelemetryContext: vi.fn(() => ({
      track: lifecycleTrack,
    })),
    resolvePythinkerHome: vi.fn((homeDir?: string) => homeDir ?? '/tmp/pythinker-code-test-home'),
    flushDiagnosticLogsSync: vi.fn(),
    harnessCreatesDeviceIdOnConstruction: false,
    execFileSync: vi.fn(() => ''),
    spawnSync: vi.fn(),
    resolveCommandPath: vi.fn(() => '/bin/stty' as string | undefined),
    TuiConfigParseError,
  };
});

vi.mock('@pymodel/pythinker-code-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pymodel/pythinker-code-sdk')>();
  const makeHarnessStub = (args: unknown[]) => {
    const options = args[0] as { readonly homeDir?: string } | undefined;
    const homeDir = options?.homeDir ?? '/tmp/pythinker-code-test-home';
    return {
      homeDir,
      auth: {
        getCachedAccessToken: mocks.harnessGetCachedAccessToken,
      },
      ensureConfigFile: mocks.harnessEnsureConfigFile,
      getConfig: mocks.harnessGetConfig,
      getConfigDiagnostics: mocks.harnessGetConfigDiagnostics,
      close: mocks.harnessClose,
      track: mocks.harnessTrack,
    };
  };
  return {
    ...actual,
    resolvePythinkerHome: mocks.resolvePythinkerHome,
    flushDiagnosticLogsSync: mocks.flushDiagnosticLogsSync,
    createPythinkerHarness: (...args: unknown[]) => {
      const options = args[0] as { readonly homeDir?: string } | undefined;
      const homeDir = options?.homeDir ?? '/tmp/pythinker-code-test-home';
      if (mocks.harnessCreatesDeviceIdOnConstruction) {
        mocks.createPythinkerDeviceId(homeDir);
      }
      mocks.pythinkerHarnessConstructor(...args);
      return makeHarnessStub(args);
    },
    createPythinkerHarnessV2: (...args: unknown[]) => {
      mocks.pythinkerHarnessV2Constructor(...args);
      return makeHarnessStub(args);
    },
  };
});

vi.mock('@pymodel/pythinker-code-oauth', async () => {
  const actual = await vi.importActual<typeof import('@pymodel/pythinker-code-oauth')>(
    '@pymodel/pythinker-code-oauth',
  );
  return {
    ...actual,
    createPythinkerDeviceId: mocks.createPythinkerDeviceId,
    PYTHINKER_CODE_PROVIDER_NAME: 'pythinker-code',
  };
});

vi.mock('@pymodel/pythinker-telemetry', () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  setCrashPhase: mocks.setCrashPhase,
  shutdownTelemetry: mocks.shutdownTelemetry,
  track: mocks.telemetryTrack,
  setTelemetryContext: mocks.setTelemetryContext,
  withTelemetryContext: mocks.withTelemetryContext,
}));

vi.mock('../../src/tui/config', () => ({
  loadTuiConfig: mocks.loadTuiConfig,
  TuiConfigParseError: mocks.TuiConfigParseError,
}));

vi.mock('../../src/tui/index', () => ({
  PythinkerTUI: class {
    onExit?: () => Promise<void>;

    readonly state = { ui: { mode: 'regular' as const } };

    constructor(...args: unknown[]) {
      mocks.pythinkerTuiConstructor(this, ...args);
    }

    start = mocks.tuiStart;
    getStartupMcpMs = mocks.tuiGetStartupMcpMs;
    getCurrentSessionId = mocks.tuiGetCurrentSessionId;
    hasSessionContent = mocks.tuiHasSessionContent;
  },
}));

vi.mock('../../src/tui/theme/detect', () => ({
  detectTerminalTheme: mocks.detectTerminalTheme,
}));

vi.mock('../../src/migration/index', () => ({
  detectPendingMigration: mocks.detectPendingMigration,
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
  spawnSync: mocks.spawnSync,
}));

vi.mock('../../src/utils/process/resolve-command', () => ({
  resolveCommandPath: mocks.resolveCommandPath,
}));

describe('runShell', () => {
  beforeEach(() => {
    vi.stubEnv('PYTHINKER_CODE_LEGACY_FLAG', '1');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.harnessGetConfig.mockResolvedValue({
      providers: {},
      defaultModel: 'k2',
      telemetry: true,
    });
    mocks.tuiGetStartupMcpMs.mockResolvedValue(0);
    mocks.tuiGetCurrentSessionId.mockReturnValue('');
    mocks.tuiHasSessionContent.mockReturnValue(false);
    mocks.createPythinkerDeviceId.mockImplementation(() => 'device-1');
    mocks.resolvePythinkerHome.mockImplementation(
      (homeDir?: string) => homeDir ?? '/tmp/pythinker-code-test-home',
    );
    mocks.resolveCommandPath.mockImplementation(() => '/bin/stty');
    mocks.harnessCreatesDeviceIdOnConstruction = false;
  });

  const minimalCliOptions = {
    session: undefined,
    continue: false,
    yolo: false,
    auto: false,
    plan: false,
    model: undefined,
    outputFormat: undefined,
    prompt: undefined,
    skillsDirs: [],
    agent: undefined,
    agentFiles: [],
  };

  function stubTuiStartup(): void {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
  }

  function withEnv(patch: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) {
      saved[key] = process.env[key];
      const value = patch[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return fn().finally(() => {
      for (const key of Object.keys(patch)) {
        const value = saved[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
  }

  it('builds the v2 harness by default', async () => {
    stubTuiStartup();
    await withEnv(
      { PYTHINKER_CODE_LEGACY_FLAG: undefined, PYTHINKER_CODE_EXPERIMENTAL_FLAG: undefined },
      async () => {
        await runShell(minimalCliOptions, '1.2.3-test');
      },
    );
    expect(mocks.pythinkerHarnessV2Constructor).toHaveBeenCalledTimes(1);
    expect(mocks.pythinkerHarnessConstructor).not.toHaveBeenCalled();
  });

  it('uses the legacy harness when the legacy flag is truthy', async () => {
    stubTuiStartup();
    await withEnv({ PYTHINKER_CODE_LEGACY_FLAG: '1' }, async () => {
      await runShell(minimalCliOptions, '1.2.3-test');
    });
    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.pythinkerHarnessV2Constructor).not.toHaveBeenCalled();
  });

  it('lets the legacy flag take priority over the experimental master switch', async () => {
    stubTuiStartup();
    await withEnv(
      { PYTHINKER_CODE_LEGACY_FLAG: '1', PYTHINKER_CODE_EXPERIMENTAL_FLAG: '1' },
      async () => {
        await runShell(minimalCliOptions, '1.2.3-test');
      },
    );
    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.pythinkerHarnessV2Constructor).not.toHaveBeenCalled();
  });

  it('constructs PythinkerHarness and PythinkerTUI with startup input', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.tuiGetStartupMcpMs.mockResolvedValue(47);
    mocks.tuiGetCurrentSessionId.mockReturnValue('ses-startup');

    const cliOptions = {
      session: undefined,
      continue: false,
      yolo: true,
      auto: false,
      plan: true,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
      agent: undefined,
      agentFiles: [],
      addDirs: ['../shared', '/tmp/extra'],
    };

    await runShell(cliOptions, '1.2.3-test');

    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          productName: 'pythinker-code-cli',
          version: '1.2.3-test',
        }),
        sessionStartedProperties: { yolo: true, auto: false, plan: true, afk: false },
      }),
    );
    expect(mocks.harnessEnsureConfigFile).toHaveBeenCalledOnce();
    expect(mocks.harnessEnsureConfigFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.harnessGetConfig.mock.invocationCallOrder[0]!,
    );
    // stty is resolved to an absolute path before the trust gate and skipped
    // entirely on Windows (a bare `stty` name would resolve into the
    // untrusted cwd).
    if (process.platform !== 'win32') {
      expect(execFileSync).toHaveBeenCalledWith('/bin/stty', ['-ixon'], {
        stdio: ['inherit', 'ignore', 'ignore'],
      });
    } else {
      expect(execFileSync).not.toHaveBeenCalled();
    }
    expect(mocks.pythinkerTuiConstructor).toHaveBeenCalledTimes(1);
    expect(mocks.createPythinkerDeviceId).toHaveBeenCalledWith(
      '/tmp/pythinker-code-test-home',
      expect.any(Object),
    );
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith({
      homeDir: '/tmp/pythinker-code-test-home',
      deviceId: 'device-1',
      enabled: true,
      appName: 'pythinker-code-cli',
      version: '1.2.3-test',
      uiMode: 'shell',
      model: 'k2',
      sessionId: undefined,
      getAccessToken: expect.any(Function),
    });
    expect(mocks.setCrashPhase).toHaveBeenCalledWith('runtime');

    const [, harness, startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(harness).toBeTypeOf('object');
    expect(startupInput).toMatchObject({
      cliOptions,
      additionalDirs: ['../shared', '/tmp/extra'],
      tuiConfig: {
        theme: 'dark',
        editorCommand: null,
        notifications: { enabled: true, condition: 'unfocused' },
      },
      version: '1.2.3-test',
      workDir: process.cwd(),
    });
    expect(mocks.tuiStart).toHaveBeenCalledOnce();
    expect(mocks.withTelemetryContext).toHaveBeenCalledWith({ sessionId: 'ses-startup' });
    expect(mocks.lifecycleTrack).toHaveBeenCalledWith('startup_perf', {
      duration_ms: expect.any(Number),
      config_ms: expect.any(Number),
      init_ms: expect.any(Number),
      mcp_ms: 47,
      tui_mode: 'regular',
    });
  });

  it('never runs stty on Windows, where it would resolve into the untrusted cwd', async () => {
    stubTuiStartup();
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await runShell(minimalCliOptions, '1.2.3-test');
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('skips stty when it cannot be resolved outside the untrusted cwd', async () => {
    stubTuiStartup();
    if (process.platform === 'win32') return;
    mocks.resolveCommandPath.mockReturnValue(undefined);
    await runShell(minimalCliOptions, '1.2.3-test');
    expect(mocks.resolveCommandPath).toHaveBeenCalledWith('stty');
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('resolves the --agent profile into the TUI startup input', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: 'reviewer',
        agentFiles: [],
      },
      '1.2.3-test',
    );

    const [, , startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(startupInput).toMatchObject({ agentProfile: 'reviewer' });
  });

  it('forwards skillsDirs from CLI options to the harness', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: ['/skills'],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ skillDirs: ['/skills'] }),
    );
  });

  it('tracks first launch when device id creation reports first launch', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.createPythinkerDeviceId.mockImplementationOnce((homeDir, options) => {
      const deviceId = `device-for-${homeDir}`;
      options?.onFirstLaunch?.(deviceId);
      return deviceId;
    });

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    expect(mocks.createPythinkerDeviceId).toHaveBeenCalledWith(
      '/tmp/pythinker-code-test-home',
      expect.objectContaining({ onFirstLaunch: expect.any(Function) }),
    );
    expect(mocks.harnessTrack).toHaveBeenCalledWith('first_launch');
  });

  it('registers first launch before harness construction can create the device id', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.harnessCreatesDeviceIdOnConstruction = true;
    const createdHomes = new Set<string>();
    mocks.createPythinkerDeviceId.mockImplementation((homeDir, options) => {
      const deviceId = `device-for-${homeDir}`;
      if (!createdHomes.has(homeDir)) {
        createdHomes.add(homeDir);
        options?.onFirstLaunch?.(deviceId);
      }
      return deviceId;
    });

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    expect(mocks.createPythinkerDeviceId).toHaveBeenNthCalledWith(
      1,
      '/tmp/pythinker-code-test-home',
      expect.objectContaining({ onFirstLaunch: expect.any(Function) }),
    );
    expect(mocks.createPythinkerDeviceId.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pythinkerHarnessConstructor.mock.invocationCallOrder[0]!,
    );
    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ homeDir: '/tmp/pythinker-code-test-home' }),
    );
    expect(mocks.harnessTrack).toHaveBeenCalledWith('first_launch');
  });

  it('binds startup_perf to the session captured before MCP metrics resolve', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    let currentSessionId = 'ses-startup';
    mocks.tuiGetCurrentSessionId.mockImplementation(() => currentSessionId);
    mocks.tuiGetStartupMcpMs.mockImplementation(async () => {
      currentSessionId = 'ses-later';
      return 47;
    });

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    expect(mocks.withTelemetryContext).toHaveBeenCalledWith({ sessionId: 'ses-startup' });
    expect(mocks.withTelemetryContext).not.toHaveBeenCalledWith({ sessionId: 'ses-later' });
    expect(mocks.lifecycleTrack).toHaveBeenCalledWith('startup_perf', {
      duration_ms: expect.any(Number),
      config_ms: expect.any(Number),
      init_ms: expect.any(Number),
      mcp_ms: 47,
      tui_mode: 'regular',
    });
  });

  it('bridges OAuth refresh outcomes to telemetry', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: undefined,
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    const [harnessOptions] = mocks.pythinkerHarnessConstructor.mock.calls[0] as [
      {
        readonly onOAuthRefresh: (
          outcome:
            | { readonly success: true }
            | { readonly success: false; readonly reason: 'unauthorized' | 'network_or_other' },
        ) => void;
      },
    ];

    harnessOptions.onOAuthRefresh({ success: true });
    harnessOptions.onOAuthRefresh({ success: false, reason: 'unauthorized' });
    harnessOptions.onOAuthRefresh({ success: false, reason: 'network_or_other' });

    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', { outcome: 'success' });
    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', {
      outcome: 'error',
      reason: 'unauthorized',
    });
    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', {
      outcome: 'error',
      reason: 'network_or_other',
    });
  });

  it('detects auto theme and forwards config parse warnings as startup notice', async () => {
    mocks.loadTuiConfig.mockRejectedValue(
      new mocks.TuiConfigParseError({
        theme: 'auto',
        editorCommand: 'vim',
        notifications: { enabled: true, condition: 'always' },
      }),
    );
    mocks.detectTerminalTheme.mockResolvedValue('light');
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: '',
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    expect(mocks.detectTerminalTheme).toHaveBeenCalledOnce();
    const [, , startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(startupInput).toMatchObject({
      startupNotice: 'Invalid TUI config in ~/.pythinker-code/tui.toml; using defaults.',
      tuiConfig: {
        theme: 'auto',
        editorCommand: 'vim',
        notifications: { enabled: true, condition: 'always' },
      },
    });
  });

  it('leaves config.toml diagnostics to the TUI instead of the startup notice', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.harnessGetConfigDiagnostics.mockResolvedValue({
      warnings: ['Ignored invalid config in config.toml: loop_control.'],
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: '',
        continue: false,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
        agent: undefined,
        agentFiles: [],
      },
      '1.2.3-test',
    );

    // Diagnostics render in warning yellow via `showConfigWarningsIfAny` at
    // `finishStartup`; the (dim) startup notice stays reserved for things like
    // tui.toml parse errors, so the same warning is not shown twice.
    const [, , startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(startupInput).toMatchObject({
      startupNotice: undefined,
    });
  });

  it('flushes diagnostic logs synchronously before exiting on a runtime crash', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    const processOnSpy = vi.spyOn(process, 'on');
    const stdout = captureProcessWrite('stdout');
    const exitSpy = mockProcessExit();

    try {
      await runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
      );

      const handler = processOnSpy.mock.calls.find(
        ([event]) => event === 'uncaughtException',
      )?.[1] as ((error: unknown) => void) | undefined;
      expect(handler).toBeDefined();

      // The async log sink cannot flush before process.exit() runs, so the
      // crash handler must force a synchronous flush or the crash reason is
      // lost (regression: uncaughtException logs never reached disk).
      expect(() => handler?.(new Error('boom'))).toThrow(ExitCalled);
      expect(mocks.flushDiagnosticLogsSync).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mocks.flushDiagnosticLogsSync.mock.invocationCallOrder[0]!).toBeLessThan(
        exitSpy.mock.invocationCallOrder[0]!,
      );
    } finally {
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
      stdout.restore();
    }
  });

  it('flushes diagnostic logs synchronously before exiting on an unhandled rejection', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    const processOnSpy = vi.spyOn(process, 'on');
    const stdout = captureProcessWrite('stdout');
    const exitSpy = mockProcessExit();

    try {
      await runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
      );

      const handler = processOnSpy.mock.calls.find(
        ([event]) => event === 'unhandledRejection',
      )?.[1] as ((reason: unknown) => void) | undefined;
      expect(handler).toBeDefined();

      expect(() => handler?.(new Error('boom'))).toThrow(ExitCalled);
      expect(mocks.flushDiagnosticLogsSync).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mocks.flushDiagnosticLogsSync.mock.invocationCallOrder[0]!).toBeLessThan(
        exitSpy.mock.invocationCallOrder[0]!,
      );
    } finally {
      processOnSpy.mockRestore();
      exitSpy.mockRestore();
      stdout.restore();
    }
  });

  it('closes the harness when TUI startup fails', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockRejectedValue(new Error('boom'));

    await expect(
      runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
      ),
    ).rejects.toThrow('boom');

    expect(mocks.setCrashPhase).toHaveBeenCalledWith('shutdown');
    expect(mocks.harnessTrack).toHaveBeenCalledWith('exit', {
      duration_ms: expect.any(Number),
      tui_mode: 'regular',
    });
    expect(mocks.shutdownTelemetry).toHaveBeenCalledOnce();
    expect(mocks.harnessClose).toHaveBeenCalledOnce();
  });

  it('tracks exit and prints resume instructions from the TUI exit handler', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.tuiGetCurrentSessionId.mockReturnValue('ses-1');
    mocks.tuiHasSessionContent.mockReturnValue(true);

    const stdout = captureProcessWrite('stdout');
    const stderr = captureProcessWrite('stderr');
    const exitSpy = mockProcessExit();

    try {
      await runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
      );
      const [tui] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
      mocks.harnessTrack.mockClear();
      mocks.lifecycleTrack.mockClear();
      mocks.withTelemetryContext.mockClear();

      await expect((tui as { onExit: () => Promise<void> }).onExit()).rejects.toBeInstanceOf(
        ExitCalled,
      );

      expect(mocks.setCrashPhase).toHaveBeenCalledWith('shutdown');
      expect(mocks.withTelemetryContext).toHaveBeenCalledWith({ sessionId: 'ses-1' });
      expect(mocks.lifecycleTrack).toHaveBeenCalledWith('exit', {
        duration_ms: expect.any(Number),
        tui_mode: 'regular',
      });
      expect(mocks.harnessTrack).not.toHaveBeenCalledWith('exit', expect.anything());
      expect(mocks.shutdownTelemetry).toHaveBeenCalledOnce();
      expect(stdout.text()).toBe(' Bye!\n');
      expect(stderr.text()).toContain(' To resume this session: pythinker -r ses-1');
    } finally {
      exitSpy.mockRestore();
      stdout.restore();
      stderr.restore();
    }
  });

  it('prints the opened web URL from the TUI exit handler when set', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.tuiGetCurrentSessionId.mockReturnValue('ses-1');
    mocks.tuiHasSessionContent.mockReturnValue(true);

    const stdout = captureProcessWrite('stdout');
    const stderr = captureProcessWrite('stderr');
    const exitSpy = mockProcessExit();

    try {
      await runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
      );
      const [tui] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
      const openedUrl = 'http://127.0.0.1:58627/sessions/ses-1#token=tok-1';
      (tui as { exitOpenUrl?: string }).exitOpenUrl = openedUrl;

      await expect((tui as { onExit: () => Promise<void> }).onExit()).rejects.toBeInstanceOf(
        ExitCalled,
      );

      expect(stderr.text()).toContain(' To resume this session: pythinker -r ses-1');
      expect(stderr.text()).toContain('open ');
      expect(stderr.text()).toContain(openedUrl);
    } finally {
      exitSpy.mockRestore();
      stdout.restore();
      stderr.restore();
    }
  });

  it('surfaces an invalid target config as an error for pythinker migrate, not silently', async () => {
    mocks.loadTuiConfig.mockResolvedValue({
      theme: 'dark',
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
    });
    mocks.detectPendingMigration.mockResolvedValue({ totalSessions: 1 });
    mocks.harnessGetConfig.mockRejectedValue(
      new Error('Invalid configuration in ~/.pythinker-code/config.toml'),
    );

    // A broken config.toml must fail loudly — `pythinker migrate` must not swallow
    // it and proceed, or the user never learns their config is broken.
    await expect(
      runShell(
        {
          session: undefined,
          continue: false,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
          agent: undefined,
          agentFiles: [],
        },
        '1.2.3-test',
        { migrateOnly: true },
      ),
    ).rejects.toThrow('Invalid configuration');
    expect(mocks.tuiStart).not.toHaveBeenCalled();
  });
});
