/**
 * `IToolService` — daemon-facing read-only tool surface.
 *
 * Wraps `ICoreProcessService.rpc.getTools` and translates agent-core's `ToolInfo`
 * (camelCase, includes `'user'` source literal) into SCHEMAS §8 `ToolDescriptor`
 * (snake_case, `'skill'` literal). Adapter helpers (`toProtocolTool`,
 * `AgentCoreToolInfoLike`) are co-located here.
 *
 * **CoreAPI surface used**:
 *   - `bridge.rpc.getTools({}) => readonly ToolInfo[]` (packages/agent-core/src/rpc/core-api.ts:333).
 *
 * **REST.md §3.8 ?session_id behavior**: when caller passes a session_id the
 * route currently returns the same global list — agent-core's `getTools`
 * doesn't differentiate per-session, and `setActiveTools` is the only
 * per-session knob. Documented gap in `ToolService`.
 *
 * **Anti-corruption**: imports `@pymodel/agent-core` only for the
 * `createDecorator` value.
 */

import { createDecorator } from '../../di';
import type { ToolDescriptor, ToolSource } from '@pymodel/protocol';

// ---------------------------------------------------------------------------
// Adapter helpers (tool side of former adapter/tool-adapter.ts)
// ---------------------------------------------------------------------------

/**
 * In-process minimal shape we accept for tool conversion. Mirrors
 * `@pymodel/agent-core` `ToolInfo` without taking a runtime dependency on
 * its exact shape (the adapter is the boundary).
 */
export interface AgentCoreToolInfoLike {
  readonly name: string;
  readonly description: string;
  readonly source: 'builtin' | 'user' | 'mcp';
  readonly mcpServerId?: string;
  readonly inputSchema?: Record<string, unknown>;
  /** agent-core may add fields like `active`; we ignore them. */
  readonly active?: boolean;
}

function mapToolSource(s: AgentCoreToolInfoLike['source']): ToolSource {
  switch (s) {
    case 'builtin':
      return 'builtin';
    case 'user':
      return 'skill';
    case 'mcp':
      return 'mcp';
  }
}

export function toProtocolTool(info: AgentCoreToolInfoLike): ToolDescriptor {
  const source = mapToolSource(info.source);
  const base: ToolDescriptor = {
    name: info.name,
    description: info.description,
    // Older ToolInfo producers may omit the schema; null keeps that wire value honest.
    input_schema: info.inputSchema ?? null,
    source,
  };
  if (source === 'mcp' && info.mcpServerId !== undefined) {
    return { ...base, mcp_server_id: info.mcpServerId };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Interface + implementation
// ---------------------------------------------------------------------------

export interface IToolService {
  readonly _serviceBrand: undefined;

  /**
   * Return the available tool descriptors. When `sessionId` is supplied, the
   * impl may return a session-effective subset; today it returns the global
   * list (CoreAPI gap documented in the impl).
   */
  list(sessionId?: string): Promise<readonly ToolDescriptor[]>;
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const IToolService = createDecorator<IToolService>('toolService');

void IToolService;
