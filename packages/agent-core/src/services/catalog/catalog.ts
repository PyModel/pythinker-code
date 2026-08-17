/**
 * `ICatalogService` — daemon-facing view of what the agent can reach beyond
 * skills and MCP servers: installed plugins and the subagent profiles.
 *
 * Both are read from the core process and both are global rather than
 * session-scoped, so they share one service instead of two near-identical
 * wrappers around `ICoreProcessService.rpc`.
 *
 * **CoreAPI surface used**:
 *   - `core.rpc.listPlugins({})` → `readonly PluginSummary[]`
 *   - `core.rpc.setPluginEnabled({id, enabled})`
 *   - `core.rpc.listAgentProfiles({workDir})` → `AgentProfileCatalog`
 *
 * **Anti-corruption**: imports `@pymodel/agent-core` internals only for the
 * `createDecorator` value and the rpc payload types.
 */

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
