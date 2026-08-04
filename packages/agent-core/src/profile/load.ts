import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, normalize, relative } from 'pathe';

import { load as loadYaml } from 'js-yaml';

import type { PluginAgentProfileSource } from '../plugin/types';
import { parseFrontmatterHooks } from '../config/schema';
import { parseFrontmatter } from '../skill/parser';
import { resolveAgentProfiles } from './resolve';
import { RawAgentProfileSchema, type RawAgentProfile, type ResolvedAgentProfile } from './types';

export async function loadAgentProfilesFromDir(
  paths: readonly string[],
): Promise<Record<string, ResolvedAgentProfile>> {
  const rawProfiles = await loadRawAgentProfiles(paths);
  return resolveAgentProfiles(rawProfiles);
}

export interface AgentProfileDirectoryLoadResult {
  readonly profiles: Record<string, ResolvedAgentProfile>;
  readonly failures: Array<{ readonly path: string; readonly error: string }>;
}

/**
 * Load one profile scope per directory. Later directories override earlier
 * scopes by profile name, matching project-over-user configuration precedence.
 */
export async function loadAgentProfilesFromDirectories(
  directories: readonly string[],
): Promise<AgentProfileDirectoryLoadResult> {
  const profiles: Record<string, ResolvedAgentProfile> = {};
  const failures: Array<{ path: string; error: string }> = [];

  for (const directory of directories) {
    let entries: string[];
    try {
      entries = (await readdir(directory))
        .filter((entry) => /\.ya?ml$/iu.test(entry))
        .toSorted();
    } catch (error) {
      if (isFileNotFound(error)) continue;
      failures.push({ path: directory, error: errorMessage(error) });
      continue;
    }
    try {
      Object.assign(
        profiles,
        await loadAgentProfilesFromDir(entries.map((entry) => join(directory, entry))),
      );
    } catch (error) {
      failures.push({ path: directory, error: errorMessage(error) });
    }
  }

  return { profiles, failures };
}

export async function loadPluginAgentProfiles(
  sources: readonly PluginAgentProfileSource[],
): Promise<AgentProfileDirectoryLoadResult> {
  const profiles: Record<string, ResolvedAgentProfile> = {};
  const failures: Array<{ path: string; error: string }> = [];

  for (const source of sources) {
    const loadedPaths = new Set<string>();
    for (const declaredPath of source.paths) {
      let files: readonly PluginAgentFile[];
      try {
        files = await findPluginAgentFiles(declaredPath);
      } catch (error) {
        failures.push({ path: declaredPath, error: errorMessage(error) });
        continue;
      }
      for (const file of files) {
        if (loadedPaths.has(file.path)) continue;
        loadedPaths.add(file.path);
        try {
          const raw = parsePluginAgentProfile(
            await readFile(file.path, 'utf8'),
            file,
            source,
          );
          Object.assign(profiles, resolveAgentProfiles([raw]));
        } catch (error) {
          failures.push({ path: file.path, error: errorMessage(error) });
        }
      }
    }
  }

  return { profiles, failures };
}

export function loadAgentProfilesFromSources(
  paths: readonly string[],
  sources: Readonly<Record<string, string>>,
): Record<string, ResolvedAgentProfile> {
  const rawProfiles = paths.map((profilePath) =>
    finalizeRawAgentProfileSource(readRequiredSource(sources, profilePath), profilePath, sources),
  );
  return resolveAgentProfiles(rawProfiles);
}

async function loadRawAgentProfiles(paths: readonly string[]): Promise<RawAgentProfile[]> {
  const profiles: RawAgentProfile[] = [];

  for (const profilePath of paths) {
    let content: string;
    try {
      content = await readFile(profilePath, 'utf-8');
    } catch (error) {
      if (isFileNotFound(error)) continue;
      throw readError('agent profile', profilePath, error);
    }
    profiles.push(await finalizeRawAgentProfile(content, profilePath));
  }

  return profiles;
}

