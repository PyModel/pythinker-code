import { z } from 'zod';

export const providerConfigResponseSchema = z.object({
  type: z.string(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  has_api_key: z.boolean(),
});
export type ProviderConfigResponse = z.infer<typeof providerConfigResponseSchema>;

export const configResponseSchema = z.object({
  providers: z.record(z.string(), providerConfigResponseSchema).default({}),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.unknown()).optional(),
  thinking: z.unknown().optional(),
  plan_mode: z.boolean().optional(),
  yolo: z.boolean().optional(),
  default_thinking: z.boolean().optional(),
  default_permission_mode: z.string().optional(),
  default_plan_mode: z.boolean().optional(),
  permission: z.unknown().optional(),
  hooks: z.array(z.unknown()).optional(),
  services: z.unknown().optional(),
  merge_all_available_skills: z.boolean().optional(),
  disabled_skills: z.array(z.string()).optional(),
  extra_skill_dirs: z.array(z.string()).optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  subagent: z.unknown().optional(),
  secondary_model: z.unknown().optional(),
  experimental: z.record(z.string(), z.boolean()).optional(),
  telemetry: z.boolean().optional(),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;

const optionalModelAlias = z.string().min(1).optional();
const droppedLegacyMetadata = z.unknown().optional();

export const legacySecondaryModelRequestSchema = z
  .object({
    default_model: optionalModelAlias,
    defaultModel: optionalModelAlias,
    model: optionalModelAlias,
    default_effort: z.string().optional(),
    defaultEffort: z.string().optional(),
    models: z.record(z.string(), z.string()).optional(),
    force: z.boolean().optional(),
    max_context_size: droppedLegacyMetadata,
    maxContextSize: droppedLegacyMetadata,
    max_input_size: droppedLegacyMetadata,
    maxInputSize: droppedLegacyMetadata,
    max_output_size: droppedLegacyMetadata,
    maxOutputSize: droppedLegacyMetadata,
    capabilities: droppedLegacyMetadata,
    display_name: droppedLegacyMetadata,
    displayName: droppedLegacyMetadata,
    reasoning_key: droppedLegacyMetadata,
    reasoningKey: droppedLegacyMetadata,
    adaptive_thinking: droppedLegacyMetadata,
    adaptiveThinking: droppedLegacyMetadata,
    support_efforts: droppedLegacyMetadata,
    supportEfforts: droppedLegacyMetadata,
    off_effort: droppedLegacyMetadata,
    offEffort: droppedLegacyMetadata,
  })
  .strict();
export type LegacySecondaryModelRequest = z.infer<typeof legacySecondaryModelRequestSchema>;

const policyModelAlias = z.string().min(1);
const policyEffort = z.string().min(1).optional();

export const subagentModelPolicyRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({ mode: z.literal('default'), default_model: policyModelAlias, default_effort: policyEffort }).strict(),
  z
    .object({
      mode: z.literal('pool'),
      default_model: policyModelAlias,
      models: z.record(z.string(), z.string()),
      default_effort: policyEffort,
    })
    .strict(),
  z.object({ mode: z.literal('force'), default_model: policyModelAlias, default_effort: policyEffort }).strict(),
]);
export type SubagentModelPolicyRequest = z.infer<typeof subagentModelPolicyRequestSchema>;

export const subagentModelPolicyWireSchema = z.object({
  mode: z.enum(['inherit', 'default', 'pool', 'force']),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.string()).optional(),
  default_effort: z.string().optional(),
});
export type SubagentModelPolicyWire = z.infer<typeof subagentModelPolicyWireSchema>;

export const subagentModelPolicyResponseSchema = z.object({
  policy: subagentModelPolicyWireSchema,
  resource_version: z.string().min(1),
  effective: z.object({
    configured_policy: subagentModelPolicyWireSchema,
    effective_policy: subagentModelPolicyWireSchema,
    policy_source: z.enum(['config', 'default']),
    feature: z.object({
      enabled: z.boolean(),
      source: z.enum(['master-env', 'env', 'config', 'default']),
    }),
  }),
});
export type SubagentModelPolicyResponse = z.infer<typeof subagentModelPolicyResponseSchema>;

export const patchConfigRequestSchema = z.object({
  providers: z.record(z.string(), z.unknown()).optional(),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.unknown()).optional(),
  thinking: z.unknown().optional(),
  plan_mode: z.boolean().optional(),
  yolo: z.boolean().optional(),
  default_thinking: z.boolean().optional(),
  default_permission_mode: z.string().optional(),
  default_plan_mode: z.boolean().optional(),
  permission: z.unknown().optional(),
  hooks: z.array(z.unknown()).optional(),
  services: z.unknown().optional(),
  merge_all_available_skills: z.boolean().optional(),
  disabled_skills: z.array(z.string()).optional(),
  extra_skill_dirs: z.array(z.string()).optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  subagent: z.unknown().optional(),
  secondary_model: legacySecondaryModelRequestSchema.nullable().optional(),
  experimental: z.record(z.string(), z.boolean()).optional(),
  telemetry: z.boolean().optional(),
});
export type PatchConfigRequest = z.infer<typeof patchConfigRequestSchema>;
