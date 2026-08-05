import { cp, mkdir, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { McpServerConfig } from '../config/schema';
import type { LspServerConfig } from '../lsp/types';
import { discoverSkills, type SkillRoot } from '../skill';
import { downloadZip, extractZip } from './archive';
import { resolveGithubSource } from './github-resolver';
import { parseManifest, type ParsedManifestResult } from './manifest';
import { resolveInstallSource } from './source';
import { readInstalled, writeInstalled, type InstalledRecord } from './store';
import {
  type EnabledPluginSessionStart,
  type PluginAgentProfileSource,
  type PluginCapabilityState,
  type PluginComponentDeclarations,
  type PluginConfigDeclaration,
  type PluginDefinitionJsonObject,
  type PluginDefinitionJsonValue,
  type PluginGithubMetadata,
  type PluginInfo,
  type PluginInstallDefinition,
  type PluginInstallOptions,
  type PluginMcpServerInfo,
  type PluginOutputStyleSource,
  type PluginPathDeclaration,
  type PluginRecord,
  type PluginSource,
  type PluginSummary,
  type ReloadSummary,
  PLUGIN_NAME_REGEX,
  normalizePluginId,
} from './types';

// Hidden Pythinker CLI subcommand that re-enters as a Node interpreter.
// Used as fallback when an MCP server declares `"command": "node"` but the
// user is running a single-binary Pythinker build that doesn't have `node` on PATH.
const PYTHINKER_NODE_FALLBACK_SUBCOMMAND = '__plugin_run_node';

export interface PluginManagerOptions {
  readonly pythinkerHomeDir: string;
}

export class PluginManager {
  private readonly pythinkerHomeDir: string;
  private records = new Map<string, PluginRecord>();

  constructor(options: PluginManagerOptions) {
    this.pythinkerHomeDir = options.pythinkerHomeDir;
  }

  async load(): Promise<void> {
    const file = await readInstalled(this.pythinkerHomeDir);
    const next = new Map<string, PluginRecord>();
    for (const entry of file.plugins) {
      next.set(entry.id, await this.materialize(entry));
    }
    this.records = next;
  }

  list(): readonly PluginRecord[] {
    return [...this.records.values()].toSorted((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(normalizePluginId(id));
  }

  async install(source: string, options?: PluginInstallOptions): Promise<PluginRecord> {
    const resolved = resolveInstallSource(source);
    const definition = normalizeInstallDefinition(options?.definition);

    let normalizedRoot: string;
    let originalSource: string;
    let sourceType: PluginSource;
    let parsed: ParsedManifestResult;
    let id: string;
    let github: PluginGithubMetadata | undefined;

    if (resolved.kind === 'local-path') {
      const sourceRoot = await normalizeInstallRoot(resolved.path);
      originalSource = resolved.path;
      sourceType = 'local-path';
      parsed = await parseManifest(sourceRoot, definition);
      if (parsed.manifest === undefined) {
        const msg =
          parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
        throw new Error(`Cannot install plugin at ${sourceRoot}: ${msg}`);
      }
      id = normalizePluginId(parsed.manifest.name);
      normalizedRoot = await copyPluginToManagedRoot(this.pythinkerHomeDir, id, sourceRoot);
      parsed = await parseManifest(normalizedRoot, definition);
    } else {
      let zipUrl: string;
      let repositorySubdirectory: string | undefined;
      if (resolved.kind === 'github') {
        const githubResolution = await resolveGithubSource(resolved);
        zipUrl = githubResolution.tarballUrl;
        originalSource = source.trim();
        sourceType = 'github';
        repositorySubdirectory = normalizeOptionalString(options?.repositorySubdirectory);
        github = {
          owner: resolved.owner,
          repo: resolved.repo,
          ref: githubResolution.ref,
          installedSha:
            githubResolution.ref.kind === 'sha' && isFullGithubSha(githubResolution.ref.value)
              ? githubResolution.ref.value
              : undefined,
        };
      } else {
        zipUrl = resolved.path;
        originalSource = resolved.path;
        sourceType = 'zip-url';
      }
      const buffer = await downloadZip(zipUrl);
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'pythinker-plugin-zip-'));
      try {
        const detectedRoot = await extractZip(buffer, tmpDir, {
          repositorySubdirectory,
          allowManifestless: definition !== undefined,
        });
        parsed = await parseManifest(detectedRoot, definition);
        if (parsed.manifest === undefined) {
          const msg =
            parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
          throw new Error(`Cannot install plugin from ${originalSource}: ${msg}`);
        }
        id = normalizePluginId(parsed.manifest.name);
        normalizedRoot = await copyPluginToManagedRoot(this.pythinkerHomeDir, id, detectedRoot);
        parsed = await parseManifest(normalizedRoot, definition);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    }

    if (parsed.manifest === undefined) {
      const msg = parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'no manifest';
      throw new Error(`Cannot install plugin at ${normalizedRoot}: ${msg}`);
    }
    id = normalizePluginId(parsed.manifest.name);
    const existing = this.records.get(id);
    const now = new Date().toISOString();
    const record = await recordFrom({
      id,
      root: normalizedRoot,
      enabled:
        existing?.enabled ?? definition?.defaultEnabled ?? parsed.manifest.defaultEnabled ?? true,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
      originalSource,
      source: sourceType,
      capabilities: existing?.capabilities,
      github,
      definition,
      parsed,
    });
    this.records.set(id, record);
    await this.persist();
    return record;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const key = normalizePluginId(id);
    const current = this.records.get(key);
    if (current === undefined) throw new Error(`Plugin "${id}" is not installed`);
    if (current.enabled === enabled) return;
    const now = new Date().toISOString();
    this.records.set(key, { ...current, enabled, updatedAt: now });
    await this.persist();
  }

  async setMcpServerEnabled(id: string, server: string, enabled: boolean): Promise<void> {
    const key = normalizePluginId(id);
    const current = this.records.get(key);
    if (current === undefined) throw new Error(`Plugin "${id}" is not installed`);
    if (current.manifest?.mcpServers?.[server] === undefined) {
      throw new Error(`Plugin "${id}" does not declare MCP server "${server}"`);
    }
    const currentMcpServers = current.capabilities?.mcpServers ?? {};
    const nextCapabilities: PluginCapabilityState = {
      ...current.capabilities,
      mcpServers: {
        ...currentMcpServers,
        [server]: { enabled },
      },
    };
    this.records.set(key, {
      ...current,
      capabilities: nextCapabilities,
      updatedAt: new Date().toISOString(),
    });
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    const key = normalizePluginId(id);
    if (!this.records.delete(key)) {
      throw new Error(`Plugin "${id}" is not installed`);
    }
    await this.persist();
  }

  async reload(): Promise<ReloadSummary> {
    const prevIds = new Set(this.records.keys());
    const file = await readInstalled(this.pythinkerHomeDir);
    const next = new Map<string, PluginRecord>();
    const errors: Array<{ id: string; message: string }> = [];
    for (const entry of file.plugins) {
      try {
        next.set(entry.id, await this.materialize(entry));
      } catch (error) {
        errors.push({ id: entry.id, message: (error as Error).message });
      }
    }
    const added: string[] = [];
    for (const id of next.keys()) if (!prevIds.has(id)) added.push(id);
    const removed: string[] = [];
    for (const id of prevIds) if (!next.has(id)) removed.push(id);
    this.records = next;
    return { added, removed, errors };
  }

  pluginSkillRoots(): readonly SkillRoot[] {
    const roots: SkillRoot[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const dir of record.manifest.skills ?? []) {
        roots.push({
          path: dir,
          source: 'extra',
          plugin: { id: record.id, instructions: record.skillInstructions },
        });
      }
    }
    return roots;
  }

  enabledAgentProfileSources(): readonly PluginAgentProfileSource[] {
    const sources: PluginAgentProfileSource[] = [];
    for (const record of this.records.values()) {
      const paths = record.manifest?.agents;
      if (!record.enabled || record.state !== 'ok' || paths === undefined || paths.length === 0)
        continue;
      sources.push({
        pluginId: record.id,
        pluginRoot: record.root,
        paths,
      });
    }
    return sources;
  }

  enabledOutputStyleSources(): readonly PluginOutputStyleSource[] {
    const sources: PluginOutputStyleSource[] = [];
    for (const record of this.records.values()) {
      const paths = record.manifest?.outputStyles;
      if (!record.enabled || record.state !== 'ok' || paths === undefined || paths.length === 0)
        continue;
      sources.push({
        pluginId: record.id,
        pluginRoot: record.root,
        paths,
      });
    }
    return sources;
  }

  enabledSessionStarts(): readonly EnabledPluginSessionStart[] {
    const out: EnabledPluginSessionStart[] = [];
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok') continue;
      const skill = record.manifest?.sessionStart?.skill;
      if (skill === undefined) continue;
      out.push({ pluginId: record.id, skillName: skill });
    }
    return out;
  }

  enabledMcpServers(): Record<string, McpServerConfig> {
    const out: Record<string, McpServerConfig> = {};
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const [name, config] of Object.entries(record.manifest.mcpServers ?? {})) {
        if (!isMcpServerEnabled(record, name, config)) continue;
        out[pluginMcpRuntimeName(record.id, name)] = withPluginMcpRuntime(
          { ...config, enabled: true },
          record.root,
          this.pythinkerHomeDir,
        );
      }
    }
    return out;
  }

  enabledLspServers(): Record<string, LspServerConfig> {
    const out: Record<string, LspServerConfig> = {};
    for (const record of this.records.values()) {
      if (!record.enabled || record.state !== 'ok' || record.manifest === undefined) continue;
      for (const [name, config] of Object.entries(record.manifest.lspServers ?? {})) {
        out[pluginMcpRuntimeName(record.id, name)] = withPluginLspRuntime(config, record.root);
      }
    }
    return out;
  }

  summaries(): readonly PluginSummary[] {
    return this.list().map((record) => recordToSummary(record));
  }

  info(id: string): PluginInfo | undefined {
    const record = this.get(id);
    return record === undefined ? undefined : recordToInfo(record);
  }

  private async persist(): Promise<void> {
    const installed: InstalledRecord[] = [...this.records.values()].map((record) => ({
      id: record.id,
      root: record.root,
      source: record.source,
      enabled: record.enabled,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      originalSource: record.originalSource,
      capabilities: record.capabilities,
      github: record.github,
      definition: record.definition,
    }));
    await writeInstalled(this.pythinkerHomeDir, { version: 1, plugins: installed });
  }

  private async materialize(entry: InstalledRecord): Promise<PluginRecord> {
    const definition = normalizeInstallDefinition(entry.definition);
    const parsed = await parseManifest(entry.root, definition);
    return recordFrom({
      id: entry.id,
      root: entry.root,
      enabled: entry.enabled,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
      originalSource: entry.originalSource,
      capabilities: entry.capabilities,
      github: entry.github,
      definition,
      source: entry.source,
      parsed,
    });
  }
}