async function finalizeRawAgentProfile(
  content: string,
  profilePath: string,
): Promise<RawAgentProfile> {
  const raw = parseAgentProfileYaml(content, profilePath);
  if (raw.systemPromptPath === undefined) return raw;
  const templatePath = join(dirname(profilePath), raw.systemPromptPath);
  try {
    return { ...raw, systemPromptTemplate: await readFile(templatePath, 'utf-8') };
  } catch (error) {
    throw new Error(
      `Failed to read system prompt template for "${raw.name}" at ${templatePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function finalizeRawAgentProfileSource(
  content: string,
  profilePath: string,
  sources: Readonly<Record<string, string>>,
): RawAgentProfile {
  const raw = parseAgentProfileYaml(content, profilePath);
  if (raw.systemPromptPath === undefined) return raw;
  const templatePath = resolveProfileSourcePath(profilePath, raw.systemPromptPath);
  return { ...raw, systemPromptTemplate: readRequiredSource(sources, templatePath) };
}

function parseAgentProfileYaml(content: string, profilePath: string): RawAgentProfile {
  let parsed: unknown;
  try {
    parsed = loadYaml(content);
  } catch (error) {
    throw new Error(
      `Invalid agent profile YAML at ${profilePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const result = RawAgentProfileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid agent profile at ${profilePath}`);
  }
  return result.data;
}

interface PluginAgentFile {
  readonly path: string;
  readonly namespace: readonly string[];
}

async function findPluginAgentFiles(declaredPath: string): Promise<readonly PluginAgentFile[]> {
  const details = await stat(declaredPath);
  if (details.isFile()) {
    return extname(declaredPath).toLowerCase() === '.md'
      ? [{ path: declaredPath, namespace: [] }]
      : [];
  }
  if (!details.isDirectory()) return [];

  const files: PluginAgentFile[] = [];
  await walkPluginAgentDirectory(declaredPath, declaredPath, files);
  return files;
}

async function walkPluginAgentDirectory(
  root: string,
  directory: string,
  files: PluginAgentFile[],
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkPluginAgentDirectory(root, entryPath, files);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      const namespace = relative(root, dirname(entryPath)).split('/').filter(Boolean);
      files.push({ path: entryPath, namespace });
    }
  }
}

function parsePluginAgentProfile(
  content: string,
  file: PluginAgentFile,
  source: PluginAgentProfileSource,
): RawAgentProfile {
  const parsed = parseFrontmatter(content);
  if (!isRecord(parsed.data)) {
    throw new Error(`Frontmatter in ${file.path} must be a mapping at the top level`);
  }
  const metadata = parsed.data;
  const fallbackName = basename(file.path, extname(file.path));
  const baseName = nonEmptyString(metadata['name']) ?? fallbackName;
  const description =
    scalarString(metadata['description']) ??
    scalarString(metadata['when-to-use']) ??
    `Agent from ${source.pluginId} plugin`;
  const model = nonEmptyString(metadata['model']);
  const raw: RawAgentProfile = {
    name: [source.pluginId, ...file.namespace, baseName].join(':'),
    description,
    systemPromptTemplate: parsed.body
      .trim()
      .replaceAll('${PYTHINKER_PLUGIN_ROOT}', source.pluginRoot)
      .replaceAll('${pythinker_PLUGIN_ROOT}', source.pluginRoot),
    tools: parseToolList(metadata['tools']),
    skills: parseToolList(metadata['skills']),
    disallowedTools: parseToolList(metadata['disallowedTools']),
    model: model?.toLowerCase() === 'inherit' ? undefined : model,
    effort: scalarString(metadata['effort']),
    background:
      metadata['background'] === true || metadata['background'] === 'true' ? true : undefined,
    maxTurns: positiveInteger(metadata['maxTurns']),
    isolation: metadata['isolation'] === 'worktree' ? 'worktree' : undefined,
    hooks: parseFrontmatterHooks(metadata['hooks']),
    memory:
      metadata['memory'] === 'user' ||
      metadata['memory'] === 'project' ||
      metadata['memory'] === 'local'
        ? metadata['memory']
        : undefined,
  };
  return RawAgentProfileSchema.parse(raw);
}

function parseToolList(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const entries =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
  const tools: string[] = [];
  for (const entry of entries) {
    let current = '';
    let parentheses = 0;
    for (const character of entry) {
      if (character === '(') parentheses++;
      if (character === ')') parentheses = Math.max(0, parentheses - 1);
      if ((character === ',' || /\s/u.test(character)) && parentheses === 0) {
        if (current.trim() !== '') tools.push(current.trim());
        current = '';
      } else {
        current += character;
      }
    }
    if (current.trim() !== '') tools.push(current.trim());
  }
  return tools;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }
  return nonEmptyString(String(value));
}

function positiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveProfileSourcePath(profilePath: string, relativePath: string): string {
  return normalizeSourcePath(
    join(dirname(normalizeSourcePath(profilePath)), relativePath),
  );
}

function readRequiredSource(sources: Readonly<Record<string, string>>, path: string): string {
  const normalized = normalizeSourcePath(path);
  const content = sources[normalized];
  if (content === undefined) {
    throw new Error(`Embedded agent profile source missing: ${normalized}`);
  }
  return content;
}

function normalizeSourcePath(path: string): string {
  return normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

function readError(label: string, filePath: string, error: unknown): Error {
  return new Error(
    `Failed to read ${label} at ${filePath}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
