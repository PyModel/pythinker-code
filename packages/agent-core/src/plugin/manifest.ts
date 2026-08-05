import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { McpServerConfigSchema, type McpServerConfig } from '../config/schema';
import { LspServerConfigSchema, type LspServerConfig } from '../lsp/types';
import {
  PLUGIN_NAME_REGEX,
  type PluginComponentDeclarations,
  type PluginDiagnostic,
  type PluginInstallDefinition,
  type PluginInterface,
  type PluginManifest,
  type PluginManifestKind,
} from './types';

const PYTHINKER_PLUGIN_ROOT_PATH = 'pythinker.plugin.json';
const PYTHINKER_PLUGIN_DIR_PATH = '.pythinker-plugin/plugin.json';
const CLAUDE_PLUGIN_PATH = '.claude-plugin/plugin.json';

const SUPPORTED_COMPONENT_FIELDS = [
  'skills',
  'agents',
  'outputStyles',
  'mcpServers',
  'lspServers',
] as const;

// Third-party runtime extensions are never executed. Diagnostics make ignored
// fields and conventional component locations visible to plugin users.
const UNSUPPORTED_RUNTIME_FIELDS = [
  'tools',
  'commands',
  'hooks',
  'apps',
  'inject',
  'configFile',
  'config_file',
  'bootstrap',
  'workflows',
  'monitors',
  'themes',
  'channels',
  'dependencies',
  'userConfig',
  'settings',
  'experimental',
  'experiments',
] as const;

const UNSUPPORTED_DEFAULT_LOCATIONS = [
  'commands',
  'hooks',
  'workflows',
  'monitors',
  'themes',
  'channels',
  'dependencies',
  'userConfig',
  'settings',
  'experimental',
] as const;

export interface ParsedManifestResult {
  readonly manifest?: PluginManifest;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly shadowedManifestPath?: string;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export async function parseManifest(
  pluginRoot: string,
  definition?: PluginInstallDefinition,
): Promise<ParsedManifestResult> {
  const candidates = [
    { relativePath: PYTHINKER_PLUGIN_ROOT_PATH, kind: 'pythinker-plugin-root' as const },
    { relativePath: PYTHINKER_PLUGIN_DIR_PATH, kind: 'pythinker-plugin-dir' as const },
    { relativePath: CLAUDE_PLUGIN_PATH, kind: 'claude-plugin' as const },
  ];
  const existing = await Promise.all(
    candidates.map(async (candidate) => isFile(path.join(pluginRoot, candidate.relativePath))),
  );
  const selectedIndex = existing.findIndex(Boolean);

  if (selectedIndex === -1 && definition === undefined) {
    return {
      diagnostics: [
        {
          severity: 'error',
          message: `No manifest at ${PYTHINKER_PLUGIN_ROOT_PATH}, ${PYTHINKER_PLUGIN_DIR_PATH}, or ${CLAUDE_PLUGIN_PATH}`,
        },
      ],
    };
  }

  const selected = selectedIndex === -1 ? undefined : candidates[selectedIndex];
  const manifestPath =
    selected === undefined ? undefined : path.join(pluginRoot, selected.relativePath);
  const manifestKind: PluginManifestKind = selected?.kind ?? 'marketplace-definition';
  const shadowedIndex = existing.findIndex((value, index) => value && index > selectedIndex);
  const shadowedManifestPath =
    shadowedIndex === -1
      ? undefined
      : path.join(pluginRoot, candidates[shadowedIndex]!.relativePath);

  let raw: Record<string, unknown> = {};
  if (manifestPath !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      return {
        manifestKind,
        manifestPath,
        shadowedManifestPath,
        diagnostics: [
          {
            severity: 'error',
            message: `Failed to parse ${path.relative(pluginRoot, manifestPath)}: ${(error as Error).message}`,
          },
        ],
      };
    }
    if (!isObject(parsed)) {
      return {
        manifestKind,
        manifestPath,
        shadowedManifestPath,
        diagnostics: [{ severity: 'error', message: 'manifest must be a JSON object' }],
      };
    }
    raw = parsed;
  }

  const diagnostics: PluginDiagnostic[] = [];
  const definitionId = definition?.id.trim();
  const manifestName = stringField(raw, 'name');
  const name =
    definitionId === undefined || definitionId.length === 0 ? (manifestName ?? '') : definitionId;
  if (name.length === 0) {
    diagnostics.push({ severity: 'error', message: '"name" is required' });
    return { manifestKind, manifestPath, shadowedManifestPath, diagnostics };
  }
  if (!PLUGIN_NAME_REGEX.test(name)) {
    diagnostics.push({
      severity: 'error',
      message: `"name" must match ${PLUGIN_NAME_REGEX} (got "${name}")`,
    });
    return { manifestKind, manifestPath, shadowedManifestPath, diagnostics };
  }

