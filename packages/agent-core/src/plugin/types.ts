import type { McpServerConfig } from '../config/schema';
import type { LspServerConfig } from '../lsp/types';

export type PluginDiagnosticSeverity = 'error' | 'warn' | 'info';

export interface PluginDiagnostic {
  readonly severity: PluginDiagnosticSeverity;
  readonly message: string;
}

export interface PluginAuthor {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

export type PluginDefinitionJsonPrimitive = string | number | boolean | null;
export type PluginDefinitionJsonValue =
  | PluginDefinitionJsonPrimitive
  | readonly PluginDefinitionJsonValue[]
  | { readonly [key: string]: PluginDefinitionJsonValue };
export type PluginDefinitionJsonObject = {
  readonly [key: string]: PluginDefinitionJsonValue;
};

export type PluginPathDeclaration = string | readonly string[];
export type PluginConfigDeclaration =
  | string
  | PluginDefinitionJsonObject
  | readonly (string | PluginDefinitionJsonObject)[];

export interface PluginComponentDeclarations {
  readonly skills?: PluginPathDeclaration;
  readonly agents?: PluginPathDeclaration;
  readonly outputStyles?: PluginPathDeclaration;
  readonly mcpServers?: PluginConfigDeclaration;
  readonly lspServers?: PluginConfigDeclaration;
}

/** Serializable marketplace data used to materialize a plugin. */
export interface PluginInstallDefinition {
  /** Stable marketplace slug. This always becomes the installed plugin identity. */
  readonly id: string;
  readonly displayName?: string;
  readonly version?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly author?: PluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly components?: PluginComponentDeclarations;
  /** Declared component kinds that Pythinker deliberately does not execute. */
  readonly unsupportedComponents?: readonly string[];
  readonly strict?: boolean;
  readonly defaultEnabled?: boolean;
}

export interface PluginInstallOptions {
  /** Repository-relative plugin root for GitHub archive installs. */
  readonly repositorySubdirectory?: string;
  readonly definition?: PluginInstallDefinition;
}

export interface PluginSessionStart {
  readonly skill: string;
}

export interface PluginInterface {
  readonly displayName?: string;
  readonly shortDescription?: string;
  readonly longDescription?: string;
  readonly developerName?: string;
  readonly websiteURL?: string;
}

export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly tags?: readonly string[];
  readonly category?: string;
  readonly author?: PluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly defaultEnabled?: boolean;
  readonly skills?: readonly string[]; // resolved absolute paths
  readonly agents?: readonly string[]; // resolved absolute files or directories
  readonly outputStyles?: readonly string[]; // resolved absolute files or directories
  readonly sessionStart?: PluginSessionStart;
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  readonly lspServers?: Readonly<Record<string, LspServerConfig>>;
  readonly interface?: PluginInterface;
  readonly skillInstructions?: string;
}

export interface PluginAgentProfileSource {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly paths: readonly string[];
}

export interface PluginOutputStyleSource {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly paths: readonly string[];
}

export interface PluginMcpServerState {
  readonly enabled: boolean;
}

export interface PluginCapabilityState {
  readonly mcpServers?: Readonly<Record<string, PluginMcpServerState>>;
}

export interface PluginMcpServerInfo {
  readonly name: string;
  readonly runtimeName: string;
  readonly enabled: boolean;
  readonly transport: 'stdio' | 'http' | 'sse';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly url?: string;
  readonly envKeys?: readonly string[];
  readonly headerKeys?: readonly string[];
}

export type PluginManifestKind =
  | 'pythinker-plugin-root'
  | 'pythinker-plugin-dir'
  | 'claude-plugin'
  | 'marketplace-definition';
export type PluginSource = 'local-path' | 'zip-url' | 'github';
export type PluginState = 'ok' | 'error';

export interface PluginGithubRef {
  readonly kind: 'branch' | 'tag' | 'sha';
  readonly value: string;
}

export interface PluginGithubMetadata {
  readonly owner: string;
  readonly repo: string;
  readonly ref: PluginGithubRef;
  readonly installedSha?: string;
}

export interface PluginRecord {
  readonly id: string;
  readonly root: string;
  readonly source: PluginSource;
  readonly enabled: boolean;
  readonly state: PluginState;
  readonly installedAt: string;
  readonly updatedAt?: string;
  readonly originalSource?: string;
  readonly capabilities?: PluginCapabilityState;
  readonly github?: PluginGithubMetadata;
  readonly definition?: PluginInstallDefinition;
  readonly skillInstructions?: string;
  readonly skillCount: number;
  readonly manifest?: PluginManifest;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly shadowedManifestPath?: string;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface PluginSummary {
  readonly id: string;
  readonly displayName: string;
  readonly version?: string;
  readonly enabled: boolean;
  readonly state: PluginState;
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly enabledMcpServerCount: number;
  readonly hasErrors: boolean;
  readonly source: PluginSource;
  readonly originalSource?: string;
  readonly github?: PluginGithubMetadata;
}

export interface PluginInfo extends PluginSummary {
  readonly root: string;
  readonly installedAt: string;
  readonly updatedAt?: string;
  readonly manifestKind?: PluginManifestKind;
  readonly manifestPath?: string;
  readonly manifest?: PluginManifest;
  readonly mcpServers: readonly PluginMcpServerInfo[];
  readonly shadowedManifestPath?: string;
  readonly diagnostics: readonly PluginDiagnostic[];
}

export interface EnabledPluginSessionStart {
  readonly pluginId: string;
  readonly skillName: string;
}

export interface ReloadSummary {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly errors: ReadonlyArray<{ readonly id: string; readonly message: string }>;
}

export const PLUGIN_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizePluginId(name: string): string {
  return name.toLowerCase();
}
