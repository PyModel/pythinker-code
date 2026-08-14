/**
 * Pythinker Code entry point.
 *
 * Parses CLI arguments via Commander.js, validates options, runs the
 * outer update preflight, then delegates to the requested UI runner.
 */

import {
  createPythinkerHarness,
  flushDiagnosticLogs,
  installGlobalProxyDispatcher,
  log,
  resolveGlobalLogPath,
  resolvePythinkerHome,
  type TelemetryClient,
} from '@pymodel/pythinker-code-sdk';
import {
  installCrashHandlers,
  setTelemetryContext,
  shutdownTelemetry,
  track,
  withTelemetryContext,
} from '@pymodel/pythinker-telemetry';

import { createProgram } from './cli/commands';
import type { CLIOptions } from './cli/options';
import { OptionConflictError, validateOptions } from './cli/options';
import { drainWritable, writeAndDrain } from './cli/output';
import { runPrompt } from './cli/run-prompt';
import { runShell } from './cli/run-shell';
import { formatStartupError } from './cli/startup-error';
import { runPluginNodeEntry } from './cli/sub/plugin-run-node';
import { handleUpgrade } from './cli/sub/upgrade';
import { createCliTelemetryBootstrap, initializeCliTelemetry } from './cli/telemetry';
import { activatePendingUpdate } from './cli/update/activation';
import {
  isAutoUpdateDisabledByEnv,
  runUpdatePreflight,
  shouldAutoInstallUpdates,
} from './cli/update/preflight';
import { dispatchUpdateHelperIfRequested } from './cli/update/update-helper';
import { createPythinkerCodeHostIdentity, getVersion } from './cli/version';
import { CLI_SHUTDOWN_TIMEOUT_MS, CLI_UI_MODE, PROCESS_NAME } from './constant/app';
import { cleanupStaleNativeCacheForCurrent, cleanupStaleUpdateBackup } from './native/native-assets';
import { installNativeModuleHook } from './native/module-hook';
import { runNativeAssetSmokeIfRequested } from './native/smoke';

export async function handleMainCommand(opts: CLIOptions, version: string): Promise<void> {
  let validated: ReturnType<typeof validateOptions>;
  try {
    validated = validateOptions(opts);
  } catch (error) {
    if (error instanceof OptionConflictError) {
      await writeAndDrain(process.stderr, `error: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const interactiveShell =
    validated.uiMode === 'shell' &&
    validated.options.initOnly !== true &&
    process.stdin.isTTY &&
    process.stdout.isTTY;
  const activation = await activatePendingUpdate(version, {
    enabled: interactiveShell,
    automaticEnabled:
      interactiveShell &&
      !isAutoUpdateDisabledByEnv() &&
      await shouldAutoInstallUpdates(),
  }).catch(async (error: unknown) => {
    await writeAndDrain(
      process.stderr,
      `warning: unable to process a pending Pythinker Code update: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    ).catch(() => {});
    return { status: 'none' as const };
  });
  if (activation.status === 'failed') {
    await writeAndDrain(
      process.stderr,
      `warning: failed to activate Pythinker Code ${activation.version}: ${activation.message}\n`,
    );
  } else if (activation.status === 'activated') {
    await Promise.all([drainWritable(process.stdout), drainWritable(process.stderr)]);
    relaunchUpdatedCli(activation.executable);
  }

  const preflightResult = await runUpdatePreflight(
    version,
    validated.uiMode === 'print' || validated.options.initOnly === true
      ? { track, isTTY: false }
      : { track },
  );
  if (preflightResult === 'exit') {
    // The preflight may have printed an update notice; flush it before exiting.
    await Promise.all([drainWritable(process.stdout), drainWritable(process.stderr)]);
    process.exit(0);
  }

  if (validated.uiMode === 'print' && validated.options.initOnly !== true) {
    await runPrompt(validated.options, version);
    return;
  }

  await runShell(validated.options, version);
}

/** `pythinker migrate`: launch the migration screen only, then exit. */
async function handleMigrateCommand(version: string): Promise<void> {
  await runShell(MIGRATE_CLI_OPTIONS, version, { migrateOnly: true });
}