  const strict = definition?.strict !== false;
  if (!strict) {
    const ignored = SUPPORTED_COMPONENT_FIELDS.filter((field) => raw[field] !== undefined);
    if (ignored.length > 0) {
      diagnostics.push({
        severity: 'info',
        message: `Marketplace strict=false ignores manifest component declarations: ${ignored.join(', ')}`,
      });
    }
  }

  await recordUnsupportedRuntimeExtensions(pluginRoot, raw, definition, diagnostics);

  const components = effectiveComponents(raw, definition?.components, strict);
  const skills = await resolveSkillsField(pluginRoot, components.skills, diagnostics);
  const agents = await resolveAgentsField(pluginRoot, components.agents, diagnostics);
  const outputStyles = await resolveOutputStylesField(
    pluginRoot,
    components.outputStyles,
    diagnostics,
  );
  const mcpServers = await readMcpServers(pluginRoot, components.mcpServers, diagnostics);
  const lspServers = await readLspServers(pluginRoot, components.lspServers, diagnostics);

  const description = stringField(raw, 'description') ?? definition?.description;
  const author = readAuthor(raw['author']) ?? definition?.author;
  const homepage = stringField(raw, 'homepage') ?? definition?.homepage;
  const manifest: PluginManifest = {
    name,
    version: stringField(raw, 'version') ?? definition?.version,
    description,
    keywords: stringArrayField(raw, 'keywords') ?? definition?.keywords,
    tags: stringArrayField(raw, 'tags') ?? definition?.tags,
    category: stringField(raw, 'category') ?? definition?.category,
    author,
    homepage,
    repository: readRepository(raw['repository']) ?? definition?.repository,
    license: stringField(raw, 'license') ?? definition?.license,
    defaultEnabled: definition?.defaultEnabled ?? booleanField(raw, 'defaultEnabled'),
    skills,
    agents,
    outputStyles,
    sessionStart: strict ? readSessionStart(raw['sessionStart'], diagnostics) : undefined,
    mcpServers,
    lspServers,
    interface: mergeInterface({
      manifest: readInterface(raw['interface']),
      displayName: definition?.displayName ?? (
        manifestKind === 'claude-plugin' ? stringField(raw, 'displayName') : undefined
      ),
      description,
      authorName: author?.name,
      homepage,
    }),
    skillInstructions:
      strict && typeof raw['skillInstructions'] === 'string' ? raw['skillInstructions'] : undefined,
  };

  if (
    (manifestKind === 'claude-plugin' || definition !== undefined) &&
    !hasUsableComponent(manifest)
  ) {
    diagnostics.push({
      severity: 'warn',
      message: 'Plugin has no supported skills, agents, MCP servers, LSP servers, or output styles',
    });
  }

  return { manifest, manifestKind, manifestPath, shadowedManifestPath, diagnostics };
}

function effectiveComponents(
  raw: Record<string, unknown>,
  definition: PluginComponentDeclarations | undefined,
  strict: boolean,
): Record<(typeof SUPPORTED_COMPONENT_FIELDS)[number], unknown> {
  if (!strict) {
    return {
      skills: definition?.skills,
      agents: definition?.agents,
      outputStyles: definition?.outputStyles,
      mcpServers: definition?.mcpServers,
      lspServers: definition?.lspServers,
    };
  }
  return {
    skills: mergeDeclarations(raw['skills'], definition?.skills),
    agents: mergeDeclarations(raw['agents'], definition?.agents),
    outputStyles: mergeDeclarations(raw['outputStyles'], definition?.outputStyles),
    mcpServers: mergeDeclarations(raw['mcpServers'], definition?.mcpServers),
    lspServers: mergeDeclarations(raw['lspServers'], definition?.lspServers),
  };
}

function mergeDeclarations(base: unknown, overlay: unknown): unknown {
  if (base === undefined) return overlay;
  if (overlay === undefined) return base;
  return [...asDeclarations(base), ...asDeclarations(overlay)];
}

function asDeclarations(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [value];
}

