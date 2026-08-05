import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PluginInstallOptions, PluginSummary } from '@pythoughts/pythinker-code-sdk';
import { gt, valid } from 'semver';

import {
  ANTHROPIC_PLUGIN_MARKETPLACE_ALIAS,
  ANTHROPIC_PLUGIN_MARKETPLACE_REPOSITORY,
  CLAUDE_PLUGIN_MARKETPLACE_PATH,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_ALIAS,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV,
} from '#/constant/app';

export const PLUGIN_MARKETPLACE_TIERS = ['official', 'curated'] as const;
const DEFAULT_PLUGIN_MARKETPLACE_FETCH_TIMEOUT_MS = 15_000;

export type PluginMarketplaceTier = (typeof PLUGIN_MARKETPLACE_TIERS)[number];
export type PluginMarketplaceFormat = 'pythinker' | 'claude';
export type PluginMarketplaceSupportedComponent =
  | 'skills'
  | 'agents'
  | 'mcpServers'
  | 'lspServers'
  | 'outputStyles';

export interface PluginMarketplaceAuthor {
  readonly name: string;
  readonly email?: string;
  readonly url?: string;
}

export type PluginMarketplaceInstall =
  | {
      readonly kind: 'supported';
      readonly source: string;
      readonly options: PluginInstallOptions;
    }
  | {
      readonly kind: 'unsupported';
      readonly reason: string;
    };

export interface PluginMarketplaceEntry {
  readonly id: string;
  readonly displayName: string;
  /** Canonical install source when supported; otherwise the human-readable source label. */
  readonly source: string;
  readonly sourceLabel: string;
  readonly marketplaceName: string;
  readonly marketplaceOwner?: string;
  readonly tier?: PluginMarketplaceTier;
  readonly version?: string;
  readonly description?: string;
  readonly author?: PluginMarketplaceAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly category?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly strict?: boolean;
  readonly defaultEnabled?: boolean;
  readonly supportedComponents: readonly PluginMarketplaceSupportedComponent[];
  readonly unsupportedComponents: readonly string[];
  readonly declaredRef?: string;
  readonly effectiveSha?: string;
  readonly github?: {
    readonly owner: string;
    readonly repo: string;
  };
  readonly repositorySubdirectory?: string;
  readonly install: PluginMarketplaceInstall;
}

export interface PluginMarketplace {
  readonly format: PluginMarketplaceFormat;
  readonly source: string;
  readonly sourceLabel: string;
  readonly name: string;
  readonly owner?: PluginMarketplaceAuthor;
  readonly description?: string;
  readonly version?: string;
  readonly plugins: readonly PluginMarketplaceEntry[];
}

export type PluginUpdateStatus =
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'up-to-date'; readonly version?: string }
  | { readonly kind: 'update'; readonly local: string; readonly latest: string };

/** Compare marketplace and installed semver without inventing updates for opaque versions. */
export function computeUpdateStatus(
  latest: string | undefined,
  local: string | undefined,
  installed: boolean,
): PluginUpdateStatus {
  if (!installed) return { kind: 'not-installed' };
  if (
    latest !== undefined &&
    local !== undefined &&
    valid(latest) !== null &&
    valid(local) !== null &&
    gt(latest, local)
  ) {
    return { kind: 'update', local, latest };
  }
  return { kind: 'up-to-date', version: local };
}

export function computeMarketplaceEntryStatus(
  entry: PluginMarketplaceEntry,
  installed: PluginSummary | undefined,
): PluginUpdateStatus {
  if (installed === undefined) return { kind: 'not-installed' };

  const latestSha = entry.effectiveSha?.toLowerCase();
  const installedSha = (
    installed.github?.installedSha ??
    (installed.github?.ref.kind === 'sha' ? installed.github.ref.value : undefined)
  )?.toLowerCase();
  const sameRepository =
    entry.github !== undefined &&
    installed.github !== undefined &&
    entry.github.owner.toLowerCase() === installed.github.owner.toLowerCase() &&
    entry.github.repo.toLowerCase() === installed.github.repo.toLowerCase();

  if (latestSha !== undefined && installedSha !== undefined && sameRepository) {
    return latestSha === installedSha
      ? { kind: 'up-to-date', version: installed.version }
      : { kind: 'update', local: installedSha, latest: latestSha };
  }
  return computeUpdateStatus(entry.version, installed.version, true);
}

