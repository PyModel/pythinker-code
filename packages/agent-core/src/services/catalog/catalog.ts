import { createDecorator } from '../../di';
import type { AgentProfileSummary } from '../../rpc';
import type { PluginSummary } from '../../plugin';
import type { AgentProfile, Plugin } from '@pymodel/protocol';

// ---------------------------------------------------------------------------
// Adapter helpers
// ---------------------------------------------------------------------------

export function toProtocolPlugin(summary: PluginSummary): Plugin {
  return {
    id: summary.id,
    display_name: summary.displayName,
    version: summary.version,
    enabled: summary.enabled,
    state: summary.state,
    skill_count: summary.skillCount,
    mcp_server_count: summary.mcpServerCount,
    has_errors: summary.hasErrors,
    source: summary.source,
  };
}

export function toProtocolAgentProfile(summary: AgentProfileSummary): AgentProfile {
  return {
    name: summary.name,
    description: summary.description,
    source: summary.source,
    tools: [...summary.tools],
    model: summary.model,
    effort: summary.effort,
    when_to_use: summary.whenToUse,
  };
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ICatalogService {
  readonly _serviceBrand: undefined;

  /** Installed plugins and whether each one is currently enabled. */
  listPlugins(): Promise<readonly Plugin[]>;

  /** Enable or disable one plugin. Unknown ids are reported by the core. */
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;

  /** Subagent profiles resolvable from `workDir` (built-in, plugin, user, project). */
  listAgentProfiles(workDir: string): Promise<readonly AgentProfile[]>;
}

export const ICatalogService = createDecorator<ICatalogService>('catalogService');
