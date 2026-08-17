/**
 * `/tools` + `/mcp/servers*` REST routes.
 *
 * 3 endpoints (REST.md §3.8):
 *
 *   GET  /tools                                  query: {session_id?}    data: {tools: ToolDescriptor[]}
 *   GET  /mcp/servers                            -                       data: {servers: McpServer[]}
 *   POST /mcp/servers                            body: {mcp_server_id, config}
 *   PUT  /mcp/servers/{mcp_server_id}             body: {config}
 *   DELETE /mcp/servers/{mcp_server_id}
 *   POST /mcp/servers/{mcp_server_id}:restart    body: empty             data: {restarting: true}
 *
 * **Error mapping**:
 *   - `McpServerNotFoundError` → envelope `code: 40408 mcp.server_not_found`.
 *   - Other errors → 50001 via the global `installErrorHandler`.
 *
 * **Action suffix**: the `:restart` POST endpoint uses the shared
 * `parseActionSuffix` helper.
 *
 * **Anti-corruption**: route resolves `IToolService` / `IMcpService` via the
 * accessor; no SDK imports.
 */

import {
  ErrorCode,
  createMcpServerRequestSchema,
  createMcpServerResponseSchema,
  deleteMcpServerResponseSchema,
  listMcpServersResponseSchema,
  listToolsQuerySchema,
  listToolsResponseSchema,
  mcpServerIdParamSchema,
  restartMcpServerResultSchema,
  updateMcpServerRequestSchema,
  updateMcpServerResponseSchema,
} from '@pymodel/protocol';
import {
  IMcpService,
  IToolService,
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  type IInstantiationService,
} from '@pymodel/agent-core';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { parseActionSuffix } from './action-suffix';

