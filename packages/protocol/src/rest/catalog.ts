import { z } from 'zod';

/** One installed plugin and whether it is currently enabled. */
export const pluginSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().min(1),
  version: z.string().optional(),
  enabled: z.boolean(),
  state: z.string(),
  skill_count: z.number().int().nonnegative(),
  mcp_server_count: z.number().int().nonnegative(),
  has_errors: z.boolean(),
  source: z.string(),
});
export type Plugin = z.infer<typeof pluginSchema>;

export const listPluginsResponseSchema = z.object({
  plugins: z.array(pluginSchema),
});
export type ListPluginsResponse = z.infer<typeof listPluginsResponseSchema>;

export const setPluginEnabledRequestSchema = z.object({
  enabled: z.boolean(),
});
export type SetPluginEnabledRequest = z.infer<typeof setPluginEnabledRequestSchema>;

export const setPluginEnabledResultSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});
export type SetPluginEnabledResult = z.infer<typeof setPluginEnabledResultSchema>;

/** One subagent profile the agent can dispatch work to. */
export const agentProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(['built-in', 'plugin', 'user', 'project']),
  tools: z.array(z.string()),
  model: z.string().optional(),
  effort: z.string().optional(),
  when_to_use: z.string().optional(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const listAgentProfilesResponseSchema = z.object({
  profiles: z.array(agentProfileSchema),
});
export type ListAgentProfilesResponse = z.infer<typeof listAgentProfilesResponseSchema>;