async function recordUnsupportedRuntimeExtensions(
  pluginRoot: string,
  raw: Record<string, unknown>,
  definition: PluginInstallDefinition | undefined,
  diagnostics: PluginDiagnostic[],
): Promise<void> {
  const recorded = new Set<string>();
  const record = (name: string, source: string): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || recorded.has(trimmed)) return;
    recorded.add(trimmed);
    diagnostics.push({
      severity: 'info',
      message: `"${trimmed}" is ${source} but not supported by Pythinker plugins`,
    });
  };

  for (const field of UNSUPPORTED_RUNTIME_FIELDS) {
    if (raw[field] !== undefined) record(field, 'present');
  }
  for (const component of definition?.unsupportedComponents ?? []) {
    record(component, 'declared by the marketplace');
  }
  for (const location of UNSUPPORTED_DEFAULT_LOCATIONS) {
    if (raw[location] !== undefined) continue;
    if (await exists(path.join(pluginRoot, location)))
      record(location, 'present at its default location');
  }
}

async function resolveSkillsField(
  pluginRoot: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): Promise<readonly string[]> {
  const resolved = new Set<string>();
  const standardDirectory = await resolvePluginPathField({
    pluginRoot,
    field: 'skills',
    value: './skills',
    diagnostics,
    severity: 'error',
  });
  if (standardDirectory !== undefined && (await isDir(standardDirectory))) {
    resolved.add(standardDirectory);
  }

  const entries = readPathEntries('skills', raw, diagnostics, 'error');
  for (const entry of entries) {
    const skillPath = await resolvePluginPathField({
      pluginRoot,
      field: 'skills',
      value: entry,
      diagnostics,
      severity: 'error',
    });
    if (skillPath === undefined) continue;
    if (!(await isDir(skillPath))) {
      diagnostics.push({
        severity: 'warn',
        message: `"skills" path is not a directory (${entry})`,
      });
      continue;
    }
    resolved.add(skillPath);
  }

  if (raw === undefined && resolved.size === 0) {
    const rootSkill = await resolvePluginPathField({
      pluginRoot,
      field: 'skills',
      value: './SKILL.md',
      diagnostics,
      severity: 'error',
    });
    if (rootSkill !== undefined && (await isFile(rootSkill))) {
      resolved.add(await realpath(pluginRoot).catch(() => pluginRoot));
    }
  }
  return [...resolved];
}

async function resolveAgentsField(
  pluginRoot: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): Promise<readonly string[]> {
  return resolveMarkdownPathsField(pluginRoot, 'agents', raw, diagnostics);
}

async function resolveOutputStylesField(
  pluginRoot: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): Promise<readonly string[]> {
  return resolveMarkdownPathsField(pluginRoot, 'outputStyles', raw, diagnostics, 'output-styles');
}

async function resolveMarkdownPathsField(
  pluginRoot: string,
  field: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
  standardDirectoryName = field,
): Promise<readonly string[]> {
  const resolved = new Set<string>();
  const standardDirectory = await resolvePluginPathField({
    pluginRoot,
    field,
    value: `./${standardDirectoryName}`,
    diagnostics,
    severity: 'warn',
  });
  if (standardDirectory !== undefined && (await isDir(standardDirectory))) {
    resolved.add(standardDirectory);
  }

  for (const entry of readPathEntries(field, raw, diagnostics, 'warn')) {
    const entryPath = await resolvePluginPathField({
      pluginRoot,
      field,
      value: entry,
      diagnostics,
      severity: 'warn',
    });
    if (entryPath === undefined) continue;
    if (
      !(await isDir(entryPath)) &&
      (!(await isFile(entryPath)) || path.extname(entryPath).toLowerCase() !== '.md')
    ) {
      diagnostics.push({
        severity: 'warn',
        message: `"${field}" path must be a directory or Markdown file (${entry})`,
      });
      continue;
    }
    resolved.add(entryPath);
  }

  return [...resolved];
}

function readPathEntries(
  field: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
  severity: 'error' | 'warn',
): readonly string[] {
  if (raw === undefined) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')) {
    return raw;
  }
  diagnostics.push({ severity, message: `"${field}" must be a string or string[]` });
  return [];
}

