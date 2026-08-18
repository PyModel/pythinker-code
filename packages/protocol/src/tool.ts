import { z } from 'zod';

export const toolSourceSchema = z.enum(['builtin', 'skill', 'mcp']);
export type ToolSource = z.infer<typeof toolSourceSchema>;

export const toolDescriptorSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input_schema: z.unknown(),
  source: toolSourceSchema,
  mcp_server_id: z.string().min(1).optional(),
  // v2 extension beyond the v1 wire shape: effective availability after the
  // profile / global `[tools]` config / session denylist gates. Optional so
  // the legacy v1 projection (no gate concept) still satisfies the schema.
  active: z.boolean().optional(),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const mcpServerStatusSchema = z.enum([
  'connected',
  'connecting',
  'disconnected',
  'error',
]);
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>;

export const mcpServerTransportSchema = z.enum(['stdio', 'http', 'sse']);
export type McpServerTransport = z.infer<typeof mcpServerTransportSchema>;

export const mcpServerDefinitionSchema = z.object({
  transport: mcpServerTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  executor: z.enum(['local', 'kaos']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bearer_token_env_var: z.string().optional(),
  enabled: z.boolean().optional(),
  startup_timeout_ms: z.number().int().min(1).optional(),
  tool_timeout_ms: z.number().int().min(1).optional(),
  enabled_tools: z.array(z.string()).optional(),
  disabled_tools: z.array(z.string()).optional(),
});
export type McpServerDefinition = z.infer<typeof mcpServerDefinitionSchema>;

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: mcpServerTransportSchema,
  status: mcpServerStatusSchema,
  last_error: z.string().optional(),
  tool_count: z.number().int().nonnegative(),
  editable: z.boolean(),
  definition: mcpServerDefinitionSchema.optional(),
});
export type McpServer = z.infer<typeof mcpServerSchema>;
