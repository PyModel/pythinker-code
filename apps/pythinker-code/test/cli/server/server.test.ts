/**
 * Tests for `pythinker server run` and `pythinker web` Commander wiring.
 *
 * These tests don't actually start the server — they verify the parsed shape
 * (option flags, --open default) and that the `web` alias defers to the same
 * underlying handler with `defaultOpen` flipped to true.
 *
 * Foreground startup behavior is exercised end-to-end in `server-e2e/`.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import chalk, { Chalk } from 'chalk';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerServerCommand } from '#/cli/sub/server';
import { addLifecycleCommands } from '#/cli/sub/server/lifecycle';
import type { KillCommandDeps } from '#/cli/sub/server/kill';
import { PYTHINKER_LOGO_COLORS } from '#/tui/components/chrome/pythinker-logo';
import { darkColors } from '#/tui/theme/colors';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function makeProgram(): Command {
  // `commander` exitOverride avoids killing the test runner when --help/error fires.
  const program = new Command('pythinker').exitOverride();
  registerServerCommand(program);
  return program;
}

describe('pythinker server', () => {
  it('declares pino-pretty as a CLI runtime dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'),
    ) as { optionalDependencies?: Record<string, string> };

    expect(packageJson.optionalDependencies).toHaveProperty('pino-pretty');
  });

  it('registers the expected `server` subcommands while lifecycle commands are hidden', () => {
    const program = makeProgram();
    const server = program.commands.find((c) => c.name() === 'server');
    expect(server).toBeDefined();
    const subs = server?.commands.map((c) => c.name()).toSorted();
    expect(subs).toEqual(['kill', 'ps', 'run']);
  });

  it('`server run` exposes local-only foreground options', () => {
    const program = makeProgram();
    const run = program.commands
      .find((c) => c.name() === 'server')
      ?.commands.find((c) => c.name() === 'run');
    expect(run).toBeDefined();
    const longs = run!.options.map((o) => o.long).filter(Boolean);
    expect(longs).not.toContain('--host');
    expect(longs).toContain('--port');
    expect(longs).toContain('--log-level');
    expect(longs).toContain('--debug-endpoints');
    expect(longs).toContain('--foreground');
    // run defaults to NOT opening the browser → option is the positive --open
    expect(longs).toContain('--open');
  });

  it('`server install` exposes local-only service options', () => {
    // Lifecycle commands are no longer registered via `registerServerCommand`,
    // but the builder still lives in `./lifecycle` — exercise it directly.
    const server = new Command('server');
    addLifecycleCommands(server);
    const install = server.commands.find((c) => c.name() === 'install');
    expect(install).toBeDefined();
    const longs = install!.options.map((o) => o.long).filter(Boolean);
    expect(longs).not.toContain('--host');
    expect(longs).toContain('--port');
    expect(longs).toContain('--log-level');
    expect(longs).toContain('--force');
    expect(longs).toContain('--no-open');
    expect(longs).toContain('--json');
  });

  it('the top-level `pythinker web` alias is registered and defaults to opening the browser', () => {
    const program = makeProgram();
    const web = program.commands.find((c) => c.name() === 'web');
    expect(web).toBeDefined();
    const longs = web!.options.map((o) => o.long).filter(Boolean);
    // web defaults to opening → the option is the negative form --no-open
    expect(longs).toContain('--no-open');
    expect(longs).not.toContain('--host');
    expect(longs).toContain('--port');
  });
});

describe('`pythinker server` lifecycle exits with ESERVICE_UNSUPPORTED on unsupported platforms', () => {
  it('the dispatcher returns a friendly error manager for unknown platforms', async () => {
    // darwin / linux / win32 have real backends (launchd / systemd / schtasks).
    // The remaining platforms fall through to the stub that throws
    // `ServiceUnsupportedError` — pin that contract so a future addition
    // (freebsd, etc.) needs a deliberate decision instead of silently working.
    const { resolveServiceManager, ServiceUnsupportedError } = await import('@pymodel/server');
    const mgr = resolveServiceManager('freebsd');
    await expect(
      mgr.install({ host: '127.0.0.1', port: 58627, logLevel: 'info' }),
    ).rejects.toBeInstanceOf(ServiceUnsupportedError);
    await expect(mgr.status()).rejects.toBeInstanceOf(ServiceUnsupportedError);
  });
});

describe('`pythinker server` lifecycle handles unavailable service managers', () => {
  it('prints a friendly JSON error and exits 2', async () => {
    const { ServiceUnavailableError } = await import('@pymodel/server');
    const program = new Command('pythinker').exitOverride();
    const server = program.command('server');
    let stdout = '';
    let stderr = '';
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);

    addLifecycleCommands(server, {
      resolveManager: () => ({
        install: async () => {
          throw new ServiceUnavailableError(
            'linux',
            'systemd --user is not available in this environment.',
          );
        },
        uninstall: async () => ({ ok: true, message: 'unused' }),
        start: async () => ({ ok: true, message: 'unused' }),
        stop: async () => ({ ok: true, message: 'unused' }),
        restart: async () => ({ ok: true, message: 'unused' }),
        status: async () => ({ platform: 'linux', installed: false, running: false }),
      }),
      openUrl: vi.fn(),
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += String(chunk);
          return true;
        },
      },
      stderr: {
        write(chunk: string | Uint8Array) {
          stderr += String(chunk);
          return true;
        },
      },
    });

    await expect(
      program.parseAsync(['node', 'pythinker', 'server', 'install', '--json']),
    ).rejects.toThrow('process.exit(2)');

    exit.mockRestore();
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      action: 'unavailable',
      platform: 'linux',
      message: expect.stringContaining('server run --port <port>'),
    });
  });

  it('preserves exit 2 when output draining rejects', async () => {
    const { ServiceUnavailableError } = await import('@pymodel/server');
    const program = new Command('pythinker').exitOverride();
    const server = program.command('server');
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as typeof process.exit);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      const complete =
        typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      if (String(chunk).length === 0) complete?.(new Error('drain failed'));
      return true;
    }) as never);

    addLifecycleCommands(server, {
      resolveManager: () => ({
        install: async () => {
          throw new ServiceUnavailableError('linux', 'service manager unavailable');
        },
        uninstall: async () => ({ ok: true, message: 'unused' }),
        start: async () => ({ ok: true, message: 'unused' }),
        stop: async () => ({ ok: true, message: 'unused' }),
        restart: async () => ({ ok: true, message: 'unused' }),
        status: async () => ({ platform: 'linux', installed: false, running: false }),
      }),
      openUrl: vi.fn(),
      stdout: process.stdout,
      stderr: { write: () => true },
    });

    try {
      await expect(
        program.parseAsync(['node', 'pythinker', 'server', 'install', '--json']),
      ).rejects.toThrow('process.exit(2)');
      expect(exit).toHaveBeenCalledWith(2);
    } finally {
      stdoutWrite.mockRestore();
      exit.mockRestore();
    }
  });
});

describe('`pythinker server` lifecycle output', () => {
  it('install passes --force/--port, prints the URL, and opens it when running', async () => {
    const program = new Command('pythinker').exitOverride();
    const server = program.command('server');
    let stdout = '';
    let stderr = '';
    let installArgs: unknown;
    const openUrl = vi.fn();

    addLifecycleCommands(server, {
      resolveManager: () => ({
        install: async (args) => {
          installArgs = args;
          return {
            status: 'replaced',
            message: 'Pythinker server LaunchAgent replaced at /tmp/pythinker.plist (port 9999).',
            plistPath: '/tmp/pythinker.plist',
          };
        },
        uninstall: async () => ({ ok: true, message: 'unused' }),
        start: async () => ({ ok: true, message: 'unused' }),
        stop: async () => ({ ok: true, message: 'unused' }),
        restart: async () => ({ ok: true, message: 'unused' }),
        status: async () => ({
          platform: 'darwin',
          installed: true,
          running: true,
          host: '127.0.0.1',
          port: 9999,
          logPath: '/tmp/server.log',
          label: 'ai.pythoughts.pythinker-server',
        }),
      }),
      openUrl,
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += String(chunk);
          return true;
        },
      },
      stderr: {
        write(chunk: string | Uint8Array) {
          stderr += String(chunk);
          return true;
        },
      },
    });

    await program.parseAsync([
      'node',
      'pythinker',
      'server',
      'install',
      '--force',
      '--port',
      '9999',
    ]);

    expect(stderr).toBe('');
    expect(installArgs).toMatchObject({ port: 9999, force: true });
    expect(stdout).toContain('URL: http://127.0.0.1:9999');
    expect(stdout).toContain('Status: running');
    expect(stdout).toContain('Log: /tmp/server.log');
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:9999');
  });

  it('start prints URL and diagnostics when launchd did not keep the service running', async () => {
    const program = new Command('pythinker').exitOverride();
    const server = program.command('server');
    let stdout = '';
    const openUrl = vi.fn();

    addLifecycleCommands(server, {
      resolveManager: () => ({
        install: async () => ({ status: 'installed', message: 'unused' }),
        uninstall: async () => ({ ok: true, message: 'unused' }),
        start: async () => ({ ok: true, message: 'Pythinker server started (ai.pythoughts.pythinker-server).' }),
        stop: async () => ({ ok: true, message: 'unused' }),
        restart: async () => ({ ok: true, message: 'unused' }),
        status: async () => ({
          platform: 'darwin',
          installed: true,
          running: false,
          host: '127.0.0.1',
          port: 58627,
          logPath: '/tmp/server.log',
          label: 'ai.pythoughts.pythinker-server',
          notes: ['launchd state: spawn scheduled', 'last exit code: 78 EX_CONFIG'],
        }),
      }),
      openUrl,
      stdout: {
        write(chunk: string | Uint8Array) {
          stdout += String(chunk);
          return true;
        },
      },
      stderr: {
        write() {
          return true;
        },
      },
    });

    await program.parseAsync(['node', 'pythinker', 'server', 'start']);

    expect(stdout).toContain('URL: http://127.0.0.1:58627');
    expect(stdout).toContain('Status: not running');
    expect(stdout).toContain('launchd state: spawn scheduled');
    expect(stdout).toContain('last exit code: 78 EX_CONFIG');
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe('`pythinker server run` background start', () => {
  it('defaults the daemon log level to silent', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let parsed: unknown;

    await handleRunCommand(
      { port: '58627' },
      {
        startServerBackground: async (options) => {
          parsed = options;
          return { origin: 'http://127.0.0.1:58627' };
        },
        openUrl: vi.fn(),
        stdout: {
          write() {
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    expect(parsed).toMatchObject({ logLevel: 'silent' });
  });

  it('passes --log-level through to the background daemon', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let parsed: unknown;

    await handleRunCommand(
      { port: '58627', logLevel: 'debug' },
      {
        startServerBackground: async (options) => {
          parsed = options;
          return { origin: 'http://127.0.0.1:58627' };
        },
        openUrl: vi.fn(),
        stdout: {
          write() {
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    expect(parsed).toMatchObject({ logLevel: 'debug' });
  });

  it('prints a TUI-style ready panel once the daemon is up', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let stdout = '';

    await handleRunCommand(
      { port: '58627' },
      {
        startServerBackground: async () => ({ origin: 'http://127.0.0.1:58627' }),
        openUrl: vi.fn(),
        stdout: {
          write(chunk: string | Uint8Array) {
            stdout += String(chunk);
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    const plain = stripAnsi(stdout);
    expect(plain).toContain('╭');
    expect(plain).toContain('╰');
    expect(plain).toContain('●');
    expect(plain).toContain('◉');
    expect(plain).toContain('Pythinker server ready');
    expect(plain).toContain('URL:');
    expect(plain).toContain('http://127.0.0.1:58627/');
    expect(plain).toContain('Network:');
    expect(plain).toContain('local only');
    expect(plain).toContain('Logs:');
    expect(plain).toContain('off');
    expect(plain).toContain('Stop:');
    expect(plain).toContain('pythinker server kill');
    expect(plain).not.toContain('➜');
    expect(plain).not.toContain('Pythinker server:');
  });

  it('uses the TUI dark palette for the ready banner', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let stdout = '';
    const previousChalkLevel = chalk.level;
    chalk.level = 3;

    try {
      await handleRunCommand(
        { port: '58627' },
        {
          startServerBackground: async () => ({ origin: 'http://127.0.0.1:58627' }),
          openUrl: vi.fn(),
          stdout: {
            write(chunk: string | Uint8Array) {
              stdout += String(chunk);
              return true;
            },
          },
          stderr: {
            write() {
              return true;
            },
          },
        },
      );
    } finally {
      chalk.level = previousChalkLevel;
    }

    const color = new Chalk({ level: 3 });
    // The antenna bulb is deliberately coral against the periwinkle chrome.
    expect(stdout).toContain(color.hex(PYTHINKER_LOGO_COLORS.antenna)('●'));
    expect(stdout).toContain(color.bold.hex(darkColors.primary)('Pythinker server ready'));
    expect(stdout).toContain(color.hex(darkColors.accent)('http://127.0.0.1:58627/'));
    expect(stdout).toContain(color.bold.hex(darkColors.textDim)('URL:      '));
    expect(stdout).toContain(color.hex(darkColors.textMuted)('local only'));
  });
});

describe('`pythinker server run --foreground`', () => {
  it.each([
    ['idle' as const, 0],
    ['SIGHUP' as const, 129],
    ['SIGINT' as const, 130],
    ['SIGTERM' as const, 143],
  ])('maps %s shutdown to exit status %i', async (reason, exitCode) => {
    const { serverShutdownExitCode } = await import('#/cli/sub/server/run');

    expect(serverShutdownExitCode(reason)).toBe(exitCode);
  });

  it('forces immediate exit on a second signal while graceful shutdown is pending', async () => {
    const { installServerTerminationHandlers } = await import('#/cli/sub/server/run');
    const listeners = new Map<NodeJS.Signals, () => void>();
    const shutdown = vi.fn();
    const exit = vi.fn();
    const remove = installServerTerminationHandlers(shutdown, {
      on(signal, listener) {
        listeners.set(signal, listener);
      },
      off(signal, listener) {
        if (listeners.get(signal) === listener) listeners.delete(signal);
      },
      exit,
    });

    listeners.get('SIGINT')?.();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledWith('SIGINT');
    expect(exit).not.toHaveBeenCalled();
    expect(listeners.has('SIGINT')).toBe(true);
    expect(listeners.has('SIGTERM')).toBe(true);

    listeners.get('SIGTERM')?.();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(143);
    expect(listeners.size).toBe(0);

    remove();
    expect(listeners.size).toBe(0);
  });

  it('runs the server in-process instead of spawning a background daemon', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let foregroundOptions: unknown;
    let backgroundCalled = false;

    await handleRunCommand(
      { port: '58627', foreground: true },
      {
        startServerBackground: async () => {
          backgroundCalled = true;
          return { origin: 'http://127.0.0.1:58627' };
        },
        startServerForeground: async (options) => {
          foregroundOptions = options;
          return undefined as unknown as never;
        },
        openUrl: vi.fn(),
        stdout: {
          write() {
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    expect(backgroundCalled).toBe(false);
    expect(foregroundOptions).toMatchObject({ port: 58627, logLevel: 'silent' });
  });

  it('prints the ready banner and opens the browser once listening', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let stdout = '';
    const openUrl = vi.fn();

    await handleRunCommand(
      { port: '58627', foreground: true, open: true },
      {
        startServerBackground: async () => ({ origin: 'http://127.0.0.1:58627' }),
        startServerForeground: async (options, hooks) => {
          void options;
          hooks?.onReady?.('http://127.0.0.1:58627');
          return undefined as unknown as never;
        },
        openUrl,
        stdout: {
          write(chunk: string | Uint8Array) {
            stdout += String(chunk);
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    const plain = stripAnsi(stdout);
    expect(plain).toContain('Pythinker server ready');
    expect(plain).toContain('http://127.0.0.1:58627/');
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:58627');
  });
});

describe('`pythinker server` does not register a legacy `daemon` command', () => {
  it('hard-deletes the old name', () => {
    const program = makeProgram();
    const daemon = program.commands.find((c) => c.name() === 'daemon');
    expect(daemon).toBeUndefined();
  });
});

describe('shared parsers stay strict', () => {
  it('rejects out-of-range --port', async () => {
    const { parsePort } = await import('#/cli/sub/server/shared');
    expect(() => parsePort('99999', '--port', 58627)).toThrow(/invalid --port/);
    expect(() => parsePort('-1', '--port', 58627)).toThrow(/invalid --port/);
    expect(parsePort(undefined, '--port', 58627)).toBe(58627);
    expect(parsePort('8080', '--port', 58627)).toBe(8080);
  });

  it('rejects unknown --log-level values', async () => {
    const { parseLogLevel } = await import('#/cli/sub/server/shared');
    expect(() => parseLogLevel('shout')).toThrow(/invalid --log-level/);
    expect(parseLogLevel(undefined)).toBe('info');
    expect(parseLogLevel('debug')).toBe('debug');
  });
});

describe('server web asset directory resolution', () => {
  it('uses extracted SEA web assets when available', async () => {
    const { resolveServerWebAssetsDir } = await import('#/cli/sub/server/run');
    expect(resolveServerWebAssetsDir('/cache/pythinker/dist-web')).toBe('/cache/pythinker/dist-web');
  });

  it('falls back to package dist-web outside SEA mode', async () => {
    const { resolveServerWebAssetsDir } = await import('#/cli/sub/server/run');
    expect(resolveServerWebAssetsDir(null)).toMatch(/[/\\]dist-web$/);
  });
});

function listenOnce(host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host, port }, () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function allocateFreePort(host = '127.0.0.1'): Promise<number> {
  const server = await listenOnce(host, 0);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await closeServer(server);
  return port;
}

/**
 * Find the start of a run of `count` consecutive free ports
 * (`start`, `start + 1`, …, `start + count - 1` all bindable).
 */
