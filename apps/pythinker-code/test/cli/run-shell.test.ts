import { execSync } from 'node:child_process';

import type { createPythinkerDeviceId as createPythinkerDeviceIdFn } from '@pythoughts/pythinker-code-oauth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runShell } from '#/cli/run-shell';
import {
  DEFAULT_STATUS_LINE_CONFIG,
  type TuiConfig,
} from '#/tui/config';

import { captureProcessWrite, ExitCalled, mockProcessExit } from '../helpers/process';

type CreatePythinkerDeviceId = typeof createPythinkerDeviceIdFn;

const mocks = vi.hoisted(() => {
  class TuiConfigParseError extends Error {
    readonly fallback: TuiConfig;

    constructor(fallback: TuiConfig) {
      super('Invalid TUI config in ~/.pythinker-code/tui.toml; using defaults.');
      this.fallback = fallback;
    }
  }

  const lifecycleTrack = vi.fn();

  return {
    loadTuiConfig: vi.fn(),
    detectTerminalTheme: vi.fn(),
    pythinkerHarnessConstructor: vi.fn(),
    harnessEnsureConfigFile: vi.fn(),
    harnessGetConfig: vi.fn(async () => ({
      providers: {},
      defaultModel: 'k2',
      telemetry: true,
    })),
    harnessGetConfigDiagnostics: vi.fn(async () => ({ warnings: [] as readonly string[] })),
    harnessGetCachedAccessToken: vi.fn(),
    harnessCreateSession: vi.fn(),
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
    harnessCreatesDeviceIdOnConstruction: false,
    execSync: vi.fn(),
    TuiConfigParseError,
  };
});

function tuiConfig(overrides: Partial<TuiConfig> = {}): TuiConfig {
  return {
    theme: 'dark',
    layout: 'fixed',
    copyFullResponse: false,
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    ...overrides,
    statusLine: overrides.statusLine ?? DEFAULT_STATUS_LINE_CONFIG,
  };
}

vi.mock('@pythoughts/pythinker-code-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pythoughts/pythinker-code-sdk')>();
  return {
    ...actual,
    resolvePythinkerHome: mocks.resolvePythinkerHome,
    createPythinkerHarness: (...args: unknown[]) => {
      const options = args[0] as { readonly homeDir?: string } | undefined;
      const homeDir = options?.homeDir ?? '/tmp/pythinker-code-test-home';
      if (mocks.harnessCreatesDeviceIdOnConstruction) {
        mocks.createPythinkerDeviceId(homeDir);
      }
      mocks.pythinkerHarnessConstructor(...args);
      return {
        homeDir,
        auth: {
          getCachedAccessToken: mocks.harnessGetCachedAccessToken,
        },
        ensureConfigFile: mocks.harnessEnsureConfigFile,
        getConfig: mocks.harnessGetConfig,
        getConfigDiagnostics: mocks.harnessGetConfigDiagnostics,
        createSession: mocks.harnessCreateSession,
        close: mocks.harnessClose,
        track: mocks.harnessTrack,
      };
    },
  };
});

vi.mock('@pythoughts/pythinker-code-oauth', async () => {
  const actual = await vi.importActual<typeof import('@pythoughts/pythinker-code-oauth')>(
    '@pythoughts/pythinker-code-oauth',
  );
  return {
    ...actual,
    createPythinkerDeviceId: mocks.createPythinkerDeviceId,
    KIMI_CODE_PROVIDER_NAME: 'pythinker-code',
  };
});

vi.mock('@pythoughts/pythinker-telemetry', () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  setCrashPhase: mocks.setCrashPhase,
  shutdownTelemetry: mocks.shutdownTelemetry,
  track: mocks.telemetryTrack,
  setTelemetryContext: mocks.setTelemetryContext,
  withTelemetryContext: mocks.withTelemetryContext,
}));

vi.mock('../../src/tui/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/tui/config.js')>(
    '../../src/tui/config.js',
  );
  return {
    ...actual,
    loadTuiConfig: mocks.loadTuiConfig,
    TuiConfigParseError: mocks.TuiConfigParseError,
  };
});