interface ToolsRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; query: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  put(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerToolsRoutes(
  app: ToolsRouteHost,
  ix: IInstantiationService,
): void {
  // GET /tools ----------------------------------------------------------
  const listToolsRoute = defineRoute(
    {
      method: 'GET',
      path: '/tools',
      querystring: listToolsQuerySchema,
      success: { data: listToolsResponseSchema },
      description: 'List available tools',
      tags: ['tools'],
    },
    async (req, reply) => {
      try {
        const tools = await ix.invokeFunction((a) =>
          a.get(IToolService).list(req.query.session_id),
        );
        reply.send(okEnvelope({ tools }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    listToolsRoute.path,
    listToolsRoute.options,
    listToolsRoute.handler as Parameters<ToolsRouteHost['get']>[2],
  );

  // GET /mcp/servers ----------------------------------------------------
  const listMcpServersRoute = defineRoute(
    {
      method: 'GET',
      path: '/mcp/servers',
      success: { data: listMcpServersResponseSchema },
      description: 'List configured MCP servers',
      tags: ['tools'],
    },
    async (req, reply) => {
      try {
        const servers = await ix.invokeFunction((a) => a.get(IMcpService).list());
        reply.send(okEnvelope({ servers }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    listMcpServersRoute.path,
    listMcpServersRoute.options,
    listMcpServersRoute.handler as Parameters<ToolsRouteHost['get']>[2],
  );

  const createMcpServerRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers',
      body: createMcpServerRequestSchema,
      success: { data: createMcpServerResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Create a user-global MCP server',
      tags: ['tools'],
      operationId: 'createMcpServer',
    },
    async (req, reply) => {
      try {
        await ix.invokeFunction((a) =>
          a.get(IMcpService).create(req.body.mcp_server_id, toAgentMcpConfig(req.body.config)),
        );
        reply.send(okEnvelope({ created: true as const }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    createMcpServerRoute.path,
    createMcpServerRoute.options,
    createMcpServerRoute.handler as Parameters<ToolsRouteHost['post']>[2],
  );

  const updateMcpServerRoute = defineRoute(
    {
      method: 'PUT',
      path: '/mcp/servers/{mcp_server_id}',
      params: mcpServerIdParamSchema,
      body: updateMcpServerRequestSchema,
      success: { data: updateMcpServerResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
      },
      description: 'Replace a user-global MCP server',
      tags: ['tools'],
      operationId: 'updateMcpServer',
    },
    async (req, reply) => {
      try {
        await ix.invokeFunction((a) =>
          a.get(IMcpService).update(
            req.params.mcp_server_id,
            toAgentMcpConfig(req.body.config),
          ),
        );
        reply.send(okEnvelope({ updated: true as const }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.put(
    updateMcpServerRoute.path,
    updateMcpServerRoute.options,
    updateMcpServerRoute.handler as Parameters<ToolsRouteHost['put']>[2],
  );

  const deleteMcpServerRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/mcp/servers/{mcp_server_id}',
      params: mcpServerIdParamSchema,
      success: { data: deleteMcpServerResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
      },
      description: 'Delete a user-global MCP server',
      tags: ['tools'],
      operationId: 'deleteMcpServer',
    },
    async (req, reply) => {
      try {
        await ix.invokeFunction((a) =>
          a.get(IMcpService).remove(req.params.mcp_server_id),
        );
        reply.send(okEnvelope({ deleted: true as const }, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.delete(
    deleteMcpServerRoute.path,
    deleteMcpServerRoute.options,
    deleteMcpServerRoute.handler as Parameters<ToolsRouteHost['delete']>[2],
  );

  // POST /mcp/servers/{mcp_server_id}:restart ---------------------------
  const restartMcpServerRoute = defineRoute(
    {
      method: 'POST',
      path: '/mcp/servers/{tail}',
      success: { data: restartMcpServerResultSchema },
      errors: {
        [ErrorCode.MCP_SERVER_NOT_FOUND]: {},
      },
      description: 'Restart an MCP server by ID',
      tags: ['tools'],
      operationId: 'restartMcpServer',
    },
    async (req, reply) => {
      try {
        const { tail } = req.params as { tail: string };
        const parsed = parseActionSuffix({
          tail,
          allowedActions: ['restart'] as const,
          resourceLabel: 'mcp_server',
        });
        if (parsed.kind === 'invalid') {
          reply.send(
            errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.reason, req.id),
          );
          return;
        }
        if (parsed.kind === 'bare') {
          // No bare form for /mcp/servers/{id} — only :restart.
          reply.send(
            errEnvelope(
              ErrorCode.VALIDATION_FAILED,
              `unsupported action: ${tail}`,
              req.id,
            ),
          );
          return;
        }
        const result = await ix.invokeFunction((a) =>
          a.get(IMcpService).restart(parsed.id),
        );
        reply.send(okEnvelope(result, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    restartMcpServerRoute.path,
    restartMcpServerRoute.options,
    restartMcpServerRoute.handler as Parameters<ToolsRouteHost['post']>[2],
  );
}

/**
 * Map a thrown error to the right envelope. See module header for the table.
 */
function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof McpServerNotFoundError) {
    reply.send(errEnvelope(ErrorCode.MCP_SERVER_NOT_FOUND, err.message, requestId));
    return;
  }
  if (err instanceof McpServerAlreadyExistsError || err instanceof McpServerValidationError) {
    reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, err.message, requestId));
    return;
  }
  throw err;
}

function toAgentMcpConfig(input: Record<string, unknown>): Record<string, unknown> {
  const config = { ...input };
  renameWireKey(config, 'bearer_token_env_var', 'bearerTokenEnvVar');
  renameWireKey(config, 'startup_timeout_ms', 'startupTimeoutMs');
  renameWireKey(config, 'tool_timeout_ms', 'toolTimeoutMs');
  renameWireKey(config, 'enabled_tools', 'enabledTools');
  renameWireKey(config, 'disabled_tools', 'disabledTools');
  return config;
}

function renameWireKey(
  input: Record<string, unknown>,
  wireKey: string,
  agentKey: string,
): void {
  if (!Object.hasOwn(input, wireKey)) return;
  input[agentKey] = input[wireKey];
  delete input[wireKey];
}