async function allocateAdjacentFreeRun(count: number, host = '127.0.0.1'): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const start = await allocateFreePort(host);
    if (start <= 0 || start + count - 1 > 65535) continue;
    const held: Server[] = [];
    let ok = true;
    for (let offset = 1; offset < count; offset++) {
      const probe = await listenOnce(host, start + offset).catch(() => null);
      if (probe === null) {
        ok = false;
        break;
      }
      held.push(probe);
    }
    for (const server of held) await closeServer(server);
    if (ok) return start;
  }
  throw new Error('could not allocate a run of adjacent free ports');
}

describe('resolveDaemonPort', () => {
  it('returns the preferred port when it is free', async () => {
    const { resolveDaemonPort } = await import('#/cli/sub/server/daemon');
    const free = await allocateFreePort();
    await expect(resolveDaemonPort('127.0.0.1', free)).resolves.toBe(free);
  });

  it('falls back to a different free port when the preferred port is busy', async () => {
    const { resolveDaemonPort } = await import('#/cli/sub/server/daemon');
    const busy = await allocateFreePort();
    const holder = await listenOnce('127.0.0.1', busy);
    try {
      const port = await resolveDaemonPort('127.0.0.1', busy);
      expect(port).not.toBe(busy);
      expect(port).toBeGreaterThan(0);
    } finally {
      await closeServer(holder);
    }
  });

  it('walks to preferred+1 when only the preferred port is busy', async () => {
    const { resolveDaemonPort } = await import('#/cli/sub/server/daemon');
    const start = await allocateAdjacentFreeRun(2);
    const holder = await listenOnce('127.0.0.1', start);
    try {
      const port = await resolveDaemonPort('127.0.0.1', start);
      expect(port).toBe(start + 1);
    } finally {
      await closeServer(holder);
    }
  });

  it('skips past a run of busy ports to the first free one', async () => {
    const { resolveDaemonPort } = await import('#/cli/sub/server/daemon');
    const start = await allocateAdjacentFreeRun(3);
    // Hold both `start` and `start+1`; the resolver should land on `start+2`.
    const holderA = await listenOnce('127.0.0.1', start);
    const holderB = await listenOnce('127.0.0.1', start + 1);
    try {
      const port = await resolveDaemonPort('127.0.0.1', start);
      expect(port).toBe(start + 2);
    } finally {
      await closeServer(holderA);
      await closeServer(holderB);
    }
  });
});

