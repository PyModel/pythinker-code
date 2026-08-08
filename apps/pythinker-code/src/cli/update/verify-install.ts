/**
 * Post-install verification.
 *
 * An installer exit code of 0 only says the installer believed it finished.
 * It does not say the bytes that will run next launch are the target version:
 * a Windows report had `install.ps1` exit 0 repeatedly while the executable on
 * disk stayed on the old version, so the footer advertised
 * "restart to apply" forever and the recorded outcome was a lie.
 *
 * This module answers the only question that matters after an install — does
 * the thing that runs next report the version we installed? — and it answers
 * it from the same artifact the source updates:
 *
 *   - native: the packaged binary at `process.execPath`, probed with
 *     `--version` (Commander prints and exits before any preflight runs).
 *   - npm/pnpm/yarn/bun: the host `package.json`, re-read from disk.
 *   - homebrew: nothing — its update lands through the prepare-on-restart
 *     lifecycle, not through this install path.
 *
 * It fails **open**: an unreadable package, a probe that times out or a
 * version string it cannot parse all report `ok`. A slow antivirus scan must
 * never turn a good install into a recorded failure. Only a version it read
 * successfully *and* that disagrees with the target is reported as a mismatch.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { valid } from 'semver';

import { findHostPackageJsonPath } from '#/cli/version';

import type { InstallSource } from './types';

/** Bound on the `--version` probe: a native binary starts in well under this. */
const VERSION_PROBE_TIMEOUT_MS = 20_000;

export type InstallVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface VerifyInstalledVersionDeps {
  /** Path of the packaged binary to probe (native sources only). */
  readonly execPath: string;
  /** Runs `<exe> --version` and resolves its stdout. */
  readonly probeExecutableVersion: (execPath: string) => Promise<string>;
  /** Reads the installed host `package.json`, or null when there is none. */
  readonly readPackageVersion: () => Promise<string | null>;
}

const OK: InstallVerification = { ok: true };

/**
 * Extract the first `x.y.z` from a `--version` output. Commander prints the
 * bare version, but a wrapper is free to add a banner around it.
 */
export function parseVersionOutput(output: string): string | null {
  // No leading `\b`: a `v` prefix is a word character, so `v1.2.3` would not
  // match. A digit or dot before the first number still disqualifies it.
  const match = /(?<![\d.])\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u.exec(output);
  return match?.[0] ?? null;
}

function sameVersion(found: string, expected: string): boolean {
  const normalize = (value: string): string => value.replace(/^v/u, '').trim();
  return normalize(found) === normalize(expected);
}

async function defaultProbeExecutableVersion(execPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      execPath,
      ['--version'],
      {
        timeout: VERSION_PROBE_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf-8',
        // The probe must not check for updates, install anything, or touch the
        // install state this verification is about to write.
        env: { ...process.env, PYTHINKER_CODE_NO_AUTO_UPDATE: '1' },
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function defaultReadPackageVersion(): Promise<string | null> {
  const path = findHostPackageJsonPath();
  if (path === null) return null;
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : null;
}

/**
 * Verify that `expectedVersion` is what an install of `source` actually left
 * behind. See the module comment for the fail-open rule.
 */
export async function verifyInstalledVersion(
  source: InstallSource,
  expectedVersion: string,
  overrides: Partial<VerifyInstalledVersionDeps> = {},
): Promise<InstallVerification> {
  if (valid(expectedVersion) === null) return OK;

  const deps: VerifyInstalledVersionDeps = {
    execPath: overrides.execPath ?? process.execPath,
    probeExecutableVersion: overrides.probeExecutableVersion ?? defaultProbeExecutableVersion,
    readPackageVersion: overrides.readPackageVersion ?? defaultReadPackageVersion,
  };

  switch (source) {
    case 'native': {
      let output: string;
      try {
        output = await deps.probeExecutableVersion(deps.execPath);
      } catch {
        return OK;
      }
      const found = parseVersionOutput(output);
      if (found === null || sameVersion(found, expectedVersion)) return OK;
      return {
        ok: false,
        reason:
          `the installer reported success but ${deps.execPath} still reports ` +
          `${found} (expected ${expectedVersion})`,
      };
    }
    case 'npm-global':
    case 'pnpm-global':
    case 'yarn-global':
    case 'bun-global': {
      let found: string | null;
      try {
        found = await deps.readPackageVersion();
      } catch {
        return OK;
      }
      if (found === null || sameVersion(found, expectedVersion)) return OK;
      return {
        ok: false,
        reason:
          `the installer reported success but the installed package is still ` +
          `${found} (expected ${expectedVersion})`,
      };
    }
    case 'homebrew':
    case 'unsupported':
      return OK;
  }
}
