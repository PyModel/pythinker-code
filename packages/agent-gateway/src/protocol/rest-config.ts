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
  default_permission_mode: z.string().optional(),
  default_plan_mode: z.boolean().optional(),
  permission: z.unknown().optional(),
  hooks: z.array(z.unknown()).optional(),
  services: z.unknown().optional(),
  merge_all_available_skills: z.boolean().optional(),
  extra_skill_dirs: z.array(z.string()).optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  subagent: z.unknown().optional(),
  secondary_model: z.unknown().optional(),
  experimental: z.record(z.string(), z.boolean()).optional(),
  telemetry: z.boolean().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;

const optionalModelAlias = z.string().min(1).optional();

export const legacySecondaryModelRequestSchema = z
  .object({
    default_model: optionalModelAlias,
    defaultModel: optionalModelAlias,
    model: optionalModelAlias,
    default_effort: z.string().optional(),
    defaultEffort: z.string().optional(),
    models: z.record(z.string(), z.string()).optional(),
    force: z.boolean().optional(),
  })
  .strict();
export type LegacySecondaryModelRequest = z.infer<typeof legacySecondaryModelRequestSchema>;

export const patchConfigRequestSchema = z.object({
  providers: z.record(z.string(), z.unknown()).optional(),
  default_provider: z.string().optional(),
  default_model: z.string().optional(),
  models: z.record(z.string(), z.unknown()).optional(),
  thinking: z.unknown().optional(),
  plan_mode: z.boolean().optional(),
  yolo: z.boolean().optional(),
  default_permission_mode: z.string().optional(),
  default_plan_mode: z.boolean().optional(),
  permission: z.unknown().optional(),
  hooks: z.array(z.unknown()).optional(),
  services: z.unknown().optional(),
  merge_all_available_skills: z.boolean().optional(),
  extra_skill_dirs: z.array(z.string()).optional(),
  loop_control: z.unknown().optional(),
  background: z.unknown().optional(),
  subagent: z.unknown().optional(),
  secondary_model: legacySecondaryModelRequestSchema.nullable().optional(),
  experimental: z.record(z.string(), z.boolean()).optional(),
  telemetry: z.boolean().optional(),
});
export type PatchConfigRequest = z.infer<typeof patchConfigRequestSchema>;