describe('resolveDaemonProgram', () => {
  it('uses the absolute script path outside SEA mode', async () => {
    const { resolveDaemonProgram } = await import('#/cli/sub/server/daemon');
    expect(resolveDaemonProgram(['node', '/opt/pythinker/dist/cli.mjs'], '/tmp', '/usr/bin/node', false)).toBe('/opt/pythinker/dist/cli.mjs');
  });

  it('normalizes a relative executable path against cwd outside SEA mode', async () => {
    const { resolveDaemonProgram } = await import('#/cli/sub/server/daemon');
    expect(resolveDaemonProgram(['node', './pythinker'], '/tmp/pythinker-bin', '/usr/bin/node', false)).toBe('/tmp/pythinker-bin/pythinker');
  });

  it('returns execPath in SEA mode when argv[1] is a bare command name', async () => {
    // Reproduces `pythinker web` from the shell: argv[1] is the invoked command
    // name (`pythinker`), not a path. Resolving it against cwd produced `<cwd>/pythinker`
    // and crashed the spawn with ENOENT.
    const { resolveDaemonProgram } = await import('#/cli/sub/server/daemon');
    expect(resolveDaemonProgram(['/Users/x/.pythinker-code/bin/pythinker', 'pythinker', 'web'], '/Users/x', '/Users/x/.pythinker-code/bin/pythinker', true)).toBe('/Users/x/.pythinker-code/bin/pythinker');
  });

  it('returns execPath in SEA mode for a spawned `server` child', async () => {
    const { resolveDaemonProgram } = await import('#/cli/sub/server/daemon');
    expect(resolveDaemonProgram(['/Users/x/.pythinker-code/bin/pythinker', 'server', 'run'], '/Users/x', '/Users/x/.pythinker-code/bin/pythinker', true)).toBe('/Users/x/.pythinker-code/bin/pythinker');
  });
});

