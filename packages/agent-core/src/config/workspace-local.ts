import type { Pyaos } from '@pymodel/pyaos';
import { dirname, isAbsolute, join, normalize, resolve } from 'pathe';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';

import { ErrorCodes, PythinkerError } from '#/errors';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;

const WorkspaceLocalTomlSchema = z.object({
  workspace: z
    .object({
      additional_dir: z.array(z.string()),
    })
    .optional(),
});

type WorkspaceLocalToml = z.infer<typeof WorkspaceLocalTomlSchema>;

export interface WorkspaceAdditionalDirsLoadResult {
  readonly projectRoot: string;
  readonly configPath: string;
  readonly additionalDirs: readonly string[];
  readonly warning?: string;
}

export type WorkspaceLocalConfig = WorkspaceAdditionalDirsLoadResult;

interface WorkspaceLocalTomlFile {
  readonly raw: Record<string, unknown>;
  readonly parsed: WorkspaceLocalToml;
}

export async function loadWorkspaceLocalConfig(
  pyaos: Pyaos,
  workDir: string,
): Promise<WorkspaceLocalConfig> {
  const projectRoot = await findProjectRoot(pyaos, workDir);
  const configPath = getWorkspaceLocalConfigPath(projectRoot);
  const file = await readWorkspaceLocalToml(pyaos, configPath);

  const additionalDirs = file?.parsed.workspace?.additional_dir;
  if (additionalDirs === undefined) {
    return { projectRoot, configPath, additionalDirs: [] };
  }

  return {
    projectRoot,
    configPath,
    additionalDirs: await resolveAdditionalDirs(pyaos, projectRoot, additionalDirs),
  };
}

export async function readWorkspaceAdditionalDirs(
  pyaos: Pyaos,
  workDir: string,
): Promise<WorkspaceAdditionalDirsLoadResult> {
  return loadWorkspaceLocalConfig(pyaos, workDir);
}

export async function resolveWorkspaceAdditionalDirs(
  pyaos: Pyaos,
  projectRoot: string,
  additionalDirs: readonly string[],
): Promise<string[]> {
  return resolveAdditionalDirs(pyaos, projectRoot, additionalDirs);
}

export async function appendWorkspaceAdditionalDir(
  pyaos: Pyaos,
  workDir: string,
  inputPath: string,
  _currentAdditionalDirs: readonly string[],
): Promise<WorkspaceAdditionalDirsLoadResult> {
  const projectRoot = await findProjectRoot(pyaos, workDir);
  const configPath = getWorkspaceLocalConfigPath(projectRoot);
  const additionalDir = await resolveAdditionalDir(pyaos, workDir, inputPath);
  const file = (await readWorkspaceLocalToml(pyaos, configPath)) ?? { raw: {}, parsed: {} };
  const fileAdditionalDirs = file.parsed.workspace?.additional_dir ?? [];
  const fileExistingDirs = resolveExistingAdditionalDirs(pyaos, projectRoot, fileAdditionalDirs);

  if (hasSameAdditionalDir(pyaos, fileExistingDirs, additionalDir)) {
    return { projectRoot, configPath, additionalDirs: fileExistingDirs };
  }

  const workspace = cloneRecord(file.raw['workspace']);
  workspace['additional_dir'] = [...fileExistingDirs, additionalDir];
  file.raw['workspace'] = workspace;

  await pyaos.mkdir(dirname(configPath), { parents: true, existOk: true });
  await pyaos.writeText(configPath, `${stringifyToml(file.raw)}\n`);

  return { projectRoot, configPath, additionalDirs: [...fileExistingDirs, additionalDir] };
}

export function normalizeAdditionalDirs(additionalDirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalizedDirs: string[] = [];

  for (const additionalDir of additionalDirs) {
    const normalized = normalize(additionalDir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedDirs.push(normalized);
  }

  return normalizedDirs;
}

function getWorkspaceLocalConfigPath(projectRoot: string): string {
  return join(projectRoot, '.pythinker-code', 'local.toml');
}

async function findProjectRoot(pyaos: Pyaos, workDir: string): Promise<string> {
  const initial = resolveWorkDir(pyaos, workDir);
  let current = initial;

  for (;;) {
    if (await pathExists(pyaos, join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return initial;
    current = parent;
  }
}

function resolveWorkDir(pyaos: Pyaos, workDir: string): string {
  return isAbsolute(workDir) ? pyaos.normpath(workDir) : resolve(pyaos.getcwd(), workDir);
}

async function readWorkspaceLocalToml(
  pyaos: Pyaos,
  configPath: string,
): Promise<WorkspaceLocalTomlFile | undefined> {
  let text: string;
  try {
    text = await pyaos.readText(configPath);
  } catch (error: unknown) {
    if (isPathMissing(error)) return undefined;
    throw new PythinkerError(
      ErrorCodes.CONFIG_INVALID,
      `Failed to read ${configPath}: ${describeError(error)}`,
      { cause: error },
    );
  }

  if (text.trim().length === 0) return { raw: {}, parsed: {} };

  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch (error: unknown) {
    throw new PythinkerError(
      ErrorCodes.CONFIG_INVALID,
      `Invalid TOML in ${configPath}: ${describeError(error)}`,
      { cause: error },
    );
  }

  if (!isPlainObject(raw)) {
    throw new PythinkerError(ErrorCodes.CONFIG_INVALID, `Invalid workspace local config in ${configPath}`);
  }

  return { raw: cloneRecord(raw), parsed: parseWorkspaceLocalToml(raw) };
}

function parseWorkspaceLocalToml(raw: Record<string, unknown>): WorkspaceLocalToml {
  try {
    return WorkspaceLocalTomlSchema.parse(raw);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      throw new PythinkerError(ErrorCodes.CONFIG_INVALID, describeWorkspaceLocalValidationError(error), {
        cause: error,
      });
    }
    throw error;
  }
}

function describeWorkspaceLocalValidationError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue?.path[0] === 'workspace' && issue.path[1] === 'additional_dir') {
    return 'workspace.additional_dir must be an array of strings';
  }
  if (issue?.path[0] === 'workspace') return 'workspace must be a table';
  return `Invalid workspace local config: ${error.message}`;
}

