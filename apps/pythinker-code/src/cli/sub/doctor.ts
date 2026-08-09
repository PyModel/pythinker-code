import { constants as fsConstants, existsSync } from 'node:fs';
import { access, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
  createPythinkerConfigRpc,
  findExistingRg,
  resolvePythinkerHome,
  type PythinkerConfigRpc,
  type PythinkerConfigValidationIssue,
  type RgResolution,
} from '@pythoughts/pythinker-code-sdk';
import type { Command } from 'commander';
import { z } from 'zod';

import { getTuiConfigPath, parseTuiConfig } from '#/tui/config';
import { readUpdateCache } from '#/cli/update/cache';
import { readUpdateInstallState } from '#/cli/update/install-state';
import {
  automaticUpdateModeFor,
  isAutoUpdateDisabledByEnv,
  shouldAutoInstallUpdates,
  type AutomaticUpdateMode,
} from '#/cli/update/preflight';
import { detectInstallSource } from '#/cli/update/source';
import type { UpdateInstallFailure } from '#/cli/update/types';
import { findHostPackageRoot, getVersion } from '#/cli/version';
import { getUpdateInstallLogFile } from '#/utils/paths';

interface WritableLike {
  write(chunk: string): boolean;
}

type MaybePromise<T> = T | Promise<T>;

export interface DoctorDeps {
  readonly cwd: () => string;
  readonly defaultConfigPath: () => MaybePromise<string>;
  readonly defaultTuiConfigPath: () => string;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly configRpc?: PythinkerConfigRpc;
  readonly fileExists?: (path: string) => boolean;
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly validateConfigToml?: (text: string, path: string) => MaybePromise<void>;
  readonly runtimeInfo?: () => MaybePromise<DoctorRuntimeInfo>;
}

export interface DoctorRuntimeInfo {
  readonly version: string;
  readonly installSource: string;
  /** Absent on a native binary: a packaged install has no `package.json`. */
  readonly packageRoot?: string;
  readonly executable: string;
  readonly installations?: readonly string[];
  readonly ripgrep?: RgResolution;
  readonly update?: {
    readonly latest: string | null;
    readonly checkedAt: string | null;
    readonly autoUpdate?: 'on' | 'off' | 'env-disabled';
    readonly mode?: AutomaticUpdateMode;
    readonly pendingVersion?: string;
    readonly pendingRequestedBy?: 'automatic' | 'manual';
    readonly activeOperation?: string;
    readonly lastSuccess?: string;
    readonly lastFailure?: string;
    readonly logPath?: string;
  };
}

export interface DoctorOptions {
  readonly target?: 'config' | 'tui';
  readonly path?: string;
}

interface CheckSpec {
  readonly label: 'config.toml' | 'tui.toml';
  readonly path: string;
  readonly explicit: boolean;
  readonly parse: (text: string, path: string) => MaybePromise<void>;
}

interface CheckResult {
  readonly label: CheckSpec['label'];
  readonly path: string;
  readonly status: 'OK' | 'SKIP' | 'ERROR';
  readonly message?: string;
}

interface ResolvedDoctorDeps {
  readonly cwd: () => string;
  readonly defaultConfigPath: () => MaybePromise<string>;
  readonly defaultTuiConfigPath: () => string;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly fileExists: (path: string) => boolean;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly validateConfigToml: (text: string, path: string) => MaybePromise<void>;
  readonly runtimeInfo: () => MaybePromise<DoctorRuntimeInfo>;
}

export async function handleDoctor(
  deps: Partial<DoctorDeps> | undefined,
  options: DoctorOptions,
): Promise<number> {
  const resolved = resolveDeps(deps);
  const cwd = resolved.cwd();
  const specs = await buildCheckSpecs(resolved, options, cwd);
  const [results, runtimeInfo] = await Promise.all([
    Promise.all(specs.map((spec) => checkTomlFile(resolved, spec))),
    options.target === undefined ? resolved.runtimeInfo() : undefined,
  ]);

  const issueCount = results.filter((result) => result.status === 'ERROR').length;
  const text =
    issueCount === 0
      ? formatSuccess(results, runtimeInfo)
      : formatFailure(results, issueCount, runtimeInfo);
  if (issueCount === 0) {
    resolved.stdout.write(text);
  } else {
    resolved.stderr.write(text);
  }
  return issueCount === 0 ? 0 : 1;
}

