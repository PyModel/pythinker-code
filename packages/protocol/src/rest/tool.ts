/**
 *   GET  /v1/tools
 *     Query: `{ session_id?: string }` — when omitted returns global tool list;
 *            when present returns the session-effective list (REST §3.8 line 430).
 *     Response data: `{ tools: ToolDescriptor[] }`
 *
 *   GET  /v1/mcp/servers
 *     Response data: `{ servers: McpServer[] }`
 *
 *   POST /v1/mcp/servers
 *     Body: `{ mcp_server_id, config }`
 *     Response data: `{ created: true }`
 *
 *   PUT /v1/mcp/servers/{mcp_server_id}
 *     Body: `{ config }`
 *     Response data: `{ updated: true }`
 *
 *   DELETE /v1/mcp/servers/{mcp_server_id}
 *     Response data: `{ deleted: true }`
 *
 *   POST /v1/mcp/servers/{mcp_server_id}:restart
 *     Body: empty
 *     Response data: `{ restarting: true }` (REST §3.8 line 442)
 *     Errors: 40408 mcp.server_not_found
 */

import { z } from 'zod';

import { mcpServerDefinitionSchema, mcpServerSchema, toolDescriptorSchema } from '../tool';

export const listToolsQuerySchema = z.object({
  session_id: z.string().min(1).optional(),
});
export type ListToolsQuery = z.infer<typeof listToolsQuerySchema>;

export const listToolsResponseSchema = z.object({
  tools: z.array(toolDescriptorSchema),
});
export type ListToolsResponse = z.infer<typeof listToolsResponseSchema>;

export const listMcpServersResponseSchema = z.object({
  servers: z.array(mcpServerSchema),
});
export type ListMcpServersResponse = z.infer<typeof listMcpServersResponseSchema>;

export const mcpServerIdSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'MCP server id must be trimmed')
  .refine((value) => !/[\\/"]/.test(value), 'MCP server id must not contain a path separator or quote');
export type McpServerId = z.infer<typeof mcpServerIdSchema>;

export const mcpServerIdParamSchema = z.object({
  mcp_server_id: mcpServerIdSchema,
});
export type McpServerIdParam = z.infer<typeof mcpServerIdParamSchema>;

export const mcpServerConfigRequestSchema = mcpServerDefinitionSchema.partial();
export type McpServerConfigRequest = z.infer<typeof mcpServerConfigRequestSchema>;

export const createMcpServerRequestSchema = z.object({
  mcp_server_id: mcpServerIdSchema,
  config: mcpServerConfigRequestSchema,
});
export type CreateMcpServerRequest = z.infer<typeof createMcpServerRequestSchema>;

export const updateMcpServerRequestSchema = z.object({
  config: mcpServerConfigRequestSchema,
});
export type UpdateMcpServerRequest = z.infer<typeof updateMcpServerRequestSchema>;

export const createMcpServerResponseSchema = z.object({
  created: z.literal(true),
});
export type CreateMcpServerResponse = z.infer<typeof createMcpServerResponseSchema>;

export const updateMcpServerResponseSchema = z.object({
  updated: z.literal(true),
});
export type UpdateMcpServerResponse = z.infer<typeof updateMcpServerResponseSchema>;

export const deleteMcpServerResponseSchema = z.object({
  deleted: z.literal(true),
});
export type DeleteMcpServerResponse = z.infer<typeof deleteMcpServerResponseSchema>;

export const restartMcpServerResultSchema = z.object({
  restarting: z.literal(true),
});
export type RestartMcpServerResult = z.infer<typeof restartMcpServerResultSchema>;