async function normalizeInstallRoot(rootPath: string): Promise<string> {
  const trimmed = rootPath.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`Plugin root must be an absolute path (got "${rootPath}")`);
  }
  let resolved: string;
  try {
    resolved = await realpath(trimmed);
  } catch (error) {
    throw new Error(`Plugin root does not exist: ${trimmed}`, { cause: error });
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error(`Plugin root is not a directory: ${trimmed}`);
  }
  return resolved;
}

async function copyPluginToManagedRoot(
  pythinkerHomeDir: string,
  id: string,
  sourceRoot: string,
): Promise<string> {
  const managedRoot = path.join(pythinkerHomeDir, 'plugins', 'managed', id);
  const managedDir = path.dirname(managedRoot);
  await mkdir(managedDir, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(managedDir, `${id}-`));
  try {
    await cp(sourceRoot, stagingRoot, { recursive: true });
    await rm(managedRoot, { recursive: true, force: true });
    await rename(stagingRoot, managedRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return realpath(managedRoot);
}

async function recordFrom(input: {
  id: string;
  root: string;
  enabled: boolean;
  installedAt: string;
  updatedAt?: string;
  originalSource?: string;
  capabilities?: PluginCapabilityState;
  github?: PluginGithubMetadata;
  definition?: PluginInstallDefinition;
  source: PluginSource;
  parsed: ParsedManifestResult;
}): Promise<PluginRecord> {
  const { parsed } = input;
  const hasError = parsed.diagnostics.some((d) => d.severity === 'error');
  return {
    id: input.id,
    root: input.root,
    source: input.source,
    enabled: input.enabled,
    state: hasError || parsed.manifest === undefined ? 'error' : 'ok',
    installedAt: input.installedAt,
    updatedAt: input.updatedAt,
    originalSource: input.originalSource,
    capabilities: input.capabilities,
    github: input.github,
    definition: input.definition,
    skillCount: await countDiscoveredPluginSkills(input.id, parsed.manifest),
    manifest: parsed.manifest,
    manifestKind: parsed.manifestKind,
    manifestPath: parsed.manifestPath,
    shadowedManifestPath: parsed.shadowedManifestPath,
    diagnostics: parsed.diagnostics,
    skillInstructions: parsed.manifest?.skillInstructions,
  };
}

function recordToSummary(record: PluginRecord): PluginSummary {
  return {
    id: record.id,
    displayName: record.manifest?.interface?.displayName ?? record.id,
    version: record.manifest?.version,
    enabled: record.enabled,
    state: record.state,
    skillCount: record.skillCount,
    mcpServerCount: Object.keys(record.manifest?.mcpServers ?? {}).length,
    enabledMcpServerCount: pluginMcpServersInfo(record).filter((server) => server.enabled).length,
    hasErrors: record.diagnostics.some((d) => d.severity === 'error'),
    source: record.source,
    originalSource: record.originalSource,
    github: record.github,
  };
}

async function countDiscoveredPluginSkills(
  pluginId: string,
  manifest: PluginRecord['manifest'],
): Promise<number> {
  const roots = (manifest?.skills ?? []).map(
    (dir) =>
      ({
        path: dir,
        source: 'extra',
        plugin: { id: pluginId, instructions: manifest?.skillInstructions },
      }) satisfies SkillRoot,
  );
  if (roots.length === 0) return 0;
  const skills = await discoverSkills({ roots });
  return skills.length;
}

function recordToInfo(record: PluginRecord): PluginInfo {
  return {
    ...recordToSummary(record),
    root: record.root,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    manifestKind: record.manifestKind,
    manifestPath: record.manifestPath,
    manifest: record.manifest,
    mcpServers: pluginMcpServersInfo(record),
    shadowedManifestPath: record.shadowedManifestPath,
    diagnostics: record.diagnostics,
  };
}

function isMcpServerEnabled(record: PluginRecord, name: string, config: McpServerConfig): boolean {
  return record.capabilities?.mcpServers?.[name]?.enabled ?? config.enabled !== false;
}

function pluginMcpServersInfo(record: PluginRecord): readonly PluginMcpServerInfo[] {
  return Object.entries(record.manifest?.mcpServers ?? {})
    .map(([name, config]) => pluginMcpServerInfo(record, name, config))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

function pluginMcpServerInfo(
  record: PluginRecord,
  name: string,
  config: McpServerConfig,
): PluginMcpServerInfo {
  if (config.transport === 'http' || config.transport === 'sse') {
    return {
      name,
      runtimeName: pluginMcpRuntimeName(record.id, name),
      enabled: isMcpServerEnabled(record, name, config),
      transport: config.transport,
      url: config.url,
      headerKeys: config.headers === undefined ? undefined : Object.keys(config.headers).toSorted(),
    };
  }
  return {
    name,
    runtimeName: pluginMcpRuntimeName(record.id, name),
    enabled: isMcpServerEnabled(record, name, config),
    transport: 'stdio',
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    envKeys: config.env === undefined ? undefined : Object.keys(config.env).toSorted(),
  };
}

function pluginMcpRuntimeName(pluginId: string, serverName: string): string {
  // Plugin ids cannot contain ":", so this keeps plugin/server pairs unambiguous
  // even when either side contains "-".
  return `plugin-${pluginId}:${serverName}`;
}

function withPluginMcpRuntime(
  config: McpServerConfig,
  pluginRoot: string,
  pythinkerHomeDir: string,
): McpServerConfig {
  if (config.transport === 'http' || config.transport === 'sse') return config;

  const env = {
    ...config.env,
    PYTHINKER_CODE_HOME: pythinkerHomeDir,
    PYTHINKER_PLUGIN_ROOT: pluginRoot,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
  };

  if (config.command === 'node' && isPythinkerNativeBinary()) {
    return {
      ...config,
      command: process.execPath,
      args: [PYTHINKER_NODE_FALLBACK_SUBCOMMAND, ...(config.args ?? [])],
      cwd: config.cwd ?? pluginRoot,
      env,
    };
  }

  return { ...config, cwd: config.cwd ?? pluginRoot, env };
}

function withPluginLspRuntime(config: LspServerConfig, pluginRoot: string): LspServerConfig {
  return {
    ...config,
    env: {
      ...config.env,
      PYTHINKER_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
    },
  };
}

function isPythinkerNativeBinary(): boolean {
  return !path.basename(process.execPath).toLowerCase().startsWith('node');
}

function isFullGithubSha(value: string): boolean {
  return /^[0-9a-f]{40}$/iu.test(value);
}

function normalizeInstallDefinition(
  value: PluginInstallDefinition | undefined,
): PluginInstallDefinition | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error('Plugin install definition must be an object');

  const idValue = normalizeMetadataString(value['id']);
  if (idValue === undefined) throw new Error('Plugin install definition id is required');
  const id = normalizePluginId(idValue);
  if (!PLUGIN_NAME_REGEX.test(id)) {
    throw new Error(
      `Plugin install definition id must match ${PLUGIN_NAME_REGEX} (got "${idValue}")`,
    );
  }

  return {
    id,
    displayName: normalizeMetadataString(value['displayName']),
    version: normalizeMetadataString(value['version']),
    description: normalizeMetadataString(value['description']),
    keywords: normalizeStringArray(value['keywords']),
    tags: normalizeStringArray(value['tags']),
    category: normalizeMetadataString(value['category']),
    author: normalizeAuthor(value['author']),
    homepage: normalizeMetadataString(value['homepage']),
    repository: normalizeMetadataString(value['repository']),
    license: normalizeMetadataString(value['license']),
    components: normalizeComponents(value['components']),
    unsupportedComponents: normalizeStringArray(value['unsupportedComponents']),
    strict: typeof value['strict'] === 'boolean' ? value['strict'] : undefined,
    defaultEnabled:
      typeof value['defaultEnabled'] === 'boolean' ? value['defaultEnabled'] : undefined,
  };
}

function normalizeComponents(value: unknown): PluginComponentDeclarations | undefined {
  if (!isPlainObject(value)) return undefined;
  const components: PluginComponentDeclarations = {
    skills: normalizePathDeclaration(value['skills']),
    agents: normalizePathDeclaration(value['agents']),
    outputStyles: normalizePathDeclaration(value['outputStyles']),
    mcpServers: normalizeConfigDeclaration(value['mcpServers']),
    lspServers: normalizeConfigDeclaration(value['lspServers']),
  };
  return Object.values(components).some((entry) => entry !== undefined) ? components : undefined;
}

function normalizePathDeclaration(value: unknown): PluginPathDeclaration | undefined {
  return normalizeMetadataString(value) ?? normalizeStringArray(value);
}

function normalizeConfigDeclaration(value: unknown): PluginConfigDeclaration | undefined {
  const single = normalizeConfigEntry(value);
  if (single !== undefined) return single;
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((entry) => normalizeConfigEntry(entry))
    .filter((entry): entry is string | PluginDefinitionJsonObject => entry !== undefined);
  return entries.length === 0 ? undefined : entries;
}

function normalizeConfigEntry(value: unknown): string | PluginDefinitionJsonObject | undefined {
  const stringValue = normalizeMetadataString(value);
  if (stringValue !== undefined) return stringValue;
  return cloneJsonObject(value);
}

function cloneJsonObject(value: unknown): PluginDefinitionJsonObject | undefined {
  if (!isPlainObject(value)) return undefined;
  const cloned = cloneJsonValue(value, new Set());
  return isPlainObject(cloned) ? (cloned as PluginDefinitionJsonObject) : undefined;
}

function cloneJsonValue(
  value: unknown,
  ancestors: Set<object>,
): PluginDefinitionJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  if (ancestors.has(value)) return undefined;

  ancestors.add(value);
  if (Array.isArray(value)) {
    const out: PluginDefinitionJsonValue[] = [];
    for (const entry of value) {
      const cloned = cloneJsonValue(entry, ancestors);
      if (cloned !== undefined) out.push(cloned);
    }
    ancestors.delete(value);
    return out;
  }
  if (!isPlainObject(value)) {
    ancestors.delete(value);
    return undefined;
  }
  const out: Record<string, PluginDefinitionJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = cloneJsonValue(entry, ancestors);
    if (cloned !== undefined) out[key] = cloned;
  }
  ancestors.delete(value);
  return out;
}

function normalizeAuthor(value: unknown): PluginInstallDefinition['author'] {
  if (!isPlainObject(value)) return undefined;
  const author = {
    name: normalizeMetadataString(value['name']),
    email: normalizeMetadataString(value['email']),
    url: normalizeMetadataString(value['url']),
  };
  return Object.values(author).some((entry) => entry !== undefined) ? author : undefined;
}

function normalizeStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((entry) => normalizeMetadataString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return entries.length === 0 ? undefined : entries;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function normalizeMetadataString(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