export function registerDoctorCommand(parent: Command, deps?: Partial<DoctorDeps>): void {
  const doctor = parent
    .command('doctor')
    .description('Validate Pythinker Code configuration files.')
    .action(async () => {
      await runDoctorCommand(deps, {});
    });

  doctor
    .command('config')
    .description('Validate config.toml.')
    .argument('[path]', 'Validate this file as config.toml instead of the default path.')
    .action(async (path: string | undefined) => {
      await runDoctorCommand(deps, { target: 'config', path });
    });

  doctor
    .command('tui')
    .description('Validate tui.toml.')
    .argument('[path]', 'Validate this file as tui.toml instead of the default path.')
    .action(async (path: string | undefined) => {
      await runDoctorCommand(deps, { target: 'tui', path });
    });
}

async function runDoctorCommand(
  deps: Partial<DoctorDeps> | undefined,
  options: DoctorOptions,
): Promise<void> {
  const resolved = resolveDeps(deps);
  const code = await handleDoctor(resolved, options);
  if (code !== 0) resolved.exit(code);
}

function resolveDeps(deps: Partial<DoctorDeps> | DoctorDeps | undefined): ResolvedDoctorDeps {
  let configRpc = deps?.configRpc;
  const getConfigRpc = (): PythinkerConfigRpc => {
    configRpc ??= createPythinkerConfigRpc();
    return configRpc;
  };

  return {
    cwd: deps?.cwd ?? (() => process.cwd()),
    defaultConfigPath: deps?.defaultConfigPath ?? (() => getConfigRpc().resolveConfigPath()),
    defaultTuiConfigPath: deps?.defaultTuiConfigPath ?? getTuiConfigPath,
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code) => process.exit(code)),
    fileExists: deps?.fileExists ?? existsSync,
    readTextFile: deps?.readTextFile ?? ((path) => readFile(path, 'utf-8')),
    validateConfigToml:
      deps?.validateConfigToml ??
      ((text, filePath) => getConfigRpc().validateConfigToml({ text, filePath })),
    runtimeInfo:
      deps?.runtimeInfo ??
      (async () => {
        const [installSource, installations, ripgrep, update, installState, autoInstall] = await Promise.all([
          detectInstallSource(),
          findPythinkerExecutables(),
          findExistingRg(resolvePythinkerHome()),
          readUpdateCache(),
          readUpdateInstallState(),
          shouldAutoInstallUpdates(),
        ]);
        return {
          version: getVersion(),
          installSource,
          packageRoot: findHostPackageRoot() ?? undefined,
          executable: process.execPath,
          installations,
          ripgrep,
          update: {
            latest: update.latest,
            checkedAt: update.checkedAt,
            autoUpdate: isAutoUpdateDisabledByEnv() ? 'env-disabled' : autoInstall ? 'on' : 'off',
            mode: automaticUpdateModeFor(installSource, process.platform),
            pendingVersion: installState.pending?.version,
            pendingRequestedBy: installState.pending?.requestedBy,
            activeOperation:
              installState.active === null
                ? undefined
                : `${installState.active.operation ?? 'install'} ${installState.active.version}`,
            lastSuccess:
              installState.lastSuccess === null
                ? undefined
                : `${installState.lastSuccess.version} (installed ` +
                  `${installState.lastSuccess.installedAt})` +
                  (installState.lastSuccess.unverified === undefined
                    ? ''
                    : ` — unverified: ${installState.lastSuccess.unverified}`),
            lastFailure:
              installState.lastFailure === null
                ? undefined
                : formatUpdateFailure(installState.lastFailure),
            logPath: getUpdateInstallLogFile(),
          },
        };
      }),
  };
}

function formatUpdateFailure(failure: UpdateInstallFailure): string {
  const summary = `${failure.operation ?? 'install'} ${failure.version} ` +
    `(attempt ${String(failure.attempts)})`;
  const message = failure.message?.replaceAll(/\s+/gu, ' ').trim();
  return message === undefined || message === '' ? summary : `${summary}: ${message}`;
}

export async function findPythinkerExecutables(
  pathValue = process.env['PATH'],
  platform: NodeJS.Platform = process.platform,
): Promise<readonly string[]> {
  if (pathValue === undefined || pathValue === '') return [];
  const names =
    platform === 'win32'
      ? ['pythinker.exe', 'pythinker.cmd', 'pythinker.bat', 'pythinker']
      : ['pythinker'];
  const installations = new Map<string, string>();
  for (const directory of pathValue.split(platform === 'win32' ? ';' : ':')) {
    for (const name of names) {
      const candidate = resolve(directory === '' ? '.' : directory, name);
      try {
        await access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
        const target = await realpath(candidate);
        if (!installations.has(target)) installations.set(target, candidate);
      } catch {
        // Missing and non-executable PATH entries are not installations.
      }
    }
  }
  return [...installations.values()];
}

