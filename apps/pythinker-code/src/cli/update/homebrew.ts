import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { access, mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { valid } from 'semver';
import { z } from 'zod';

import type { UpdatePreparedHomebrew } from './types';

const HOMEBREW_FORMULA = 'pythinker-code';
const COMMAND_ERROR_TAIL_LENGTH = 2_000;

const HomebrewInfoSchema = z.object({
  formulae: z.array(z.object({
    name: z.literal(HOMEBREW_FORMULA),
    versions: z.object({ stable: z.string().min(1) }),
    urls: z.object({
      stable: z.object({
        url: z.url(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
    }),
    linked_keg: z.string().nullable(),
    pinned: z.boolean(),
  })).length(1),
});

export interface HomebrewCommandOptions {
  readonly capture?: boolean;
  readonly inheritOutput?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly logFile?: string;
}

export interface HomebrewCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type HomebrewCommandRunner = (
  args: readonly string[],
  options?: HomebrewCommandOptions,
) => Promise<HomebrewCommandResult>;

export class PreparedHomebrewUpdateInvalidError extends Error {}

interface HomebrewSnapshot {
  readonly version: string;
  readonly formulaUrl: string;
  readonly artifactSha256: string;
  readonly formulaFileSha256: string;
  readonly artifactPath: string;
  readonly linkedVersion: string | null;
  readonly pinned: boolean;
  readonly executable: string;
}

export interface HomebrewUpdateDeps {
  readonly run: HomebrewCommandRunner;
  readonly hashFile: (filePath: string) => Promise<string>;
  readonly readFormula: (filePath: string) => Promise<string>;
  readonly ensureExecutable: (filePath: string) => Promise<void>;
  readonly now: () => Date;
}

const NO_AUTO_UPDATE_ENV: NodeJS.ProcessEnv = {
  HOMEBREW_NO_AUTO_UPDATE: '1',
};

const ACTIVATION_ENV: NodeJS.ProcessEnv = {
  ...NO_AUTO_UPDATE_ENV,
  HOMEBREW_NO_INSTALL_CLEANUP: '1',
  HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK: '1',
};

function commandError(
  command: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
) {
  const outcome = signal === null ? `code ${String(code)}` : `signal ${signal}`;
  const detail = stderr.trim().slice(-COMMAND_ERROR_TAIL_LENGTH);
  return new Error(`${command} exited with ${outcome}${detail === '' ? '' : `: ${detail}`}`);
}

export async function runHomebrewCommand(
  args: readonly string[],
  options: HomebrewCommandOptions = {},
): Promise<HomebrewCommandResult> {
  const capture = options.capture ?? true;
  const command = ['brew', ...args].join(' ');
  const logPath = options.logFile;
  const logFile = logPath === undefined
    ? undefined
    : await (async () => {
      try {
        await mkdir(dirname(logPath), { recursive: true });
        return await open(logPath, 'a', 0o600);
      } catch {
        return undefined;
      }
    })();
  let logWrites = Promise.resolve();
  const appendLog = (chunk: string | Uint8Array): void => {
    if (logFile === undefined) return;
    // Normalize to bytes: FileHandle.write has separate string/buffer
    // overloads that reject the union type.
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    logWrites = logWrites
      .then(async () => {
        await logFile.write(data);
      })
      .catch(() => {});
  };
  appendLog(`\n[${new Date().toISOString()}] $ ${command}\n`);

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('brew', [...args], {
        cwd: homedir(),
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (capture) stdout.push(chunk);
        if (options.inheritOutput === true) process.stdout.write(chunk);
        appendLog(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
        if (options.inheritOutput === true) process.stderr.write(chunk);
        appendLog(chunk);
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(commandError(command, code, signal, Buffer.concat(stderr).toString('utf-8')));
      });
    });
  } finally {
    await logWrites;
    await logFile?.close().catch(() => {});
  }

  return {
    stdout: Buffer.concat(stdout).toString('utf-8'),
    stderr: Buffer.concat(stderr).toString('utf-8'),
  };
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => { hash.update(chunk); });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function resolveDeps(overrides: Partial<HomebrewUpdateDeps> = {}): HomebrewUpdateDeps {
  return {
    run: overrides.run ?? runHomebrewCommand,
    hashFile: overrides.hashFile ?? sha256File,
    readFormula: overrides.readFormula ?? ((filePath) => readFile(filePath, 'utf-8')),
    ensureExecutable:
      overrides.ensureExecutable ?? ((filePath) => access(filePath, fsConstants.X_OK)),
    now: overrides.now ?? (() => new Date()),
  };
}

async function inspectHomebrewFormula(
  deps: HomebrewUpdateDeps,
  logFile: string | undefined,
): Promise<HomebrewSnapshot> {
  const commandOptions: HomebrewCommandOptions = {
    env: NO_AUTO_UPDATE_ENV,
    logFile,
  };
  const info = HomebrewInfoSchema.parse(JSON.parse(
    (await deps.run(['info', '--json=v2', HOMEBREW_FORMULA], commandOptions)).stdout,
  ));
  const formula = info.formulae[0];
  if (formula === undefined) throw new Error('Homebrew formula metadata is missing');
  if (valid(formula.versions.stable) === null) {
    throw new Error(`Homebrew returned an invalid version: ${formula.versions.stable}`);
  }

  const formulaPath = (await deps.run(['formula', HOMEBREW_FORMULA], commandOptions)).stdout.trim();
  const artifactPath = (
    await deps.run(
      ['--cache', '--build-from-source', '--formula', HOMEBREW_FORMULA],
      commandOptions,
    )
  ).stdout.trim();
  const prefix = (await deps.run(['--prefix', HOMEBREW_FORMULA], commandOptions)).stdout.trim();
  if (formulaPath === '' || artifactPath === '' || prefix === '') {
    throw new Error('Homebrew returned an empty update path');
  }

  return {
    version: formula.versions.stable,
    formulaUrl: formula.urls.stable.url,
    artifactSha256: formula.urls.stable.checksum,
    formulaFileSha256: createHash('sha256')
      .update(await deps.readFormula(formulaPath), 'utf-8')
      .digest('hex'),
    artifactPath,
    linkedVersion: formula.linked_keg,
    pinned: formula.pinned,
    executable: join(prefix, 'bin', 'pythinker'),
  };
}

function assertSamePreparedFormula(
  prepared: UpdatePreparedHomebrew,
  snapshot: HomebrewSnapshot,
): void {
  if (
    snapshot.version !== prepared.version ||
    snapshot.formulaUrl !== prepared.formulaUrl ||
    snapshot.artifactSha256 !== prepared.artifactSha256 ||
    snapshot.formulaFileSha256 !== prepared.formulaFileSha256 ||
    snapshot.artifactPath !== prepared.artifactPath
  ) {
    throw new PreparedHomebrewUpdateInvalidError(
      'Homebrew formula changed after the update was prepared',
    );
  }
}

async function verifyPreparedArtifact(
  prepared: UpdatePreparedHomebrew,
  deps: HomebrewUpdateDeps,
): Promise<void> {
  const actual = await deps.hashFile(prepared.artifactPath);
  if (actual !== prepared.artifactSha256) {
    throw new PreparedHomebrewUpdateInvalidError(
      'Prepared Homebrew artifact failed SHA-256 verification',
    );
  }
}

export interface PrepareHomebrewUpdateRequest {
  readonly jobId: string;
  readonly requestedVersion: string;
  readonly requestedBy: UpdatePreparedHomebrew['requestedBy'];
}

export async function prepareHomebrewUpdate(
  request: PrepareHomebrewUpdateRequest,
  options: { readonly logFile?: string; readonly deps?: Partial<HomebrewUpdateDeps> } = {},
): Promise<UpdatePreparedHomebrew> {
  if (valid(request.requestedVersion) === null) {
    throw new Error(`Invalid requested update version: ${request.requestedVersion}`);
  }
  const deps = resolveDeps(options.deps);
  await deps.run(['update'], { capture: false, logFile: options.logFile });

  const before = await inspectHomebrewFormula(deps, options.logFile);
  if (before.pinned) throw new Error('The Homebrew formula is pinned');
  if (before.version !== request.requestedVersion) {
    throw new PreparedHomebrewUpdateInvalidError(
      `Homebrew formula ${before.version} does not match requested update ${request.requestedVersion}`,
    );
  }

  await deps.run(
    ['fetch', '--build-from-source', '--retry', '--formula', HOMEBREW_FORMULA],
    { capture: false, env: NO_AUTO_UPDATE_ENV, logFile: options.logFile },
  );
  const after = await inspectHomebrewFormula(deps, options.logFile);
  const prepared: UpdatePreparedHomebrew = {
    jobId: request.jobId,
    source: 'homebrew',
    version: before.version,
    preparedAt: deps.now().toISOString(),
    requestedBy: request.requestedBy,
    formulaUrl: before.formulaUrl,
    artifactKind: 'source',
    artifactSha256: before.artifactSha256,
    formulaFileSha256: before.formulaFileSha256,
    artifactPath: before.artifactPath,
  };
  assertSamePreparedFormula(prepared, after);
  await verifyPreparedArtifact(prepared, deps);
  return prepared;
}

export async function activateHomebrewUpdate(
  prepared: UpdatePreparedHomebrew,
  options: { readonly logFile?: string; readonly deps?: Partial<HomebrewUpdateDeps> } = {},
) {
  const deps = resolveDeps(options.deps);
  const before = await inspectHomebrewFormula(deps, options.logFile);
  assertSamePreparedFormula(prepared, before);
  await verifyPreparedArtifact(prepared, deps);

  if (before.linkedVersion !== prepared.version) {
    await deps.run(
      ['upgrade', '--formula', '--build-from-source', '--no-ask', HOMEBREW_FORMULA],
      {
        capture: false,
        inheritOutput: true,
        env: ACTIVATION_ENV,
        logFile: options.logFile,
      },
    );
  }

  const after = await inspectHomebrewFormula(deps, options.logFile);
  assertSamePreparedFormula(prepared, after);
  if (after.linkedVersion !== prepared.version) {
    throw new Error(
      `Homebrew linked ${after.linkedVersion ?? 'no version'} instead of ${prepared.version}`,
    );
  }
  await deps.ensureExecutable(after.executable);
  return { version: prepared.version, executable: after.executable };
}
