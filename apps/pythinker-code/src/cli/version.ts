/**
 * Pythinker Code version helpers.
 *
 * `getVersion` reads the host CLI's `package.json#version`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createPythinkerDefaultHeaders, type PythinkerHostIdentity } from '@pymodel/pythinker-code-oauth';

import { CLI_USER_AGENT_PRODUCT } from '#/constant/app';

import { getDataDir } from '../utils/paths';
import { PYTHINKER_BUILD_INFO } from './build-info';

const MODULE_DIR = import.meta.dirname;

/**
 * Locate the host `package.json`, or `null` when there is none.
 *
 * A packaged native binary (SEA) ships no `package.json` at all, so every
 * caller that only wants the path for diagnostics must take the `null` branch
 * instead of crashing the command — `pythinker doctor` did exactly that on
 * native installs.
 */
export function findHostPackageJsonPath(): string | null {
  // Walk upwards from this file's directory until a `package.json` shows up,
  // so both dev (`tsx src/main.ts` — this file in `src/cli/`, pkg 2 levels
  // up) and prod (`node dist/main.mjs` — this code bundled into `dist/`,
  // pkg 1 level up) resolve correctly.
  let dir = MODULE_DIR;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function getHostPackageJsonPath(): string {
  const found = findHostPackageJsonPath();
  if (found === null) {
    throw new Error(`Could not locate package.json near ${MODULE_DIR}`);
  }
  return found;
}

export function getHostPackageRoot(): string {
  return dirname(getHostPackageJsonPath());
}

/** The host package root, or `null` on a native binary that has no package. */
export function findHostPackageRoot(): string | null {
  const found = findHostPackageJsonPath();
  return found === null ? null : dirname(found);
}

export function getVersion(): string {
  if (PYTHINKER_BUILD_INFO.version !== undefined) {
    return PYTHINKER_BUILD_INFO.version;
  }
  const pkg = JSON.parse(readFileSync(getHostPackageJsonPath(), 'utf-8')) as {
    version: string;
  };
  return pkg.version;
}

export function createPythinkerCodeHostIdentity(version = getVersion()): PythinkerHostIdentity {
  return {
    userAgentProduct: CLI_USER_AGENT_PRODUCT,
    version,
  };
}

export function buildPythinkerDefaultHeaders(version: string): Record<string, string> {
  return createPythinkerDefaultHeaders({
    homeDir: getDataDir(),
    ...createPythinkerCodeHostIdentity(version),
  });
}
