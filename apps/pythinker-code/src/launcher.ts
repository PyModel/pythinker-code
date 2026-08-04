import { spawn } from 'node:child_process';

const FFI_FLAG = '--experimental-ffi';
const FFI_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const FFI_CHILD_ENV = 'PYTHINKER_CODE_FFI_CHILD';
const REQUIRED_RUNTIME = 'Node.js 26.4.0 or newer with experimental FFI support';
const MINIMUM_NODE = [26, 4, 0] as const;
const NATIVE_INSTALL_HINT =
  'Alternatively, use the native installer (no Node.js required): https://code.pythinker.com';

/**
 * Older Node (e.g. 24 LTS) has no `--experimental-ffi`, so the re-exec below
 * would die with a cryptic `bad option` error. npm installs the package on any
 * Node version (engines is only a warning for consumers), so guard here with
 * an actionable message instead.
 */
function isRuntimeTooOld(): boolean {
  const parts = process.versions.node.split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;
  const [reqMajor, reqMinor, reqPatch] = MINIMUM_NODE;
  if (major !== reqMajor) return major < reqMajor;
  if (minor !== reqMinor) return minor < reqMinor;
  return patch < reqPatch;
}

function isFfiProcess(): boolean {
  // Only execArgv decides: a stale env marker must never bypass the FFI re-exec.
  return process.execArgv.includes(FFI_FLAG);
}

/**
 * Windows-only fallback for platforms without `process.execve` (Node < 26.4
 * does not ship it on win32). Re-exec via spawn instead.
 */
function launchWindowsFallback(
  nodeArguments: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  let childStarted = false;
  let receivedSigint = false;
  let forceTermination = false;
  const child = spawn(process.execPath, nodeArguments, {
    env: environment,
    stdio: 'inherit',
  });

  const removeSignalHandler = (): void => {
    process.off('SIGINT', handleSigint);
  };
  const forceChildTermination = (): void => {
    forceTermination = true;
    if (childStarted) child.kill('SIGKILL');
  };
  // Console Ctrl+C reaches both processes; child.kill('SIGINT') would force termination.
  const handleSigint = (): void => {
    if (!receivedSigint) {
      receivedSigint = true;
      return;
    }
    forceChildTermination();
  };
  process.on('SIGINT', handleSigint);

  child.on('spawn', () => {
    childStarted = true;
    if (forceTermination) forceChildTermination();
  });
  child.on('error', (error) => {
    removeSignalHandler();
    process.stderr.write(
      `Failed to start Pythinker Code: ${error.message}. This CLI requires ${REQUIRED_RUNTIME}.\n`,
    );
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    removeSignalHandler();
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    // 130 = 128 + SIGINT, matching the conventional shell exit code.
    process.exitCode = receivedSigint ? 130 : (code ?? 1);
  });
}

async function launch(): Promise<void> {
  if (isRuntimeTooOld()) {
    process.stderr.write(
      `Pythinker Code requires ${REQUIRED_RUNTIME}; you are running Node.js ${process.versions.node}.\n` +
        `${NATIVE_INSTALL_HINT}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (isFfiProcess()) {
    await import(new URL('./main.mjs', import.meta.url).href);
    return;
  }

  const launcherPath = process.argv[1];
  if (launcherPath === undefined) {
    process.stderr.write(`Pythinker Code requires ${REQUIRED_RUNTIME}.\n`);
    process.exitCode = 1;
    return;
  }

  const nodeArguments = [
    FFI_FLAG,
    FFI_WARNING_FLAG,
    ...process.execArgv,
    launcherPath,
    ...process.argv.slice(2),
  ];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    [FFI_CHILD_ENV]: '1',
  };
  // On Windows, process.execve either does not exist or exists but throws
  // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM when called — checking for undefined
  // is not enough, so always take the spawn fallback there.
  if (process.platform === 'win32') {
    launchWindowsFallback(nodeArguments, environment);
    return;
  }

  // execve keeps the same pid, process group, session, and controlling
  // terminal, so Ctrl+C and job-control signals keep flowing to the app and
  // the child's process group stays the terminal's foreground group.
  if (process.execve === undefined) {
    throw new Error('process.execve is unavailable on this platform');
  }
  process.execve(process.execPath, [process.execPath, ...nodeArguments], environment);
}

void launch().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start Pythinker Code: ${detail}\n`);
  process.exitCode = 1;
});