async function resolveAdditionalDirs(
  pyaos: Pyaos,
  projectRoot: string,
  additionalDirs: readonly string[],
): Promise<string[]> {
  const resolvedDirs: string[] = [];

  for (const additionalDir of normalizeAdditionalDirs(additionalDirs)) {
    const resolvedDir = await resolveAdditionalDir(pyaos, projectRoot, additionalDir);
    if (hasSameAdditionalDir(pyaos, resolvedDirs, resolvedDir)) continue;
    resolvedDirs.push(resolvedDir);
  }

  return resolvedDirs;
}

function resolveExistingAdditionalDirs(
  pyaos: Pyaos,
  projectRoot: string,
  additionalDirs: readonly string[],
): string[] {
  const resolvedDirs: string[] = [];

  for (const additionalDir of normalizeAdditionalDirs(additionalDirs)) {
    const resolvedDir = resolvePath(pyaos, projectRoot, additionalDir);
    if (hasSameAdditionalDir(pyaos, resolvedDirs, resolvedDir)) continue;
    resolvedDirs.push(resolvedDir);
  }

  return resolvedDirs;
}

async function resolveAdditionalDir(
  pyaos: Pyaos,
  projectRoot: string,
  additionalDir: string,
): Promise<string> {
  const normalizedInput = normalizeAdditionalDirInput(additionalDir);
  const resolvedDir = resolvePath(pyaos, projectRoot, normalizedInput);
  await assertDirectory(pyaos, resolvedDir);
  return resolvedDir;
}

function normalizeAdditionalDirInput(additionalDir: string): string {
  if (typeof additionalDir !== 'string') {
    throw new PythinkerError(ErrorCodes.CONFIG_INVALID, 'workspace.additional_dir must be an array of strings');
  }
  const trimmed = additionalDir.trim();
  if (trimmed.length === 0) {
    throw new PythinkerError(
      ErrorCodes.CONFIG_INVALID,
      'workspace.additional_dir must exist and be a directory',
    );
  }
  return normalize(trimmed);
}

function resolvePath(pyaos: Pyaos, projectRoot: string, additionalDir: string): string {
  const expanded = expandHome(pyaos, additionalDir);
  return isAbsolute(expanded) ? normalize(expanded) : resolve(projectRoot, expanded);
}

function expandHome(pyaos: Pyaos, value: string): string {
  if (value === '~') return pyaos.gethome();
  if (value.startsWith('~/')) return join(pyaos.gethome(), value.slice(2));
  return value;
}

function hasSameAdditionalDir(pyaos: Pyaos, dirs: readonly string[], target: string): boolean {
  const normalizedTarget = normalizeForCompare(pyaos, target);
  return dirs.some((dir) => normalizeForCompare(pyaos, dir) === normalizedTarget);
}

function normalizeForCompare(pyaos: Pyaos, filePath: string): string {
  return pyaos.normpath(filePath);
}

async function assertDirectory(pyaos: Pyaos, filePath: string): Promise<void> {
  try {
    const stat = await pyaos.stat(filePath);
    if ((stat.stMode & S_IFMT) === S_IFDIR) return;
  } catch (error: unknown) {
    if (isPathMissing(error)) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        'workspace.additional_dir must exist and be a directory',
      );
    }
    throw new PythinkerError(
      ErrorCodes.CONFIG_INVALID,
      `Failed to stat ${filePath}: ${describeError(error)}`,
      { cause: error },
    );
  }

  throw new PythinkerError(
    ErrorCodes.CONFIG_INVALID,
    'workspace.additional_dir must exist and be a directory',
  );
}

async function pathExists(pyaos: Pyaos, filePath: string): Promise<boolean> {
  try {
    await pyaos.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPathMissing(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function getErrorCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return (error as { code: unknown }).code;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
