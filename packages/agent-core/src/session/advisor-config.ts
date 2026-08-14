import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { isPlainRecord } from '../agent/turn/canonical-args';
import { findProjectRoot } from '../skill/scanner';

export interface AdvisorConfigEntry {
  readonly name: string;
  readonly model?: string;
  readonly tools?: readonly string[];
  readonly instructions?: string;
  readonly enabled?: boolean;
}

export type AdvisorRuntimeStatus =
  | 'running'
  | 'paused'
  | 'quota_exhausted'
  | 'error'
  | 'no_model';

export interface DiscoveredAdvisors {
  readonly advisors: readonly AdvisorConfigEntry[];
  readonly sharedInstructions?: string;
  readonly files: readonly string[];
}

export interface AdvisorStatusSnapshot {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly status: AdvisorRuntimeStatus;
  readonly model?: string;
  readonly failures: number;
  readonly notes: number;
  readonly costUsd: number;
  readonly message?: string;
}

interface WatchdogConfigDocument {
  readonly instructions?: unknown;
  readonly advisors?: unknown;
}

interface AdvisorConfigDocumentEntry {
  readonly name?: unknown;
  readonly model?: unknown;
  readonly tools?: unknown;
  readonly instructions?: unknown;
  readonly enabled?: unknown;
}

/**
 * Normalize a configured advisor name into a safe, stable runtime id.
 * Collisions are resolved by the discovery caller's last-writer-wins map.
 */
export function slugifyAdvisorName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
  return slug.length === 0 ? 'advisor' : slug;
}

/**
 * Discover WATCHDOG.md and WATCHDOG.yml files from user and project scopes.
 * User files are read first. Project files are then applied from ancestor to
 * leaf, so a more specific project entry replaces an earlier same-id entry.
 */
export async function discoverAdvisorConfigs(
  cwd: string,
  userHomeDir = homedir(),
  onWarning: (message: string, details?: Record<string, unknown>) => void = () => {},
): Promise<DiscoveredAdvisors> {
  const candidates = await collectConfigCandidates(
    cwd,
    userHomeDir,
    ['WATCHDOG.md', 'WATCHDOG.yml', 'WATCHDOG.yaml'],
    onWarning,
  );
  const watchdogPaths = candidates
    .filter((candidate) => candidate.fileName === 'WATCHDOG.md')
    .map((candidate) => candidate.path);
  const advisors = new Map<string, AdvisorConfigEntry>();
  const sharedParts: string[] = [];
  const configFiles: string[] = [];

  for (const candidate of candidates) {
    if (candidate.fileName === 'WATCHDOG.md') {
      const content = candidate.content.trim();
      if (content.length > 0) {
        sharedParts.push(`Especially pay attention to:\n<attention>\n${content}\n</attention>`);
      }
      continue;
    }
    configFiles.push(candidate.path);
    let parsed: unknown;
    try {
      parsed = loadYaml(candidate.content);
    } catch (error) {
      onWarning('Advisor config YAML could not be parsed', {
        path: candidate.path,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!isPlainRecord(parsed)) {
      onWarning('Advisor config must be a YAML mapping', { path: candidate.path });
      continue;
    }

    const document = parsed as WatchdogConfigDocument;
    if (typeof document.instructions === 'string' && document.instructions.trim().length > 0) {
      sharedParts.push(document.instructions.trim());
    }
    if (document.advisors === undefined) continue;
    if (!Array.isArray(document.advisors)) {
      onWarning('Advisor config advisors must be a YAML list', { path: candidate.path });
      continue;
    }

    for (const rawEntry of document.advisors) {
      if (!isPlainRecord(rawEntry)) {
        onWarning('Advisor config entry must be a YAML mapping', { path: candidate.path });
        continue;
      }
      const entry = rawEntry as AdvisorConfigDocumentEntry;
      if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
        onWarning('Advisor config entry requires a name', { path: candidate.path });
        continue;
      }
      if (entry.model !== undefined && typeof entry.model !== 'string') {
        onWarning('Advisor config model must be a string', { path: candidate.path });
        continue;
      }
      if (entry.instructions !== undefined && typeof entry.instructions !== 'string') {
        onWarning('Advisor config instructions must be a string', { path: candidate.path });
        continue;
      }
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
        onWarning('Advisor config enabled must be a boolean', { path: candidate.path });
        continue;
      }
      const tools = normalizeTools(entry.tools, candidate.path, onWarning);
      if (entry.tools !== undefined && tools === undefined) continue;
      const config: AdvisorConfigEntry = {
        name: entry.name.trim(),
        model: normalizeOptionalString(entry.model),
        tools,
        instructions: normalizeOptionalString(entry.instructions),
        enabled: entry.enabled,
      };
      advisors.set(slugifyAdvisorName(config.name), config);
    }
  }

  return {
    advisors: [...advisors.values()],
    sharedInstructions: sharedParts.length > 0 ? sharedParts.join('\n\n') : undefined,
    files: [...new Set([...watchdogPaths, ...configFiles])],
  };
}