async function buildCheckSpecs(
  deps: ResolvedDoctorDeps,
  options: DoctorOptions,
  cwd: string,
): Promise<CheckSpec[]> {
  if (options.target === 'config') {
    return [
      makeConfigSpec(
        await resolveConfigTargetPath(deps, options.path, cwd),
        options.path !== undefined,
        deps,
      ),
    ];
  }

  if (options.target === 'tui') {
    return [
      makeTuiSpec(
        resolveTuiTargetPath(deps, options.path, cwd),
        options.path !== undefined,
      ),
    ];
  }

  return [
    makeConfigSpec(await deps.defaultConfigPath(), false, deps),
    makeTuiSpec(deps.defaultTuiConfigPath(), false),
  ];
}

function makeConfigSpec(
  path: string,
  explicit: boolean,
  deps: ResolvedDoctorDeps,
): CheckSpec {
  return {
    label: 'config.toml',
    path,
    explicit,
    parse: (text, filePath) => {
      return deps.validateConfigToml(text, filePath);
    },
  };
}

function makeTuiSpec(path: string, explicit: boolean): CheckSpec {
  return {
    label: 'tui.toml',
    path,
    explicit,
    parse: (text) => {
      parseTuiConfig(text);
    },
  };
}

async function checkTomlFile(deps: ResolvedDoctorDeps, spec: CheckSpec): Promise<CheckResult> {
  if (!deps.fileExists(spec.path)) {
    return {
      label: spec.label,
      path: spec.path,
      status: spec.explicit ? 'ERROR' : 'SKIP',
      message: spec.explicit
        ? 'File does not exist.'
        : 'File does not exist; built-in defaults will apply.',
    };
  }

  try {
    const text = await deps.readTextFile(spec.path);
    await spec.parse(text, spec.path);
    return { label: spec.label, path: spec.path, status: 'OK' };
  } catch (error) {
    return {
      label: spec.label,
      path: spec.path,
      status: 'ERROR',
      message: formatErrorMessage(error, spec.path),
    };
  }
}

async function resolveConfigTargetPath(
  deps: ResolvedDoctorDeps,
  input: string | undefined,
  cwd: string,
): Promise<string> {
  return input === undefined ? deps.defaultConfigPath() : resolveInputPath(input, cwd);
}

function resolveTuiTargetPath(
  deps: ResolvedDoctorDeps,
  input: string | undefined,
  cwd: string,
): string {
  return input === undefined ? deps.defaultTuiConfigPath() : resolveInputPath(input, cwd);
}

function resolveInputPath(input: string, cwd: string): string {
  return isAbsolute(input) ? input : resolve(cwd, input);
}

function formatSuccess(
  results: readonly CheckResult[],
  runtimeInfo: DoctorRuntimeInfo | undefined,
): string {
  return [
    'Pythinker doctor',
    '',
    ...formatRuntimeInfo(runtimeInfo),
    ...formatResults(results),
    '',
    'All checked config files are valid.',
    '',
  ].join('\n');
}

function formatFailure(
  results: readonly CheckResult[],
  issueCount: number,
  runtimeInfo: DoctorRuntimeInfo | undefined,
): string {
  return [
    `Pythinker doctor found ${String(issueCount)} ${issueCount === 1 ? 'issue' : 'issues'}.`,
    '',
    ...formatRuntimeInfo(runtimeInfo),
    ...formatResults(results),
    '',
  ].join('\n');
}