describe('spawnDaemonChild', () => {
  let workDir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'pythinker-daemon-cwd-'));
    prevHome = process.env['PYTHINKER_CODE_HOME'];
    process.env['PYTHINKER_CODE_HOME'] = workDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env['PYTHINKER_CODE_HOME'];
    } else {
      process.env['PYTHINKER_CODE_HOME'] = prevHome;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it('spawns the daemon with cwd set to the server log directory', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockClear();
    spawnMock.mockReturnValue({ unref: vi.fn(), once: vi.fn() } as unknown as ChildProcess);

    const { spawnDaemonChild, daemonLogPath } = await import('#/cli/sub/server/daemon');
    spawnDaemonChild({ port: 58627, logLevel: 'info' });

    expect(spawnMock).toHaveBeenCalledOnce();
    const [program, args, options] = spawnMock.mock.calls[0]!;
    expect(program).toBeTruthy();
    expect(args).toEqual(expect.arrayContaining(['server', 'run', '--daemon']));
    expect(options).toMatchObject({ detached: true, cwd: dirname(daemonLogPath()) });
    expect(options?.cwd).not.toBe(process.cwd());
  });
});

describe('createIdleShutdownHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not arm before any client connects', async () => {
    const { createIdleShutdownHandler } = await import('#/cli/sub/server/run');
    const onIdle = vi.fn();
    const handler = createIdleShutdownHandler({ graceMs: 1000, onIdle });
    handler.onConnectionCountChange(0);
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires onIdle after the grace once the last client leaves', async () => {
    const { createIdleShutdownHandler } = await import('#/cli/sub/server/run');
    const onIdle = vi.fn();
    const handler = createIdleShutdownHandler({ graceMs: 1000, onIdle });
    handler.onConnectionCountChange(1);
    handler.onConnectionCountChange(0);
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending exit when a client reconnects during the grace', async () => {
    const { createIdleShutdownHandler } = await import('#/cli/sub/server/run');
    const onIdle = vi.fn();
    const handler = createIdleShutdownHandler({ graceMs: 1000, onIdle });
    handler.onConnectionCountChange(1);
    handler.onConnectionCountChange(0);
    vi.advanceTimersByTime(500);
    handler.onConnectionCountChange(1); // reconnect
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('only the final drop to zero arms the timer with multiple clients', async () => {
    const { createIdleShutdownHandler } = await import('#/cli/sub/server/run');
    const onIdle = vi.fn();
    const handler = createIdleShutdownHandler({ graceMs: 500, onIdle });
    handler.onConnectionCountChange(1);
    handler.onConnectionCountChange(2);
    handler.onConnectionCountChange(1); // still one connected
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
    handler.onConnectionCountChange(0); // now none
    vi.advanceTimersByTime(500);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('pythinker web (shares `server run` call stack)', () => {
  it('prints the ready banner and opens the browser by default', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    let stdout = '';
    const openUrl = vi.fn();

    await handleRunCommand(
      { port: '58627', open: true },
      {
        startServerBackground: async () => ({ origin: 'http://127.0.0.1:58627' }),
        openUrl,
        stdout: {
          write(chunk: string | Uint8Array) {
            stdout += String(chunk);
            return true;
          },
        },
        stderr: {
          write() {
            return true;
          },
        },
      },
    );

    expect(stripAnsi(stdout)).toContain('Pythinker server ready');
    expect(openUrl).toHaveBeenCalledWith('http://127.0.0.1:58627');
  });

  it('does not open the browser when open is false', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    const openUrl = vi.fn();
    await handleRunCommand(
      { port: '58627' },
      {
        startServerBackground: async () => ({ origin: 'http://127.0.0.1:9000' }),
        openUrl,
        stdout: { write: () => true },
        stderr: { write: () => true },
      },
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('rejects an invalid --log-level before touching the daemon', async () => {
    const { handleRunCommand } = await import('#/cli/sub/server/run');
    const startServerBackground = vi.fn();
    await expect(
      handleRunCommand(
        { logLevel: 'shout' },
        {
          startServerBackground,
          openUrl: vi.fn(),
          stdout: { write: () => true },
          stderr: { write: () => true },
        },
      ),
    ).rejects.toThrow(/invalid --log-level/);
    expect(startServerBackground).not.toHaveBeenCalled();
  });
});

function makeKillDeps(overrides: Partial<KillCommandDeps> = {}): {
  deps: KillCommandDeps;
  writes: string[];
  signals: Array<{ pid: number; signal: NodeJS.Signals }>;
  state: { shutdownCalls: number };
  clock: { t: number };
} {
  const writes: string[] = [];
  const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const state = { shutdownCalls: 0 };
  const clock = { t: 0 };
  const deps: KillCommandDeps = {
    getLiveLock: () => undefined,
    requestShutdown: async () => {
      state.shutdownCalls += 1;
    },
    signalPid: (pid, signal) => {
      signals.push({ pid, signal });
      return true;
    },
    pidAlive: () => false,
    sleep: async (ms) => {
      clock.t += ms;
    },
    stdout: {
      write(chunk: string | Uint8Array) {
        writes.push(String(chunk));
        return true;
      },
    },
    now: () => clock.t,
    ...overrides,
  };
  return { deps, writes, signals, state, clock };
}

describe('`pythinker server kill`', () => {
  const liveLock = { pid: 1234, started_at: '2026-06-17T00:00:00.000Z', port: 58627 };

  it('prints "No running Pythinker server." and sends no signal when no live lock exists', async () => {
    const { handleKillCommand } = await import('#/cli/sub/server/kill');
    const { deps, writes, signals } = makeKillDeps({ getLiveLock: () => undefined });

    await handleKillCommand(deps);

    expect(writes.join('')).toContain('No running Pythinker server.');
    expect(signals).toEqual([]);
  });

  it('attempts the API shutdown, then stops after SIGTERM when the pid exits promptly', async () => {
    const { handleKillCommand } = await import('#/cli/sub/server/kill');
    const { deps, writes, signals, state, clock } = makeKillDeps({
      getLiveLock: () => liveLock,
      pidAlive: () => clock.t < 50,
    });

    await handleKillCommand(deps);

    expect(state.shutdownCalls).toBe(1);
    expect(signals).toEqual([{ pid: 1234, signal: 'SIGTERM' }]);
    expect(writes.join('')).toContain('pid 1234');
    expect(writes.join('')).toContain('stopped.');
  });

  it('escalates to SIGKILL when the pid survives SIGTERM', async () => {
    const { handleKillCommand } = await import('#/cli/sub/server/kill');
    const { deps, writes, signals, clock } = makeKillDeps({
      getLiveLock: () => ({ ...liveLock, pid: 5678 }),
      // Survives the 3s SIGTERM grace, dies during the 2s SIGKILL grace.
      pidAlive: () => clock.t < 3100,
    });

    await handleKillCommand(deps);

    expect(signals.map((s) => s.signal)).toEqual(['SIGTERM', 'SIGKILL']);
    expect(writes.join('')).toContain('pid 5678');
    expect(writes.join('')).toContain('killed.');
  });

  it('throws a permissions error when the pid survives SIGKILL', async () => {
    const { handleKillCommand } = await import('#/cli/sub/server/kill');
    const { deps } = makeKillDeps({
      getLiveLock: () => ({ ...liveLock, pid: 9999 }),
      pidAlive: () => true,
    });

    await expect(handleKillCommand(deps)).rejects.toThrow(/insufficient permissions/);
  });
});

// Silence vi import for cases where the file is built before tests reference vi.
void vi;