vi.mock('../../src/tui/index', () => ({
  PythinkerTUI: class {
    onExit?: () => Promise<void>;

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
  execSync: mocks.execSync,
}));

describe('runShell', () => {
  afterEach(() => {
    vi.clearAllMocks();
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
    mocks.harnessCreatesDeviceIdOnConstruction = false;
  });

  it('constructs PythinkerHarness and PythinkerTUI with startup input', async () => {
    const loadedTuiConfig = tuiConfig({
      statusLine: {
        ...DEFAULT_STATUS_LINE_CONFIG,
        showGit: false,
        showModes: false,
      },
    });
    mocks.loadTuiConfig.mockResolvedValue(loadedTuiConfig);
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.tuiGetStartupMcpMs.mockResolvedValue(47);
    mocks.tuiGetCurrentSessionId.mockReturnValue('ses-startup');

    const cliOptions = {
      session: undefined,
      continue: false,
      rewindFiles: undefined,
      yolo: true,
      auto: false,
      plan: true,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
      skillsDirs: [],
    };

    await runShell(cliOptions, '1.2.3-test');

    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          userAgentProduct: 'pythinker-code-cli',
          version: '1.2.3-test',
        }),
      }),
    );
    expect(mocks.harnessEnsureConfigFile).toHaveBeenCalledOnce();
    expect(mocks.harnessEnsureConfigFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.harnessGetConfig.mock.invocationCallOrder[0]!,
    );
    expect(execSync).toHaveBeenCalledWith('stty -ixon', { stdio: 'ignore' });
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
      getAccessToken: expect.any(Function),
    });
    expect(mocks.setCrashPhase).toHaveBeenCalledWith('runtime');

    const [, harness, startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(harness).toBeTypeOf('object');
    expect(startupInput).toMatchObject({
      cliOptions,
      version: '1.2.3-test',
      workDir: process.cwd(),
    });
    expect(startupInput.tuiConfig).toEqual(loadedTuiConfig);
    expect(mocks.tuiStart).toHaveBeenCalledOnce();
    expect(mocks.harnessTrack).not.toHaveBeenCalledWith('started', expect.anything());
    expect(mocks.withTelemetryContext).toHaveBeenCalledWith({ sessionId: 'ses-startup' });
    expect(mocks.lifecycleTrack).toHaveBeenCalledWith('started', {
      resumed: false,
      yolo: true,
      auto: false,
      plan: true,
      afk: false,
    });
    expect(mocks.lifecycleTrack).toHaveBeenCalledWith('startup_perf', {
      duration_ms: expect.any(Number),
      config_ms: expect.any(Number),
      init_ms: expect.any(Number),
      mcp_ms: 47,
    });
  });

  it('runs init and startup hooks without mounting the TUI in init-only mode', async () => {
    await runShell(
      {
        session: undefined,
        continue: false,
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        init: false,
        initOnly: true,
        maintenance: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
      },
      '1.2.3-test',
    );

    expect(mocks.harnessCreateSession).toHaveBeenCalledWith({
      workDir: process.cwd(),
      model: 'k2',
      setupTrigger: 'init',
    });
    expect(mocks.harnessClose).toHaveBeenCalledOnce();
    expect(mocks.pythinkerTuiConstructor).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it('tracks first launch when device id creation reports first launch', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
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
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
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

  it('marks resumed lifecycle starts from session flags', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.tuiStart.mockResolvedValue(undefined);
    mocks.tuiGetCurrentSessionId.mockReturnValue('ses-1');

    await runShell(
      {
        session: 'ses-1',
        continue: false,
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
      },
      '1.2.3-test',
    );

    expect(mocks.lifecycleTrack).toHaveBeenCalledWith('started', {
      resumed: true,
      yolo: false,
      auto: false,
      plan: false,
      afk: false,
    });
  });

  it('binds startup_perf to the session captured before MCP metrics resolve', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
      },
      '1.2.3-test',
    );

    expect(mocks.withTelemetryContext).toHaveBeenNthCalledWith(1, { sessionId: 'ses-startup' });
    expect(mocks.withTelemetryContext).toHaveBeenNthCalledWith(2, { sessionId: 'ses-startup' });
    expect(mocks.lifecycleTrack).toHaveBeenNthCalledWith(2, 'startup_perf', {
      duration_ms: expect.any(Number),
      config_ms: expect.any(Number),
      init_ms: expect.any(Number),
      mcp_ms: 47,
    });
  });

  it('bridges OAuth refresh outcomes to telemetry', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: undefined,
        continue: false,
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
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

    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', { success: true });
    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', {
      success: false,
      reason: 'unauthorized',
    });
    expect(mocks.telemetryTrack).toHaveBeenCalledWith('oauth_refresh', {
      success: false,
      reason: 'network_or_other',
    });
  });

  it('detects auto theme and forwards config parse warnings as startup notice', async () => {
    const fallbackTuiConfig = tuiConfig({
      theme: 'auto',
      editorCommand: 'vim',
      notifications: { enabled: true, condition: 'always' },
    });
    mocks.loadTuiConfig.mockRejectedValue(
      new mocks.TuiConfigParseError(fallbackTuiConfig),
    );
    mocks.detectTerminalTheme.mockResolvedValue('light');
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: '',
        continue: false,
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
      },
      '1.2.3-test',
    );

    expect(mocks.detectTerminalTheme).toHaveBeenCalledOnce();
    const [, , startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(startupInput).toMatchObject({
      startupNotice: 'Invalid TUI config in ~/.pythinker-code/tui.toml; using defaults.',
    });
    expect(startupInput.tuiConfig).toEqual(fallbackTuiConfig);
  });

  it('forwards config.toml diagnostics as startup notices', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.harnessGetConfigDiagnostics.mockResolvedValue({
      warnings: ['Ignored invalid config in config.toml: loop_control.'],
    });
    mocks.tuiStart.mockResolvedValue(undefined);

    await runShell(
      {
        session: '',
        continue: false,
        rewindFiles: undefined,
        yolo: false,
        auto: false,
        plan: false,
        model: undefined,
        outputFormat: undefined,
        prompt: undefined,
        skillsDirs: [],
      },
      '1.2.3-test',
    );

    const [, , startupInput] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
    expect(startupInput).toMatchObject({
      startupNotice: 'Ignored invalid config in config.toml: loop_control.',
    });
  });

  it('closes the harness when TUI startup fails', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
    mocks.tuiStart.mockRejectedValue(new Error('boom'));

    await expect(
      runShell(
        {
          session: undefined,
          continue: false,
          rewindFiles: undefined,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
        },
        '1.2.3-test',
      ),
    ).rejects.toThrow('boom');

    expect(mocks.setCrashPhase).toHaveBeenCalledWith('shutdown');
    expect(mocks.harnessTrack).toHaveBeenCalledWith('exit', { duration_s: expect.any(Number) });
    expect(mocks.shutdownTelemetry).toHaveBeenCalledOnce();
    expect(mocks.harnessClose).toHaveBeenCalledOnce();
  });

  it('tracks exit and prints resume instructions from the TUI exit handler', async () => {
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
          rewindFiles: undefined,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
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
        duration_s: expect.any(Number),
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
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
          rewindFiles: undefined,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
        },
        '1.2.3-test',
      );
      const [tui] = mocks.pythinkerTuiConstructor.mock.calls[0]!;
      const openedUrl = 'http://127.0.0.1:58627/sessions/ses-1';
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
    mocks.loadTuiConfig.mockResolvedValue(tuiConfig());
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
          rewindFiles: undefined,
          yolo: false,
          auto: false,
          plan: false,
          model: undefined,
          outputFormat: undefined,
          prompt: undefined,
          skillsDirs: [],
        },
        '1.2.3-test',
        { migrateOnly: true },
      ),
    ).rejects.toThrow('Invalid configuration');
    expect(mocks.tuiStart).not.toHaveBeenCalled();
  });
});
