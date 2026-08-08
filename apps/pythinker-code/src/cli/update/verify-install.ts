/**
 * Post-install verification.
 *
 * An installer exit code of 0 only says the installer believed it finished.
 * It does not say the bytes that will run next launch are the target version:
 * a Windows report had `install.ps1` exit 0 repeatedly while the executable on
 * disk stayed on the old version, so the footer advertised
 * "restart to apply" forever and the recorded outcome was a lie.
 *
 * Only a `native` install is verified, and only against the artifact the
 * installer replaces — the packaged binary at `process.execPath`, probed with
 * `--version` (Commander prints and exits before any preflight runs). The
 * npm family is deliberately left unverified: a global reinstall rewrites the
 * very directory this process was loaded from, so a read there proves nothing
 * about the next launch and a wrong answer would park a healthy version.
 *
 * It fails **open**: a probe that times out, cannot run, or prints no version
 * reports `ok` with an `unverified` note for the caller to log. A slow
 * antivirus scan must never turn a good install into a recorded failure. Only
 * a version read successfully *and* disagreeing with the target is a mismatch.
 */

import { execFile } from 'node:child_process';
import { valid } from 'semver';

import { formatErrorMessage } from './format-error';
import type { InstallSource } from './types';

/** Bound on the `--version` probe: a native binary starts in well under this. */
const VERSION_PROBE_TIMEOUT_MS = 20_000;

export type InstallVerification =
  /** Installed as expected, or not checkable — `unverified` says which. */
  | { readonly ok: true; readonly unverified?: string }
  | { readonly ok: false; readonly reason: string };

export interface VerifyInstalledVersionDeps {
  /** Path of the packaged binary to probe (native installs only). */
  readonly execPath: string;
  /** Runs `<exe> --version` and resolves its stdout. */
  readonly probeExecutableVersion: (execPath: string) => Promise<string>;
}

function unverified(note: string): InstallVerification {
  return { ok: true, unverified: note };
}

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

/**
 * Verify that `expectedVersion` is what an install of `source` actually left
 * behind. See the module comment for the fail-open rule.
 */
export async function verifyInstalledVersion(
  source: InstallSource,
  expectedVersion: string,
  overrides: Partial<VerifyInstalledVersionDeps> = {},
): Promise<InstallVerification> {
  if (source !== 'native') return unverified(`not verified for ${source} installs`);
  if (valid(expectedVersion) === null) {
    return unverified(`not a version to verify against: ${expectedVersion}`);
  }

  const execPath = overrides.execPath ?? process.execPath;
  const probe = overrides.probeExecutableVersion ?? defaultProbeExecutableVersion;

  let output: string;
  try {
    output = await probe(execPath);
  } catch (error) {
    return unverified(`${execPath} could not be run: ${formatErrorMessage(error)}`);
  }

  const found = parseVersionOutput(output);
  if (found === null) return unverified(`${execPath} printed no version`);
  if (sameVersion(found, expectedVersion)) return { ok: true };
  return {
    ok: false,
    reason:
      `the installer reported success but ${execPath} still reports ` +
      `${found} (expected ${expectedVersion})`,
  };
}