interface ConfigCandidate {
  readonly path: string;
  readonly fileName: string;
  readonly content: string;
  readonly user: boolean;
  readonly depth: number;
}

async function collectConfigCandidates(
  cwd: string,
  userHomeDir: string,
  fileNames: readonly string[],
  onWarning: (message: string, details?: Record<string, unknown>) => void,
): Promise<ConfigCandidate[]> {
  const resolvedCwd = path.resolve(cwd);
  const userDirs = uniquePaths([
    userHomeDir,
    path.join(userHomeDir, '.pythinker-code'),
    path.join(userHomeDir, '.agents'),
  ]);
  const candidates: Array<{ readonly path: string; readonly user: boolean; readonly depth: number }> = [];

  for (const directory of userDirs) {
    for (const fileName of fileNames) {
      candidates.push({ path: path.join(directory, fileName), user: true, depth: -1 });
    }
  }

  const projectRoot = await findProjectRoot(resolvedCwd);
  const projectDirs: string[] = [];
  let current = resolvedCwd;
  while (true) {
    projectDirs.push(current);
    if (current === projectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  projectDirs.reverse();
  for (const [depth, directory] of projectDirs.entries()) {
    for (const fileName of fileNames) {
      candidates.push(
        { path: path.join(directory, fileName), user: false, depth },
        { path: path.join(directory, '.omp', fileName), user: false, depth },
      );
    }
  }

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) unique.set(path.resolve(candidate.path), candidate);
  const results = await Promise.all(
    [...unique.values()].map(async (candidate) => {
      try {
        const content = await readFile(candidate.path, 'utf8');
        return { candidate, content };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        return { candidate, error };
      }
    }),
  );
  const readable: ConfigCandidate[] = [];
  for (const result of results) {
    if (result === undefined) continue;
    if ('error' in result) {
      onWarning('Advisor config could not be read', {
        path: result.candidate.path,
        error: result.error instanceof Error ? result.error.message : String(result.error),
      });
      continue;
    }
    readable.push({
      ...result.candidate,
      path: path.resolve(result.candidate.path),
      fileName: path.basename(result.candidate.path),
      content: result.content,
    });
  }
  readable.sort((left, right) => {
    if (left.user !== right.user) return left.user ? -1 : 1;
    return left.depth - right.depth;
  });
  return readable;
}

function normalizeTools(
  value: unknown,
  sourcePath: string,
  onWarning: (message: string, details?: Record<string, unknown>) => void,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    onWarning('Advisor config tools must be a YAML list', { path: sourcePath });
    return undefined;
  }
  const tools: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      onWarning('Advisor config tool names must be non-empty strings', { path: sourcePath });
      return undefined;
    }
    const name = item.trim();
    if (!tools.includes(name)) tools.push(name);
  }
  return tools;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((entry) => path.resolve(entry)))];
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}