interface GithubRepositoryContext {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
}

export interface MarketplaceLocation {
  readonly kind: 'remote' | 'local';
  readonly resolved: string;
  readonly sourceLabel: string;
  readonly marketplaceRoot?: string;
  readonly github?: GithubRepositoryContext;
}

export interface LoadPluginMarketplaceOptions {
  readonly workDir: string;
  readonly source?: string;
  readonly fetchImpl?: typeof fetch;
  readonly fetchTimeoutMs?: number;
}

export async function loadPluginMarketplace(
  options: LoadPluginMarketplaceOptions,
): Promise<PluginMarketplace> {
  const location = await resolveMarketplaceLocation(options.source, options.workDir);
  const raw = await readMarketplaceText(
    location,
    options.fetchImpl ?? fetch,
    options.fetchTimeoutMs ?? DEFAULT_PLUGIN_MARKETPLACE_FETCH_TIMEOUT_MS,
  );
  return parsePluginMarketplace(raw, location);
}

export function parsePluginMarketplace(
  raw: string,
  location: MarketplaceLocation,
): PluginMarketplace {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Plugin marketplace is not valid JSON: ${formatParseError(error)}`, {
      cause: error,
    });
  }

  if (!isRecord(parsed)) throw new TypeError('Plugin marketplace must be an object.');
  const rawPlugins = parsed['plugins'];
  if (!Array.isArray(rawPlugins)) {
    throw new TypeError('Plugin marketplace must contain a "plugins" array.');
  }

  const format = detectMarketplaceFormat(parsed, rawPlugins);
  const owner = format === 'claude'
    ? requiredAuthor(parsed['owner'], 'Claude plugin marketplace "owner"')
    : optionalAuthor(parsed['owner'], 'Plugin marketplace "owner"');
  const name = format === 'claude'
    ? requiredCatalogString(parsed, 'name')
    : optionalStringField(parsed, 'name', 'Plugin marketplace') ?? 'Pythinker';
  const pluginRoot = format === 'claude' ? parseCatalogPluginRoot(parsed) : undefined;
  const context: CatalogContext = { format, name, owner, location, pluginRoot };
  const plugins = rawPlugins.map((entry, index) =>
    format === 'claude'
      ? parseClaudeMarketplaceEntry(entry, index, context)
      : parsePythinkerMarketplaceEntry(entry, index, context),
  );
  assertUniquePluginIds(plugins);

  return {
    format,
    source: location.resolved,
    sourceLabel: location.sourceLabel,
    name,
    owner,
    description: optionalStringField(parsed, 'description', 'Plugin marketplace'),
    version: optionalStringField(parsed, 'version', 'Plugin marketplace'),
    plugins,
  };
}

interface CatalogContext {
  readonly format: PluginMarketplaceFormat;
  readonly name: string;
  readonly owner?: PluginMarketplaceAuthor;
  readonly location: MarketplaceLocation;
  readonly pluginRoot?: string;
}

function parseCatalogPluginRoot(catalog: Record<string, unknown>): string | undefined {
  const metadata = catalog['metadata'];
  if (metadata === undefined) return undefined;
  if (!isRecord(metadata)) {
    throw new TypeError('Claude plugin marketplace "metadata" must be an object.');
  }
  return optionalStringField(metadata, 'pluginRoot', 'Claude plugin marketplace "metadata"');
}

async function resolveMarketplaceLocation(
  source: string | undefined,
  workDir: string,
): Promise<MarketplaceLocation> {
  const requested = source?.trim() || PYTHINKER_CODE_PLUGIN_MARKETPLACE_ALIAS;
  if (requested === PYTHINKER_CODE_PLUGIN_MARKETPLACE_ALIAS) {
    const configured = process.env[PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV]
      ?? PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL;
    if (configured.trim().length === 0) {
      throw new Error(`${PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV} cannot be empty.`);
    }
    return resolveExplicitMarketplaceLocation(configured, workDir, 'Pythinker');
  }
  if (requested === ANTHROPIC_PLUGIN_MARKETPLACE_ALIAS) {
    const repository = parseGithubRepository(ANTHROPIC_PLUGIN_MARKETPLACE_REPOSITORY)!;
    return githubMarketplaceLocation(repository, 'Anthropic official');
  }
  return resolveExplicitMarketplaceLocation(requested, workDir);
}

async function resolveExplicitMarketplaceLocation(
  source: string,
  workDir: string,
  sourceLabel = source,
): Promise<MarketplaceLocation> {
  const trimmed = source.trim();
  if (trimmed.length === 0) throw new Error('Plugin marketplace source cannot be empty.');
  if (trimmed.startsWith('file://')) {
    return localMarketplaceLocation(fileURLToPath(trimmed), sourceLabel);
  }
  if (isHttpUrl(trimmed)) {
    const github = parseGithubRepository(trimmed);
    if (github !== undefined) return githubMarketplaceLocation(github, sourceLabel);
    return { kind: 'remote', resolved: trimmed, sourceLabel };
  }

  const localPath = resolveLocalPath(trimmed, workDir);
  if (await pathExists(localPath)) return localMarketplaceLocation(localPath, sourceLabel);
  const github = parseGithubRepository(trimmed);
  if (github !== undefined) return githubMarketplaceLocation(github, sourceLabel);
  return localMarketplaceLocation(localPath, sourceLabel);
}

async function localMarketplaceLocation(
  inputPath: string,
  sourceLabel: string,
): Promise<MarketplaceLocation> {
  let catalogPath = inputPath;
  let marketplaceRoot: string;
  try {
    const info = await stat(inputPath);
    if (info.isDirectory()) {
      marketplaceRoot = inputPath;
      catalogPath = join(inputPath, CLAUDE_PLUGIN_MARKETPLACE_PATH);
    } else {
      marketplaceRoot = marketplaceRootForCatalogFile(inputPath);
    }
  } catch {
    marketplaceRoot = marketplaceRootForCatalogFile(inputPath);
  }
  return {
    kind: 'local',
    resolved: catalogPath,
    sourceLabel,
    marketplaceRoot,
  };
}

function githubMarketplaceLocation(
  github: GithubRepositoryContext,
  sourceLabel: string,
): MarketplaceLocation {
  return {
    kind: 'remote',
    resolved: rawGithubUrl(github, CLAUDE_PLUGIN_MARKETPLACE_PATH),
    sourceLabel,
    github,
  };
}

function marketplaceRootForCatalogFile(catalogPath: string): string {
  const parent = dirname(catalogPath);
  return parent.endsWith(`${sep}.claude-plugin`) ? dirname(parent) : parent;
}

/**
 * Read a marketplace document, local or remote. Remote reads race the
 * whole request — headers and body — against one deadline, aborting the
 * fetch via `AbortSignal` so a stalled marketplace cannot hang the CLI.
 */
async function readMarketplaceText(
  location: MarketplaceLocation,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  if (location.kind === 'local') return readFile(location.resolved, 'utf8');

  const duration = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.floor(timeoutMs))
    : DEFAULT_PLUGIN_MARKETPLACE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Plugin marketplace request timed out after ${String(duration)}ms.`);
      reject(error);
      controller.abort(error);
    }, duration);
  });

  try {
    const response = await Promise.race([
      fetchImpl(location.resolved, { signal: controller.signal }),
      deadline,
    ]);
    if (!response.ok) throw new Error(`Plugin marketplace returned HTTP ${response.status}`);
    return await Promise.race([response.text(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Decide the format from the entry shape, not the top-level keys: a
 * `name`/`owner` file may still be a Pythinker marketplace. Mixed entry
 * formats are rejected outright; with no entries the top-level keys
 * (`owner`/`metadata`) decide as a fallback.
 */
function detectMarketplaceFormat(
  value: Record<string, unknown>,
  plugins: readonly unknown[],
): PluginMarketplaceFormat {
  const hasPythinkerEntry = plugins.some(
    (plugin) => isRecord(plugin) && plugin['id'] !== undefined,
  );
  const hasClaudeEntry = plugins.some(
    (plugin) => isRecord(plugin) && plugin['id'] === undefined && plugin['name'] !== undefined,
  );
  if (hasPythinkerEntry && hasClaudeEntry) {
    throw new Error('Plugin marketplace cannot mix Pythinker and Claude entry formats.');
  }
  if (hasPythinkerEntry) return 'pythinker';
  if (hasClaudeEntry) return 'claude';
  return value['owner'] !== undefined || value['metadata'] !== undefined
    ? 'claude'
    : 'pythinker';
}

function parsePythinkerMarketplaceEntry(
  value: unknown,
  index: number,
  context: CatalogContext,
): PluginMarketplaceEntry {
  const entry = requiredEntryRecord(value, index);
  const id = requiredEntryString(entry, 'id', index);
  const sourceValue = optionalStringField(entry, 'source', `Plugin marketplace entry ${id}`)
    ?? optionalStringField(entry, 'url', `Plugin marketplace entry ${id}`)
    ?? optionalStringField(entry, 'downloadUrl', `Plugin marketplace entry ${id}`);
  if (sourceValue === undefined) {
    throw new Error(`Plugin marketplace entry ${id} must define "source".`);
  }
  const source = resolvePythinkerEntrySource(sourceValue, context.location);
  const displayName = optionalStringField(entry, 'displayName', `Plugin marketplace entry ${id}`)
    ?? optionalStringField(entry, 'name', `Plugin marketplace entry ${id}`)
    ?? id;
  const version = optionalStringField(entry, 'version', `Plugin marketplace entry ${id}`);
  const description = optionalStringField(entry, 'description', `Plugin marketplace entry ${id}`)
    ?? optionalStringField(entry, 'shortDescription', `Plugin marketplace entry ${id}`);
  const homepage = optionalStringField(entry, 'homepage', `Plugin marketplace entry ${id}`)
    ?? optionalStringField(entry, 'websiteURL', `Plugin marketplace entry ${id}`);
  const keywords = optionalStringArrayField(entry, 'keywords', `Plugin marketplace entry ${id}`);
  const tier = parseMarketplaceTier(entry, id);
  const options: PluginInstallOptions = {
    definition: { id, displayName, version, description, homepage, keywords },
  };

  return {
    id,
    displayName,
    source,
    sourceLabel: sourceValue,
    marketplaceName: context.name,
    marketplaceOwner: context.owner?.name,
    tier,
    version,
    description,
    author: optionalAuthor(entry['author'], `Plugin marketplace entry ${id} "author"`),
    homepage,
    repository: optionalStringField(entry, 'repository', `Plugin marketplace entry ${id}`),
    license: optionalStringField(entry, 'license', `Plugin marketplace entry ${id}`),
    category: optionalStringField(entry, 'category', `Plugin marketplace entry ${id}`),
    keywords,
    tags: optionalStringArrayField(entry, 'tags', `Plugin marketplace entry ${id}`),
    strict: undefined,
    defaultEnabled: undefined,
    supportedComponents: [],
    unsupportedComponents: [],
    declaredRef: undefined,
    effectiveSha: undefined,
    github: undefined,
    repositorySubdirectory: undefined,
    install: { kind: 'supported', source, options },
  };
}

function parseClaudeMarketplaceEntry(
  value: unknown,
  index: number,
  context: CatalogContext,
): PluginMarketplaceEntry {
  const entry = requiredEntryRecord(value, index);
  const id = requiredEntryString(entry, 'name', index);
  const displayName = optionalStringField(entry, 'displayName', `Plugin marketplace entry ${id}`) ?? id;
  const version = optionalStringField(entry, 'version', `Plugin marketplace entry ${id}`);
  const description = optionalStringField(entry, 'description', `Plugin marketplace entry ${id}`);
  const author = optionalAuthor(entry['author'], `Plugin marketplace entry ${id} "author"`);
  const homepage = optionalStringField(entry, 'homepage', `Plugin marketplace entry ${id}`);
  const explicitRepository = optionalStringField(entry, 'repository', `Plugin marketplace entry ${id}`);
  const license = optionalStringField(entry, 'license', `Plugin marketplace entry ${id}`);
  const category = optionalStringField(entry, 'category', `Plugin marketplace entry ${id}`);
  const keywords = optionalStringArrayField(entry, 'keywords', `Plugin marketplace entry ${id}`);
  const tags = optionalStringArrayField(entry, 'tags', `Plugin marketplace entry ${id}`);
  const strict = optionalBooleanField(entry, 'strict', `Plugin marketplace entry ${id}`);
  const defaultEnabled = optionalBooleanField(entry, 'defaultEnabled', `Plugin marketplace entry ${id}`);
  const supportedComponents = supportedComponentNames(entry);
  const unsupportedComponents = unsupportedComponentNames(entry);
  const resolved = resolveClaudeEntrySource(
    entry['source'],
    context.pluginRoot,
    context.location,
    id,
  );
  const components = supportedComponentDeclarations(entry);
  const repository = explicitRepository ?? (
    resolved.github === undefined
      ? undefined
      : `https://github.com/${resolved.github.owner}/${resolved.github.repo}`
  );
  const options: PluginInstallOptions = {
    repositorySubdirectory: resolved.repositorySubdirectory,
    definition: {
      id,
      displayName,
      version,
      description,
      author,
      homepage,
      repository,
      license,
      category,
      keywords,
      tags,
      components,
      unsupportedComponents,
      strict,
      defaultEnabled,
    },
  };
  const install: PluginMarketplaceInstall = resolved.unsupportedReason === undefined
    ? { kind: 'supported', source: resolved.source, options }
    : { kind: 'unsupported', reason: resolved.unsupportedReason };

  return {
    id,
    displayName,
    source: resolved.source,
    sourceLabel: resolved.sourceLabel,
    marketplaceName: context.name,
    marketplaceOwner: context.owner?.name,
    tier: undefined,
    version,
    description,
    author,
    homepage,
    repository,
    license,
    category,
    keywords,
    tags,
    strict,
    defaultEnabled,
    supportedComponents,
    unsupportedComponents,
    declaredRef: resolved.declaredRef,
    effectiveSha: resolved.effectiveSha,
    github: resolved.github,
    repositorySubdirectory: resolved.repositorySubdirectory,
    install,
  };
}

interface ResolvedClaudeSource {
  readonly source: string;
  readonly sourceLabel: string;
  readonly repositorySubdirectory?: string;
  readonly declaredRef?: string;
  readonly effectiveSha?: string;
  readonly github?: { readonly owner: string; readonly repo: string };
  readonly unsupportedReason?: string;
}

function resolveClaudeEntrySource(
  value: unknown,
  pluginRoot: string | undefined,
  location: MarketplaceLocation,
  id: string,
): ResolvedClaudeSource {
  if (typeof value === 'string') {
    const source = value.trim();
    if (source.length === 0) {
      throw new Error(`Plugin marketplace entry ${id} "source" cannot be empty.`);
    }
    if (isRelativePluginPath(source)) {
      const subdirectory = safeRepositoryPath(id, pluginRoot, source);
      if (location.github !== undefined) {
        return githubPluginSource(location.github, subdirectory, location.github.ref);
      }
      if (location.kind === 'local' && location.marketplaceRoot !== undefined) {
        return {
          source: resolveContainedLocalPath(location.marketplaceRoot, subdirectory),
          sourceLabel: source,
          repositorySubdirectory: undefined,
          declaredRef: undefined,
          effectiveSha: undefined,
          github: undefined,
          unsupportedReason: undefined,
        };
      }
      return unsupportedClaudeSource(
        source,
        'Relative Claude plugin sources require a GitHub repository or local marketplace directory.',
      );
    }

    const github = parseGithubRepository(source);
    if (github !== undefined) {
      return githubPluginSource(github, undefined, github.ref);
    }
    return unsupportedClaudeSource(source, unsupportedSourceReason(source));
  }

  if (!isRecord(value)) {
    throw new TypeError(`Plugin marketplace entry ${id} "source" must be a string or object.`);
  }
  const sourceKind = requiredObjectString(value, 'source', `Plugin marketplace entry ${id} "source"`);
  const sha = optionalStringField(value, 'sha', `Plugin marketplace entry ${id} "source"`);
  if (sha !== undefined && !FULL_SHA_RE.test(sha)) {
    throw new Error(`Plugin marketplace entry ${id} "sha" must be a 40-character hexadecimal SHA.`);
  }
  const declaredRef = optionalStringField(value, 'ref', `Plugin marketplace entry ${id} "source"`);
  const pin = sha ?? declaredRef ?? 'HEAD';
  const declaredPath = optionalStringField(value, 'path', `Plugin marketplace entry ${id} "source"`);

  if (sourceKind === 'npm') {
    return unsupportedClaudeSource(
      optionalStringField(value, 'package', `Plugin marketplace entry ${id} "source"`) ?? 'npm',
      'npm plugin sources are not supported.',
    );
  }
  if (sourceKind !== 'github' && sourceKind !== 'url' && sourceKind !== 'git-subdir') {
    return unsupportedClaudeSource(sourceKind, `Claude source type "${sourceKind}" is not supported.`);
  }

  const repositoryInput = sourceKind === 'github'
    ? optionalStringField(value, 'repo', `Plugin marketplace entry ${id} "source"`)
      ?? optionalStringField(value, 'url', `Plugin marketplace entry ${id} "source"`)
    : optionalStringField(value, 'url', `Plugin marketplace entry ${id} "source"`);
  if (repositoryInput === undefined) {
    throw new Error(`Plugin marketplace entry ${id} source type "${sourceKind}" must define a repository.`);
  }
  const github = parseGithubRepository(repositoryInput);
  if (github === undefined) {
    return unsupportedClaudeSource(repositoryInput, unsupportedSourceReason(repositoryInput));
  }
  if (sourceKind === 'git-subdir' && declaredPath === undefined) {
    throw new Error(`Plugin marketplace entry ${id} source type "git-subdir" must define "path".`);
  }
  const subdirectory = safeRepositoryPath(id, declaredPath);
  return githubPluginSource(github, subdirectory, pin, declaredRef, sha);
}

function githubPluginSource(
  github: GithubRepositoryContext,
  repositorySubdirectory: string | undefined,
  pin: string,
  declaredRef = pin,
  effectiveSha = FULL_SHA_RE.test(pin) ? pin : undefined,
): ResolvedClaudeSource {
  const source = `https://github.com/${github.owner}/${github.repo}/tree/${encodeGithubRefPath(pin)}`;
  const pathSuffix = repositorySubdirectory === undefined ? '' : `/${repositorySubdirectory}`;
  return {
    source,
    sourceLabel: `${github.owner}/${github.repo}${pathSuffix}@${pin}`,
    repositorySubdirectory,
    declaredRef,
    effectiveSha,
    github: { owner: github.owner, repo: github.repo },
    unsupportedReason: undefined,
  };
}

function unsupportedClaudeSource(sourceLabel: string, reason: string): ResolvedClaudeSource {
  return {
    source: sourceLabel,
    sourceLabel,
    repositorySubdirectory: undefined,
    declaredRef: undefined,
    effectiveSha: undefined,
    github: undefined,
    unsupportedReason: reason,
  };
}

function supportedComponentDeclarations(
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const components: Record<string, unknown> = {};
  for (const name of SUPPORTED_COMPONENTS) {
    if (entry[name] !== undefined) components[name] = entry[name];
  }
  return Object.keys(components).length === 0 ? undefined : components;
}

function supportedComponentNames(
  entry: Record<string, unknown>,
): readonly PluginMarketplaceSupportedComponent[] {
  return SUPPORTED_COMPONENTS.filter((name) => entry[name] !== undefined);
}

function unsupportedComponentNames(entry: Record<string, unknown>): readonly string[] {
  return UNSUPPORTED_COMPONENTS.filter((name) => entry[name] !== undefined);
}

const SUPPORTED_COMPONENTS: readonly PluginMarketplaceSupportedComponent[] = [
  'skills',
  'agents',
  'mcpServers',
  'lspServers',
  'outputStyles',
];

const UNSUPPORTED_COMPONENTS = [
  'commands',
  'hooks',
  'workflows',
  'monitors',
  'themes',
  'channels',
  'dependencies',
  'configuration',
] as const;

const FULL_SHA_RE = /^[0-9a-fA-F]{40}$/u;
const GITHUB_SHORTHAND_RE = /^([^/\s]+)\/([^/\s]+)$/u;

/**
 * Parse `owner/repo`, `owner/repo/tree/<ref>`, or a github.com URL into a
 * repository context. The path is rebuilt from the raw string rather
 * than `URL.pathname` (which collapses encoded slashes), and each
 * segment is decoded separately so `%2F` inside a segment becomes a
 * literal `/` in the ref while URL-normalized segments like `..` stay
 * detectable and are rejected.
 */
function parseGithubRepository(input: string): GithubRepositoryContext | undefined {
  const shorthand = GITHUB_SHORTHAND_RE.exec(input.trim());
  if (shorthand !== null && !input.includes('://')) {
    return { owner: shorthand[1]!, repo: stripGitSuffix(shorthand[2]!), ref: 'HEAD' };
  }

  const trimmed = input.trim();
  const url = URL.parse(trimmed);
  if (url?.hostname !== 'github.com') return undefined;
  const schemeEnd = trimmed.indexOf('://');
  const pathStart = trimmed.indexOf('/', schemeEnd + 3);
  const rawPathWithSuffix = pathStart < 0 ? '' : trimmed.slice(pathStart);
  const suffixStart = rawPathWithSuffix.search(/[?#]/u);
  const rawPath = suffixStart < 0 ? rawPathWithSuffix : rawPathWithSuffix.slice(0, suffixStart);
  const segments = rawPath.startsWith('/') ? rawPath.slice(1).split('/') : rawPath.split('/');
  if (segments.length < 2) return undefined;
  const owner = segments[0]!;
  const repo = stripGitSuffix(segments[1]!);
  if (owner.length === 0 || repo.length === 0) return undefined;
  if (segments.length === 2 || (segments.length === 3 && segments[2] === '')) {
    return { owner, repo, ref: 'HEAD' };
  }
  if (segments[2] !== 'tree' || segments.length < 4) return undefined;
  try {
    const refSegments = segments.slice(3).flatMap((segment) => decodeURIComponent(segment).split('/'));
    if (hasUnsafeRefSegment(refSegments)) return undefined;
    return { owner, repo, ref: refSegments.join('/') };
  } catch {
    return undefined;
  }
}

function rawGithubUrl(github: GithubRepositoryContext, catalogPath: string): string {
  return `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${encodeGithubRefPath(github.ref)}/${catalogPath}`;
}

/**
 * Percent-encode each ref segment for use in a URL path. Rejects empty,
 * `.`, and `..` segments: in a raw URL they would be normalized by the
 * server (or worse, escape the repo path) instead of naming a ref.
 */
function encodeGithubRefPath(ref: string): string {
  const segments = ref.split('/');
  if (hasUnsafeRefSegment(segments)) {
    throw new Error('GitHub ref must not contain empty, ".", or ".." path segments.');
  }
  return segments.map(encodeURIComponent).join('/');
}

function hasUnsafeRefSegment(segments: readonly string[]): boolean {
  return segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}

function safeRepositoryPath(
  id: string,
  ...parts: readonly (string | undefined)[]
): string | undefined {
  const segments: string[] = [];
  for (const raw of parts) {
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed === '.') continue;
    if (trimmed.includes('\\') || trimmed.startsWith('/') || win32.isAbsolute(trimmed)) {
      throw new Error(`Plugin marketplace entry ${id} contains an absolute or unsafe plugin path.`);
    }
    for (const segment of trimmed.split('/')) {
      if (segment.length === 0 || segment === '.') continue;
      if (segment === '..') {
        throw new Error(`Plugin marketplace entry ${id} plugin path must stay inside its repository.`);
      }
      segments.push(segment);
    }
  }
  return segments.length === 0 ? undefined : segments.join('/');
}

function resolveContainedLocalPath(root: string, subdirectory: string | undefined): string {
  const target = resolve(root, subdirectory ?? '.');
  const fromRoot = relative(root, target);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('Claude plugin path must stay inside the marketplace root.');
  }
  return target;
}

function resolvePythinkerEntrySource(source: string, location: MarketplaceLocation): string {
  const trimmed = source.trim();
  if (isHttpUrl(trimmed) || trimmed.startsWith('~/') || trimmed === '~' || isAbsolute(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('file://')) return fileURLToPath(trimmed);
  if (location.kind === 'remote') return new URL(trimmed, location.resolved).toString();
  return resolve(dirname(location.resolved), trimmed);
}

function resolveLocalPath(input: string, workDir: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return join(homedir(), input.slice(2));
  return isAbsolute(input) ? input : resolve(workDir, input);
}

function isRelativePluginPath(source: string): boolean {
  return !/^[a-z][a-z\d+.-]*:/iu.test(source) &&
    !source.startsWith('git@') &&
    !isAbsolute(source) &&
    !win32.isAbsolute(source);
}

function unsupportedSourceReason(source: string): string {
  if (source.startsWith('npm:')) return 'npm plugin sources are not supported.';
  if (source.startsWith('git@') || source.startsWith('ssh://')) {
    return 'SSH plugin sources are not supported.';
  }
  if (/^git(?:\+[^:]+)?:\/\//iu.test(source)) {
    return 'Generic Git plugin sources are not supported.';
  }
  if (isHttpUrl(source)) return 'Only GitHub-backed Claude plugin sources are supported.';
  return 'This Claude plugin source is not supported.';
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function assertUniquePluginIds(entries: readonly PluginMarketplaceEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.id.toLowerCase();
    if (seen.has(normalized)) {
      throw new Error(`Plugin marketplace contains duplicate plugin name "${entry.id}".`);
    }
    seen.add(normalized);
  }
}

function requiredEntryRecord(value: unknown, index: number): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`Plugin marketplace entry ${index + 1} must be an object.`);
  }
  return value;
}

function requiredEntryString(
  value: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const result = optionalStringField(value, field, `Plugin marketplace entry ${index + 1}`);
  if (result === undefined) {
    throw new Error(`Plugin marketplace entry ${index + 1} must define "${field}".`);
  }
  return result;
}

function requiredCatalogString(value: Record<string, unknown>, field: string): string {
  const result = optionalStringField(value, field, 'Claude plugin marketplace');
  if (result === undefined) throw new Error(`Claude plugin marketplace must define "${field}".`);
  return result;
}

function requiredObjectString(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const result = optionalStringField(value, field, context);
  if (result === undefined) throw new Error(`${context} must define "${field}".`);
  return result;
}

function optionalStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined {
  const raw = value[field];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') throw new TypeError(`${context} "${field}" must be a string.`);
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalStringArrayField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): readonly string[] | undefined {
  const raw = value[field];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${context} "${field}" must be an array of strings.`);
  }
  const out = raw.map((item) => (item as string).trim()).filter((item) => item.length > 0);
  return out.length === 0 ? undefined : out;
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): boolean | undefined {
  const raw = value[field];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'boolean') throw new TypeError(`${context} "${field}" must be a boolean.`);
  return raw;
}

function requiredAuthor(value: unknown, context: string): PluginMarketplaceAuthor {
  const author = optionalAuthor(value, context);
  if (author === undefined) throw new Error(`${context} must define "name".`);
  return author;
}

function optionalAuthor(
  value: unknown,
  context: string,
): PluginMarketplaceAuthor | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${context} must be an object.`);
  const name = optionalStringField(value, 'name', context);
  if (name === undefined) throw new Error(`${context} must define "name".`);
  return {
    name,
    email: optionalStringField(value, 'email', context),
    url: optionalStringField(value, 'url', context),
  };
}

function parseMarketplaceTier(
  value: Record<string, unknown>,
  id: string,
): PluginMarketplaceTier | undefined {
  const raw = value['tier'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    throw new TypeError(`Plugin marketplace entry ${id} "tier" must be a string.`);
  }
  const tier = raw.trim();
  if (tier.length === 0) return undefined;
  if ((PLUGIN_MARKETPLACE_TIERS as readonly string[]).includes(tier)) {
    return tier as PluginMarketplaceTier;
  }
  throw new Error(
    `Plugin marketplace entry ${id} "tier" must be one of: ${PLUGIN_MARKETPLACE_TIERS.join(', ')}.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatParseError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
