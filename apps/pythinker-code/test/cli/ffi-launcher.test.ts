import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const FFI_FLAG = '--experimental-ffi';
const FFI_WARNING_FLAG = '--disable-warning=ExperimentalWarning';
const launcherSource = resolve(import.meta.dirname, '../../src/launcher.ts');
const tsxLoader = createRequire(resolve(process.cwd(), 'package.json')).resolve('tsx');

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface StartLauncherOptions {
  readonly args?: readonly string[];
  readonly detached?: boolean;
  readonly ffi?: boolean;
}

let fixtureDir: string;
let launcherPath: string;

function startLauncher(
  env?: NodeJS.ProcessEnv,
  options: StartLauncherOptions = {},
): ChildProcessWithoutNullStreams {
  const ffiArguments = options.ffi ? [FFI_FLAG, FFI_WARNING_FLAG] : [];
  return spawn(
    process.execPath,
    [
      ...ffiArguments,
      '--import',
      tsxLoader,
      launcherPath,
      ...(options.args ?? []),
    ],
    {
      cwd: fixtureDir,
      env: { ...process.env, ...env },
      stdio: 'pipe',
      detached: options.detached,
    },
  );
}

async function collect(child: ChildProcessWithoutNullStreams): Promise<ProcessResult> {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const { code, signal } = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveResult({ code, signal }));
  });
  return { code, signal, stdout, stderr };
}