async function resolvePluginPathField(input: {
  readonly pluginRoot: string;
  readonly field: string;
  readonly value: string;
  readonly diagnostics: PluginDiagnostic[];
  readonly severity?: 'error' | 'warn';
  readonly allowAbsolute?: boolean;
}): Promise<string | undefined> {
  const isAbsolute = path.isAbsolute(input.value);
  if (!input.value.startsWith('./') && !(input.allowAbsolute === true && isAbsolute)) {
    input.diagnostics.push({
      severity: input.severity ?? 'warn',
      message: `"${input.field}" path must start with "./" (got "${input.value}")`,
    });
    return undefined;
  }
  const absolute = isAbsolute ? input.value : path.resolve(input.pluginRoot, input.value);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    real = absolute;
  }
  const rootReal = await realpath(input.pluginRoot).catch(() => path.resolve(input.pluginRoot));
  if (!isWithin(real, rootReal)) {
    input.diagnostics.push({
      severity: input.severity ?? 'warn',
      message: `"${input.field}" path resolves outside the plugin (${input.value})`,
    });
    return undefined;
  }
  return real;
}

function readSessionStart(
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): PluginManifest['sessionStart'] {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    diagnostics.push({ severity: 'warn', message: '"sessionStart" must be an object' });
    return undefined;
  }
  const skill = typeof raw['skill'] === 'string' ? raw['skill'].trim() : '';
  if (skill.length === 0) {
    diagnostics.push({
      severity: 'warn',
      message: '"sessionStart.skill" is required when sessionStart is present',
    });
    return undefined;
  }
  return { skill };
}

async function readMcpServers(
  pluginRoot: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): Promise<PluginManifest['mcpServers']> {
  const records = await readServerRecords({
    pluginRoot,
    field: 'mcpServers',
    raw,
    fallbackFile: '.mcp.json',
    wrapperField: 'mcpServers',
    diagnostics,
  });
  const out: Record<string, McpServerConfig> = {};
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        diagnostics.push({
          severity: 'warn',
          message: '"mcpServers" entries must have a non-empty name',
        });
        continue;
      }
      const substituted = substituteServerRoot(value, pluginRoot, 'mcp');
      const placeholder = findUnsupportedServerPlaceholder(substituted, 'mcp');
      if (placeholder !== undefined) {
        diagnostics.push({
          severity: 'warn',
          message: `MCP server "${trimmedName}" uses unsupported placeholder ${placeholder}`,
        });
        continue;
      }
      const parsed = McpServerConfigSchema.safeParse(substituted);
      if (!parsed.success) {
        diagnostics.push({
          severity: 'warn',
          message: `Invalid MCP server "${trimmedName}": ${parsed.error.message}`,
        });
        continue;
      }
      const normalized = await normalizePluginMcpServer({
        pluginRoot,
        name: trimmedName,
        config: parsed.data,
        diagnostics,
      });
      if (normalized !== undefined) out[trimmedName] = normalized;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

