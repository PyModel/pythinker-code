import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  createPythinkerHarness,
  log,
  type PythinkerHarness,
  type TelemetryClient,
} from '@pythoughts/pythinker-code-sdk';
import {
  setCrashPhase,
  setTelemetryContext,
  shutdownTelemetry,
  track,
  withTelemetryContext,
} from '@pythoughts/pythinker-telemetry';

import { CLI_SHUTDOWN_TIMEOUT_MS, CLI_UI_MODE } from '#/constant/app';
import { detectPendingMigration } from '#/migration/index';
import type { TuiConfig } from '#/tui/config';
import { loadTuiConfig, TuiConfigParseError } from '#/tui/config';
import { CHROME_GUTTER } from '#/tui/constant/rendering';
import { PythinkerTUI } from '#/tui/index';
import { currentTheme, getColorPalette } from '#/tui/theme';
import { combineStartupNotice } from '#/tui/utils/startup';
import { toTerminalHyperlink } from '#/utils/terminal-hyperlink';

import type { CLIOptions } from './options';
import { drainWritable, writeAndDrain } from './output';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './telemetry';
import { createPythinkerCodeHostIdentity } from './version';

export async function runShell(
  opts: CLIOptions,
  version: string,
  runOptions: { readonly migrateOnly?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now();
  const configStartedAt = startedAt;
  let tuiConfig: TuiConfig;
  let configWarning: string | undefined;
  try {
    tuiConfig = await loadTuiConfig();
  } catch (error) {
    if (!(error instanceof TuiConfigParseError)) throw error;
    tuiConfig = error.fallback;
    configWarning = error.message;
  }

  // Initialise the global Theme singleton before pi-tui grabs stdin.
  const palette = await getColorPalette(tuiConfig.theme);
  currentTheme.setPalette(palette);

  const workDir = process.cwd();
  const telemetryBootstrap = createCliTelemetryBootstrap();
  const telemetryClient: TelemetryClient = {
    track,
    withContext: withTelemetryContext,
    setContext: setTelemetryContext,
  };
  const harness = createPythinkerHarness({
    homeDir: telemetryBootstrap.homeDir,
    identity: createPythinkerCodeHostIdentity(version),
    telemetry: telemetryClient,
    onOAuthRefresh: (outcome) => {
      if (outcome.success) {
        track('oauth_refresh', { success: true });
        return;
      }
      track('oauth_refresh', {
        success: false,
        reason: outcome.reason,
      });
    },
  });
  log.info('pythinker-code starting', {
    version,
    uiMode: CLI_UI_MODE,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    workDir,
  });

  await harness.ensureConfigFile();
  if (opts.initOnly === true) {
    try {
      const config = await harness.getConfig();
      await harness.createSession({
        workDir,
        model: opts.model ?? config.defaultModel,
        setupTrigger: 'init',
      });
    } finally {
      await harness.close();
    }
    return;
  }
  const migrationPlan = await detectPendingMigration({
    sourceHome: join(homedir(), '.pythinker'),
    targetHome: harness.homeDir,
    ignoreMarker: runOptions.migrateOnly,
  });
  if (runOptions.migrateOnly === true && migrationPlan === null) {
    process.stdout.write('  Nothing to migrate from ~/.pythinker/.\n');
    await harness.close();
    return;
  }
  const config = await harness.getConfig();
  for (const warning of (await harness.getConfigDiagnostics()).warnings) {
    configWarning = combineStartupNotice(configWarning, warning);
  }
  const configMs = Date.now() - configStartedAt;
  const tui = new PythinkerTUI(harness, {
    cliOptions: opts,
    tuiConfig,
    version,
    workDir,
    startupNotice: configWarning,
    migrationPlan,
    migrateOnly: runOptions.migrateOnly,
  });

  initializeCliTelemetry({
    harness,
    bootstrap: telemetryBootstrap,
    config,
    version,
    uiMode: CLI_UI_MODE,
  });
  setCrashPhase('runtime');

  const resumed = opts.continue || opts.session !== undefined;
  const trackLifecycleForSession = (
    sessionId: string,
    event: string,
    properties?: Parameters<PythinkerHarness['track']>[1],
  ) => {
    if (sessionId.length === 0) {
      harness.track(event, properties);
      return;
    }
    withTelemetryContext({ sessionId }).track(event, properties);
  };
  const trackLifecycle = (event: string, properties?: Parameters<PythinkerHarness['track']>[1]) => {
    trackLifecycleForSession(tui.getCurrentSessionId(), event, properties);
  };

  tui.onExit = async (exitCode = 0) => {
    const sessionId = tui.getCurrentSessionId();
    const hasContent = tui.hasSessionContent();
    setCrashPhase('shutdown');
    trackLifecycle('exit', { duration_s: (Date.now() - startedAt) / 1000 });
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
    const gutter = ' '.repeat(CHROME_GUTTER);
    await writeAndDrain(process.stdout, `${gutter}Bye!\n`);
    const hints: string[] = [];
    if (sessionId !== '' && hasContent) {
      hints.push(`${gutter}To resume this session: pythinker -r ${sessionId}`);
    }
    if (tui.exitOpenUrl !== undefined) {
      hints.push(`${gutter}open ${toTerminalHyperlink(tui.exitOpenUrl, tui.exitOpenUrl)}`);
    }
    if (hints.length > 0) {
      await writeAndDrain(process.stderr, `\n${hints.join('\n')}\n`);
    }
    // Flush everything still queued (e.g. alt-screen teardown) before exiting,
    // or the terminal may drop the final lines.
    await Promise.all([drainWritable(process.stdout), drainWritable(process.stderr)]);
    process.exit(exitCode);
  };
  try {
    execSync('stty -ixon', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    const initStartedAt = Date.now();
    await tui.start();
    const initMs = Date.now() - initStartedAt;
    trackLifecycle('started', {
      resumed,
      yolo: opts.yolo,
      auto: opts.auto,
      plan: opts.plan,
      afk: false,
    });
    const startupSessionId = tui.getCurrentSessionId();
    const mcpMs = await tui.getStartupMcpMs();
    trackLifecycleForSession(startupSessionId, 'startup_perf', {
      duration_ms: Date.now() - startedAt,
      config_ms: configMs,
      init_ms: initMs,
      mcp_ms: mcpMs,
    });
  } catch (error) {
    setCrashPhase('shutdown');
    trackLifecycle('exit', { duration_s: (Date.now() - startedAt) / 1000 });
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS });
    await harness.close();
    throw error;
  }
}