async function waitForStdout(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  let output = '';
  child.stdout.setEncoding('utf8');
  await new Promise<void>((resolveOutput, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for launcher output: ${expected}`));
    }, 5_000);
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('error', onError);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: string): void => {
      output += chunk;
      if (!output.includes(expected)) return;
      cleanup();
      resolveOutput();
    };
    child.once('error', onError);
    child.stdout.on('data', onData);
  });
}

async function writeMain(source: string): Promise<void> {
  await writeFile(join(fixtureDir, 'main.mjs'), source);
}

beforeEach(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'pythinker-ffi-launcher-'));
  launcherPath = join(fixtureDir, 'launcher.ts');
  await copyFile(launcherSource, launcherPath);
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('FFI launcher', () => {
  it('starts with FFI and preserves argv', async () => {
    await writeMain(`
      process.stdout.write(JSON.stringify({
        pid: process.pid,
        ffi: process.execArgv.includes('${FFI_FLAG}'),
        warningDisabled: process.execArgv.includes('${FFI_WARNING_FLAG}'),
        argv1: process.argv[1],
        args: process.argv.slice(2),
        marker: process.env.PYTHINKER_CODE_FFI_CHILD,
        imported: import.meta.url.endsWith('/main.mjs'),
      }));
    `);

    const child = startLauncher(undefined, { args: ['alpha', 'two words'] });
    const originalPid = child.pid;
    const result = await collect(child);
    const details = JSON.parse(result.stdout) as {
      pid: number;
      ffi: boolean;
      warningDisabled: boolean;
      argv1: string;
      args: string[];
      marker: string;
      imported: boolean;
    };

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(details).toMatchObject({
      ffi: true,
      warningDisabled: true,
      argv1: launcherPath,
      args: ['alpha', 'two words'],
      marker: '1',
      imported: true,
    });
    expect(details.pid === originalPid).toBe(process.platform !== 'win32');
  });

  it('uses the spawn fallback on win32 even when process.execve exists but throws', async () => {
    // Regression: Windows Node ships process.execve as a defined function that
    // throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM when called. The launcher must
    // route win32 to the spawn fallback without ever calling execve.
    const patchPath = join(fixtureDir, 'patch-win32.mjs');
    await writeFile(
      patchPath,
      `
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.execve = () => {
        throw new Error('The feature process.execve is unavailable on the current platform');
      };
      `,
    );
    await writeMain(`
      process.stdout.write(JSON.stringify({ imported: true, marker: process.env.PYTHINKER_CODE_FFI_CHILD }));
    `);

    const child = spawn(
      process.execPath,
      ['--import', tsxLoader, '--import', patchPath, launcherPath],
      { cwd: fixtureDir, env: { ...process.env }, stdio: 'pipe' },
    );
    const result = await collect(child);

    expect(result.stderr).not.toContain('process.execve is unavailable');
    expect(result.code).toBe(0);
    const details = JSON.parse(result.stdout) as { imported: boolean; marker: string };
    expect(details).toMatchObject({ imported: true, marker: '1' });
  });

  it.skipIf(process.platform === 'win32')(
    'preserves the parent process group and session across execve',
    async () => {
      await writeMain(`
        const ffi = process.getBuiltinModule('node:ffi');
        const handle = ffi.dlopen(null, {
          getpgid: { arguments: ['i32'], return: 'i32' },
          getpgrp: { arguments: [], return: 'i32' },
          getsid: { arguments: ['i32'], return: 'i32' },
        });
        try {
          process.stdout.write(JSON.stringify({
            pid: process.pid,
            processGroup: handle.functions.getpgrp(),
            parentProcessGroup: handle.functions.getpgid(process.ppid),
            session: handle.functions.getsid(0),
            parentSession: handle.functions.getsid(process.ppid),
          }));
        } finally {
          handle.lib.close();
        }
      `);

      const child = startLauncher();
      const originalPid = child.pid;
      const result = await collect(child);
      const details = JSON.parse(result.stdout) as {
        pid: number;
        processGroup: number;
        parentProcessGroup: number;
        session: number;
        parentSession: number;
      };

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(details.pid).toBe(originalPid);
      expect(details.processGroup).toBe(details.parentProcessGroup);
      expect(details.session).toBe(details.parentSession);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'starts directly with FFI when already running as a session leader',
    async () => {
      await writeMain(`
        const ffi = process.getBuiltinModule('node:ffi');
        const handle = ffi.dlopen(null, {
          getpgrp: { arguments: [], return: 'i32' },
          getsid: { arguments: ['i32'], return: 'i32' },
        });
        try {
          process.stdout.write(JSON.stringify({
            pid: process.pid,
            processGroup: handle.functions.getpgrp(),
            session: handle.functions.getsid(0),
            marker: process.env.PYTHINKER_CODE_FFI_CHILD,
          }));
        } finally {
          handle.lib.close();
        }
      `);

      const child = startLauncher(undefined, { detached: true, ffi: true });
      const originalPid = child.pid;
      const result = await collect(child);
      const details = JSON.parse(result.stdout) as {
        pid: number;
        processGroup: number;
        session: number;
        marker?: string;
      };

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(details).toEqual({
        pid: originalPid,
        processGroup: originalPid,
        session: originalPid,
      });
    },
  );

  it.skipIf(process.platform === 'win32' || !existsSync('/usr/bin/expect'))(
    'preserves the foreground terminal and reads real PTY input after execve',
    async () => {
      await writeMain(`
        import { closeSync, openSync } from 'node:fs';

        const ffi = process.getBuiltinModule('node:ffi');
        const handle = ffi.dlopen(null, {
          getpgrp: { arguments: [], return: 'i32' },
          getsid: { arguments: ['i32'], return: 'i32' },
          tcgetpgrp: { arguments: ['i32'], return: 'i32' },
        });
        const descriptor = openSync('/dev/tty', 'r');
        closeSync(descriptor);
        try {
          process.stdout.write('STATE:' + JSON.stringify({
            pid: process.pid,
            processGroup: handle.functions.getpgrp(),
            foregroundProcessGroup: handle.functions.tcgetpgrp(0),
            session: handle.functions.getsid(0),
            marker: process.env.PYTHINKER_CODE_FFI_CHILD,
          }) + '\\n');
        } finally {
          handle.lib.close();
        }
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', (data) => {
          process.stdout.write('INPUT:' + data.trim() + '\\n', () => process.exit(0));
        });
      `);
      const probePath = join(fixtureDir, 'pty-probe.exp');
      await writeFile(probePath, `
        set timeout 10
        spawn $env(PTY_NODE_PATH) --import $env(PTY_TSX_LOADER) $env(PTY_LAUNCHER_PATH)
        expect "STATE:"
        send "hello-from-pty\\r"
        expect "INPUT:hello-from-pty"
        expect eof
        set status [wait]
        exit [lindex $status 3]
      `);

      const probe = spawn('/usr/bin/expect', [probePath], {
        cwd: fixtureDir,
        env: {
          ...process.env,
          PTY_NODE_PATH: process.execPath,
          PTY_TSX_LOADER: tsxLoader,
          PTY_LAUNCHER_PATH: launcherPath,
        },
        stdio: 'pipe',
      });
      const result = await collect(probe);
      const stateMatch = /STATE:(\{[^\r\n]+\})/.exec(result.stdout);
      expect(stateMatch).not.toBeNull();
      const state = JSON.parse(stateMatch![1]!) as {
        pid: number;
        processGroup: number;
        foregroundProcessGroup: number;
        session: number;
        marker: string;
      };

      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('INPUT:hello-from-pty');
      expect(state.processGroup).toBe(state.foregroundProcessGroup);
      expect(state.session).toBe(state.pid);
      expect(state.marker).toBe('1');
    },
  );

  it('does not let a stale child sentinel bypass FFI re-execution', async () => {
    await writeMain(`
      process.stdout.write(JSON.stringify({
        pid: process.pid,
        ffi: process.execArgv.includes('${FFI_FLAG}'),
        marker: process.env.PYTHINKER_CODE_FFI_CHILD,
      }));
    `);

    const child = startLauncher({ PYTHINKER_CODE_FFI_CHILD: '1' });
    const originalPid = child.pid;
    const result = await collect(child);

    const details = JSON.parse(result.stdout) as {
      pid: number;
      ffi: boolean;
      marker: string;
    };
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(details).toMatchObject({ ffi: true, marker: '1' });
    expect(details.pid === originalPid).toBe(process.platform !== 'win32');
  });

  it('preserves the imported main module exit status', async () => {
    await writeMain('process.exit(37);');

    const result = await collect(startLauncher());

    expect(result.code).toBe(37);
    expect(result.signal).toBeNull();
  });

  it.skipIf(process.platform === 'win32').each([
    'SIGHUP' as const,
    'SIGINT' as const,
    'SIGTERM' as const,
  ])('delivers %s directly to the execed application', async (signal) => {
    await writeMain(`
      process.on('${signal}', () => {
        process.stdout.write('received-${signal}');
        process.exit(0);
      });
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1_000);
    `);
    const child = startLauncher();
    await waitForStdout(child, 'ready');

    child.kill(signal);
    const result = await collect(child);

    expect(result.stdout).toContain(`received-${signal}`);
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
  });

  it.skipIf(process.platform === 'win32')(
    'preserves a terminating signal from the execed application',
    async () => {
      await writeMain("setTimeout(() => process.kill(process.pid, 'SIGTERM'), 20);");

      const result = await collect(startLauncher());

      expect(result.code).toBeNull();
      expect(result.signal).toBe('SIGTERM');
    },
  );
});