async function normalizePluginMcpServer(input: {
  readonly pluginRoot: string;
  readonly name: string;
  readonly config: McpServerConfig;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<McpServerConfig | undefined> {
  const { config } = input;
  if (config.transport === 'http' || config.transport === 'sse') return config;

  const command = await normalizeServerCommand({
    pluginRoot: input.pluginRoot,
    field: `mcpServers.${input.name}.command`,
    command: config.command,
    diagnostics: input.diagnostics,
  });
  if (command === undefined) return undefined;

  let cwd = config.cwd;
  if (cwd !== undefined) {
    cwd = await resolvePluginPathField({
      pluginRoot: input.pluginRoot,
      field: `mcpServers.${input.name}.cwd`,
      value: cwd,
      diagnostics: input.diagnostics,
      allowAbsolute: true,
    });
    if (cwd === undefined) return undefined;
  }

  return { ...config, command, cwd };
}

async function readLspServers(
  pluginRoot: string,
  raw: unknown,
  diagnostics: PluginDiagnostic[],
): Promise<PluginManifest['lspServers']> {
  const records = await readServerRecords({
    pluginRoot,
    field: 'lspServers',
    raw,
    fallbackFile: '.lsp.json',
    wrapperField: 'lspServers',
    diagnostics,
  });
  const out: Record<string, LspServerConfig> = {};
  for (const record of records) {
    for (const [name, value] of Object.entries(record)) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        diagnostics.push({
          severity: 'warn',
          message: '"lspServers" entries must have a non-empty name',
        });
        continue;
      }
      const substituted = substituteServerRoot(value, pluginRoot, 'lsp');
      const placeholder = findUnsupportedServerPlaceholder(substituted, 'lsp');
      if (placeholder !== undefined) {
        diagnostics.push({
          severity: 'warn',
          message: `LSP server "${trimmedName}" uses unsupported placeholder ${placeholder}`,
        });
        continue;
      }
      const parsed = LspServerConfigSchema.safeParse(substituted);
      if (!parsed.success) {
        diagnostics.push({
          severity: 'warn',
          message: `Invalid LSP server "${trimmedName}": ${parsed.error.message}`,
        });
        continue;
      }
      const normalized = await normalizePluginLspServer({
        pluginRoot,
        name: trimmedName,
        config: parsed.data,
        diagnostics,
      });
      if (normalized !== undefined) out[trimmedName] = normalized;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

async function readServerRecords(input: {
  readonly pluginRoot: string;
  readonly field: 'mcpServers' | 'lspServers';
  readonly raw: unknown;
  readonly fallbackFile: string;
  readonly wrapperField: 'mcpServers' | 'lspServers';
  readonly diagnostics: PluginDiagnostic[];
}): Promise<readonly Record<string, unknown>[]> {
  const fallback = path.join(input.pluginRoot, input.fallbackFile);
  const declarations =
    input.raw === undefined && (await isFile(fallback))
      ? [`./${input.fallbackFile}`]
      : input.raw === undefined
        ? []
        : asDeclarations(input.raw);
  const records: Record<string, unknown>[] = [];

  for (const declaration of declarations) {
    let record: Record<string, unknown> | undefined;
    let fromFile = false;
    if (typeof declaration === 'string') {
      const file = await resolvePluginPathField({
        pluginRoot: input.pluginRoot,
        field: input.field,
        value: declaration,
        diagnostics: input.diagnostics,
      });
      if (file === undefined) continue;
      fromFile = true;
      try {
        const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
        if (isObject(parsed)) {
          record = parsed;
        } else {
          input.diagnostics.push({
            severity: 'warn',
            message: `"${input.field}" file must contain an object (${declaration})`,
          });
        }
      } catch (error) {
        input.diagnostics.push({
          severity: 'warn',
          message: `Failed to parse ${input.field} file "${declaration}": ${(error as Error).message}`,
        });
      }
    } else if (isObject(declaration)) {
      record = declaration;
    } else {
      input.diagnostics.push({
        severity: 'warn',
        message: `"${input.field}" must be an object, path, or array of objects and paths`,
      });
    }
    if (record === undefined) continue;

    const wrapped = record[input.wrapperField];
    if (isObject(wrapped) && (fromFile || Object.keys(record).length === 1)) {
      records.push(wrapped);
    } else {
      records.push(record);
    }
  }
  return records;
}

async function normalizePluginLspServer(input: {
  readonly pluginRoot: string;
  readonly name: string;
  readonly config: LspServerConfig;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<LspServerConfig | undefined> {
  const command = await normalizeServerCommand({
    pluginRoot: input.pluginRoot,
    field: `lspServers.${input.name}.command`,
    command: input.config.command,
    diagnostics: input.diagnostics,
  });
  if (command === undefined) return undefined;

  let workspaceFolder = input.config.workspaceFolder;
  if (workspaceFolder !== undefined) {
    workspaceFolder = await resolvePluginPathField({
      pluginRoot: input.pluginRoot,
      field: `lspServers.${input.name}.workspaceFolder`,
      value: workspaceFolder,
      diagnostics: input.diagnostics,
      allowAbsolute: true,
    });
    if (workspaceFolder === undefined) return undefined;
  }

  const { transport: _transport, ...config } = input.config;
  return { ...config, command, workspaceFolder };
}

async function normalizeServerCommand(input: {
  readonly pluginRoot: string;
  readonly field: string;
  readonly command: string;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<string | undefined> {
  if (input.command.startsWith('./')) {
    return resolvePluginPathField({
      pluginRoot: input.pluginRoot,
      field: input.field,
      value: input.command,
      diagnostics: input.diagnostics,
    });
  }
  if (path.isAbsolute(input.command)) {
    const commandReal = await realpath(input.command).catch(() => path.resolve(input.command));
    const rootReal = await realpath(input.pluginRoot).catch(() => path.resolve(input.pluginRoot));
    if (isWithin(commandReal, rootReal)) return commandReal;
  }
  if (
    input.command.includes('/') ||
    input.command.includes('\\') ||
    path.win32.isAbsolute(input.command)
  ) {
    input.diagnostics.push({
      severity: 'warn',
      message: `"${input.field}" must be a PATH command or start with "./"`,
    });
    return undefined;
  }
  return input.command;
}

function substituteServerRoot(value: unknown, pluginRoot: string, kind: 'mcp' | 'lsp'): unknown {
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = { ...value };
  const scalarFields = kind === 'mcp' ? ['command', 'cwd', 'url'] : ['command', 'workspaceFolder'];
  for (const field of scalarFields) {
    if (typeof out[field] === 'string')
      out[field] = replaceClaudePluginRoot(out[field], pluginRoot);
  }
  if (Array.isArray(out['args'])) {
    out['args'] = out['args'].map((entry) =>
      typeof entry === 'string' ? replaceClaudePluginRoot(entry, pluginRoot) : entry,
    );
  }
  for (const field of kind === 'mcp' ? ['env', 'headers'] : ['env']) {
    if (!isObject(out[field])) continue;
    out[field] = Object.fromEntries(
      Object.entries(out[field]).map(([key, entry]) => [
        key,
        typeof entry === 'string' ? replaceClaudePluginRoot(entry, pluginRoot) : entry,
      ]),
    );
  }
  return out;
}

function replaceClaudePluginRoot(value: string, pluginRoot: string): string {
  return value.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
}

function findUnsupportedServerPlaceholder(value: unknown, kind: 'mcp' | 'lsp'): string | undefined {
  if (!isObject(value)) return undefined;
  const values: unknown[] = [];
  for (const field of kind === 'mcp'
    ? ['command', 'cwd', 'url', 'args', 'env', 'headers']
    : ['command', 'workspaceFolder', 'args', 'env']) {
    values.push(value[field]);
  }
  return firstPlaceholder(values);
}

function firstPlaceholder(value: unknown): string | undefined {
  if (typeof value === 'string') return /\$\{[^}]+\}/u.exec(value)?.[0];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const placeholder = firstPlaceholder(entry);
      if (placeholder !== undefined) return placeholder;
    }
    return undefined;
  }
  if (isObject(value)) {
    for (const entry of Object.values(value)) {
      const placeholder = firstPlaceholder(entry);
      if (placeholder !== undefined) return placeholder;
    }
  }
  return undefined;
}

function readAuthor(raw: unknown): PluginManifest['author'] {
  if (typeof raw === 'string') return { name: raw };
  if (!isObject(raw)) return undefined;
  const name = stringField(raw, 'name');
  const email = stringField(raw, 'email');
  const url = stringField(raw, 'url');
  if (name === undefined && email === undefined && url === undefined) return undefined;
  return { name, email, url };
}

function readRepository(raw: unknown): string | undefined {
  if (typeof raw === 'string') return nonEmpty(raw);
  if (!isObject(raw)) return undefined;
  return stringField(raw, 'url');
}

function readInterface(raw: unknown): PluginInterface | undefined {
  if (!isObject(raw)) return undefined;
  return definedInterface({
    displayName: stringField(raw, 'displayName'),
    shortDescription: stringField(raw, 'shortDescription'),
    longDescription: stringField(raw, 'longDescription'),
    developerName: stringField(raw, 'developerName'),
    websiteURL: stringField(raw, 'websiteURL'),
  });
}

function mergeInterface(input: {
  readonly manifest: PluginInterface | undefined;
  readonly displayName: string | undefined;
  readonly description: string | undefined;
  readonly authorName: string | undefined;
  readonly homepage: string | undefined;
}): PluginInterface | undefined {
  return definedInterface({
    displayName: input.displayName ?? input.manifest?.displayName,
    shortDescription: input.manifest?.shortDescription ?? input.description,
    longDescription: input.manifest?.longDescription,
    developerName: input.manifest?.developerName ?? input.authorName,
    websiteURL: input.manifest?.websiteURL ?? input.homepage,
  });
}

function definedInterface(value: PluginInterface): PluginInterface | undefined {
  return Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

function hasUsableComponent(manifest: PluginManifest): boolean {
  return (
    (manifest.skills?.length ?? 0) > 0 ||
    (manifest.agents?.length ?? 0) > 0 ||
    (manifest.outputStyles?.length ?? 0) > 0 ||
    Object.keys(manifest.mcpServers ?? {}).length > 0 ||
    Object.keys(manifest.lspServers ?? {}).length > 0
  );
}

function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? nonEmpty(value) : undefined;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function stringArrayField(
  raw: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const value = raw[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function booleanField(raw: Record<string, unknown>, key: string): boolean | undefined {
  return typeof raw[key] === 'boolean' ? raw[key] : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function exists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function isFile(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isFile();
  } catch {
    return false;
  }
}

async function isDir(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}