export async function handleUpgradeCommand(version: string): Promise<void> {
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
  });
  let exitCode = 1;
  try {
    await harness.ensureConfigFile();
    const config = await harness.getConfig();
    initializeCliTelemetry({
      harness,
      bootstrap: telemetryBootstrap,
      config,
      version,
      uiMode: CLI_UI_MODE,
    });
    exitCode = await handleUpgrade(version, { track, logger: log });
  } finally {
    await shutdownTelemetry({ timeoutMs: CLI_SHUTDOWN_TIMEOUT_MS }).catch(() => {});
    await harness.close().catch(() => {});
  }
  // Flush upgrade output before exiting, or the terminal may lose it.
  await Promise.all([drainWritable(process.stdout), drainWritable(process.stderr)]);
  process.exit(exitCode);
}

/** A neutral CLIOptions value — `pythinker migrate` never opens a chat session. */
const MIGRATE_CLI_OPTIONS: CLIOptions = {
  session: undefined,
  continue: false,
  rewindFiles: undefined,
  yolo: false,
  auto: false,
  init: false,
  initOnly: false,
  maintenance: false,
  plan: false,
  model: undefined,
  outputFormat: undefined,
  prompt: undefined,
  skillsDirs: [],
  additionalDirs: [],
};

export function main(): void {
  process.title = PROCESS_NAME;
  installCrashHandlers();
  // Route all outbound fetch through HTTP_PROXY/HTTPS_PROXY (honoring NO_PROXY)
  // before any client is constructed. No-op when no proxy variable is set; an
  // invalid proxy URL is reported and ignored rather than aborting startup.
  installGlobalProxyDispatcher();
  installNativeModuleHook();
  if (dispatchUpdateHelperIfRequested()) return;
  if (runNativeAssetSmokeIfRequested()) return;

  // Start the background cleanup of stale native cache. Fire-and-forget; must not block startup or throw.
  queueMicrotask(() => {
    try {
      cleanupStaleNativeCacheForCurrent();
    } catch {
      // ignore: cache GC must never affect process startup
    }
    // Sweep a leftover `pythinker.exe.old` from a prior Windows native update.
    cleanupStaleUpdateBackup();
  });

  const version = getVersion();

  const program = createProgram(
    version,
    (opts) => {
      void handleMainCommand(opts, version).catch(async (error: unknown) => {
        const operation =
          opts.rewindFiles !== undefined
            ? 'rewind files'
            : opts.prompt !== undefined
              ? 'run prompt'
              : 'start shell';
        await logStartupFailure(operation, error);
        await writeAndDrain(
          process.stderr,
          formatStartupError(error, { operation })
            + `See log: ${resolveGlobalLogPath(resolvePythinkerHome())}\n`,
        );
        process.exit(1);
      });
    },
    () => {
      void handleMigrateCommand(version).catch(async (error: unknown) => {
        await logStartupFailure('run migration', error);
        await writeAndDrain(
          process.stderr,
          formatStartupError(error, { operation: 'run migration' })
            + `See log: ${resolveGlobalLogPath(resolvePythinkerHome())}\n`,
        );
        process.exit(1);
      });
    },
    (entry, args) => {
      void runPluginNodeEntry(entry, args).catch(async (error: unknown) => {
        await logStartupFailure('run plugin node entry', error);
        await writeAndDrain(
          process.stderr,
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exit(1);
      });
    },
    () => {
      void handleUpgradeCommand(version).catch(async (error: unknown) => {
        await logStartupFailure('upgrade', error);
        await writeAndDrain(
          process.stderr,
          formatStartupError(error, { operation: 'upgrade' })
            + `See log: ${resolveGlobalLogPath(resolvePythinkerHome())}\n`,
        );
        process.exit(1);
      });
    },
  );

  program.parse(process.argv);
}

if (process.env['PYTHINKER_CODE_OPENTUI_SMOKE'] === '1') {
  // Keep this promise-based because the native build emits this entry as CommonJS.
  // oxlint-disable-next-line unicorn/prefer-top-level-await
  void import('./tui/runtime/open-tui-probe')
    .then(({ runOpenTuiProbe }) => runOpenTuiProbe())
    .catch((error: unknown) => {
      process.stderr.write(
        `OpenTUI lifecycle probe failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
} else {
  main();
}

function relaunchUpdatedCli(executable: string): never {
  if (process.execve === undefined) {
    throw new Error('process.execve is unavailable for update relaunch');
  }
  process.execve(
    executable,
    [executable, ...process.argv.slice(2)],
    process.env,
  );
  throw new Error('update relaunch returned unexpectedly');
}

async function logStartupFailure(operation: string, error: unknown): Promise<void> {
  log.error('startup failed', { operation, error });
  try {
    await flushDiagnosticLogs();
  } catch {
    // Best-effort diagnostic flush only.
  }
}
