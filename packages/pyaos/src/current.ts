import { AsyncLocalStorage } from 'node:async_hooks';

import { PyaosError } from './errors';
import type { Pyaos } from './pyaos';
import type { PyaosProcess } from './process';
import type { StatResult } from './types';

const pyaosStorage = new AsyncLocalStorage<Pyaos>();

/**
 * Return the {@link Pyaos} instance bound to the current async context.
 *
 * Throws if nothing is bound — callers must wrap their entry point in
 * {@link runWithPyaos} or call {@link setCurrentPyaos} once at startup.
 */
export function getCurrentPyaos(): Pyaos {
  const store = pyaosStorage.getStore();
  if (store === undefined) {
    throw new PyaosError(
      'No Pyaos is bound to the current async context. Call `setCurrentPyaos(await LocalPyaos.create())` once at startup, or wrap the call in `runWithPyaos(...)`.',
    );
  }
  return store;
}

/**
 * Bind `pyaos` as the current instance for the running async context tree.
 * Intended for a one-shot call at process startup (e.g. in a test setup
 * file). Subsequent code in the same context — including nested awaits —
 * resolves {@link getCurrentPyaos} to this instance unless overridden by
 * {@link runWithPyaos}.
 */
export function setCurrentPyaos(pyaos: Pyaos): void {
  pyaosStorage.enterWith(pyaos);
}

/**
 * Run `fn` with `pyaos` bound as the current Pyaos instance for its async
 * subtree. Concurrent calls do not pollute each other — bindings are
 * scoped to the {@link AsyncLocalStorage} context.
 */
export function runWithPyaos<T>(pyaos: Pyaos, fn: () => T): T {
  return pyaosStorage.run(pyaos, fn);
}

// Module-level convenience functions for the current Pyaos instance.

export function readText(
  path: string,
  options?: { encoding?: BufferEncoding; errors?: 'strict' | 'replace' | 'ignore' },
): Promise<string> {
  return getCurrentPyaos().readText(path, options);
}

export function writeText(
  path: string,
  data: string,
  options?: { mode?: 'w' | 'a'; encoding?: BufferEncoding },
): Promise<number> {
  return getCurrentPyaos().writeText(path, data, options);
}

export function readLines(
  path: string,
  options?: { encoding?: BufferEncoding; errors?: 'strict' | 'replace' | 'ignore' },
): AsyncGenerator<string> {
  return getCurrentPyaos().readLines(path, options);
}

export function exec(...args: string[]): Promise<PyaosProcess> {
  return getCurrentPyaos().exec(...args);
}

export function readBytes(path: string, n?: number): Promise<Buffer> {
  return getCurrentPyaos().readBytes(path, n);
}

export function writeBytes(path: string, data: Buffer): Promise<number> {
  return getCurrentPyaos().writeBytes(path, data);
}

export function stat(path: string, options?: { followSymlinks?: boolean }): Promise<StatResult> {
  return getCurrentPyaos().stat(path, options);
}

export function mkdir(
  path: string,
  options?: { parents?: boolean; existOk?: boolean },
): Promise<void> {
  return getCurrentPyaos().mkdir(path, options);
}

export function iterdir(path: string): AsyncGenerator<string> {
  return getCurrentPyaos().iterdir(path);
}

export function glob(
  path: string,
  pattern: string,
  options?: { caseSensitive?: boolean },
): AsyncGenerator<string> {
  return getCurrentPyaos().glob(path, pattern, options);
}

export function chdir(path: string): Promise<void> {
  return getCurrentPyaos().chdir(path);
}

export function getcwd(): string {
  return getCurrentPyaos().getcwd();
}

export function gethome(): string {
  return getCurrentPyaos().gethome();
}

export function normpath(path: string): string {
  return getCurrentPyaos().normpath(path);
}

export function pathClass(): 'posix' | 'win32' {
  return getCurrentPyaos().pathClass();
}

export function execWithEnv(args: string[], env?: Record<string, string>): Promise<PyaosProcess> {
  return getCurrentPyaos().execWithEnv(args, env);
}