function formatRuntimeInfo(info: DoctorRuntimeInfo | undefined): string[] {
  if (info === undefined) return [];
  const installations = info.installations ?? [];
  return [
    'Runtime',
    `  Version: ${info.version}`,
    `  Install source: ${info.installSource}`,
    ...(info.packageRoot === undefined ? [] : [`  Package root: ${info.packageRoot}`]),
    `  Executable: ${info.executable}`,
    ...(installations.length > 1
      ? [
          '  Warning: Multiple Pythinker executables found on PATH:',
          ...installations.map((path) => `    ${path}`),
        ]
      : []),
    ...(info.ripgrep === undefined
      ? []
      : [`  Search: ${info.ripgrep.path} (${info.ripgrep.source})`]),
    ...(info.update === undefined
      ? []
      : [
          '  Update channel: CDN staged rollout',
          ...formatAutomaticUpdate(info),
          ...(info.update.latest === null
            ? ['  Latest cached version: unavailable']
            : [
                `  Latest cached version: ${info.update.latest}${
                  info.update.checkedAt === null ? '' : ` (checked ${info.update.checkedAt})`
                }`,
              ]),
          ...formatPreparedUpdate(info.update),
          ...(info.update.activeOperation === undefined
            ? []
            : [`  Update operation: ${info.update.activeOperation}`]),
          ...(info.update.lastSuccess === undefined
            ? []
            : [`  Last update success: ${info.update.lastSuccess}`]),
          ...(info.update.lastFailure === undefined
            ? []
            : [`  Last update failure: ${info.update.lastFailure}`]),
          ...(info.update.logPath === undefined ? [] : [`  Update log: ${info.update.logPath}`]),
        ]),
    '',
  ];
}

function formatPreparedUpdate(
  update: NonNullable<DoctorRuntimeInfo['update']>,
): string[] {
  if (update.pendingVersion === undefined) return [];
  if (update.pendingRequestedBy === 'automatic' && update.autoUpdate !== 'on') {
    return [
      `  Prepared update: ${update.pendingVersion} ` +
        '(automatic activation paused until auto-update is enabled)',
    ];
  }
  return [`  Prepared update: ${update.pendingVersion} (installs on next launch)`];
}

function formatAutomaticUpdate(info: DoctorRuntimeInfo): string[] {
  const update = info.update;
  if (update?.autoUpdate === undefined) return [];
  if (update.autoUpdate === 'env-disabled') {
    return [
      '  Auto-update: disabled by PYTHINKER_CODE_NO_AUTO_UPDATE or ' +
        'PYTHINKER_CLI_NO_AUTO_UPDATE',
    ];
  }
  if (update.autoUpdate === 'off') {
    return ['  Auto-update: off (tui.toml [upgrade].auto_install)'];
  }
  switch (update.mode) {
    case 'restart-install':
      return ['  Auto-update: on (prepare in background; install on next launch)'];
    case 'background-install':
      return ['  Auto-update: on (installs in background)'];
    case 'manual':
      return [`  Auto-update: unavailable for ${info.installSource}`];
    case undefined:
      return ['  Auto-update: on (tui.toml [upgrade].auto_install)'];
  }
}

function formatResults(results: readonly CheckResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(`${result.status} ${result.label.padEnd(12)} ${result.path}`);
    if (result.message !== undefined) {
      for (const line of result.message.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  }
  return lines;
}

function formatErrorMessage(error: unknown, filePath: string): string {
  const validationIssues = findValidationIssues(error);
  if (validationIssues !== undefined) {
    return [
      `Invalid configuration in ${filePath}.`,
      'Validation issues:',
      ...validationIssues.map((issue) => `  ${formatIssuePath(issue.path)}: ${issue.message}`),
    ].join('\n');
  }

  const zodError = findZodError(error);
  if (zodError !== undefined) {
    return [
      `Invalid configuration in ${filePath}.`,
      'Validation issues:',
      ...zodError.issues.map((issue) => `  ${formatIssuePath(issue.path)}: ${issue.message}`),
    ].join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}

function findValidationIssues(error: unknown): readonly PythinkerConfigValidationIssue[] | undefined {
  if (!(error instanceof Error)) return undefined;
  const details = 'details' in error ? error.details : undefined;
  if (!isRecord(details)) return undefined;
  const validationIssues = details['validationIssues'];
  return isValidationIssueArray(validationIssues) ? validationIssues : undefined;
}

function isValidationIssueArray(value: unknown): value is readonly PythinkerConfigValidationIssue[] {
  return Array.isArray(value) && value.every(isValidationIssue);
}

function isValidationIssue(value: unknown): value is PythinkerConfigValidationIssue {
  if (!isRecord(value) || typeof value['message'] !== 'string') return false;
  const path = value['path'];
  return (
    Array.isArray(path) &&
    path.every((segment) => typeof segment === 'string' || typeof segment === 'number')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '<root>';

  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${String(segment)}]`;
    } else if (out.length === 0) {
      out = camelToSnake(String(segment));
    } else {
      out += `.${camelToSnake(String(segment))}`;
    }
  }
  return out;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
