import { z } from 'zod';

import { isoDateTimeSchema } from '@pymodel/agent-core-v2/_base/utils/isoDateTime';

const roleSchema = z.enum(['fusion_lead', 'peer']);
const stageSchema = z.enum(['opening', 'review', 'fusion', 'terminal']);
const artifactStateSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'unavailable']);

const tokenUsageSchema = z.object({
  input_other: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  input_cache_read: z.number().int().nonnegative(),
  input_cache_creation: z.number().int().nonnegative(),
});

const capabilitySchema = z.object({
  image_in: z.boolean(),
  video_in: z.boolean(),
  audio_in: z.boolean(),
  thinking: z.boolean(),
  tool_use: z.boolean(),
  max_context_tokens: z.number().int().positive(),
  max_input_tokens: z.number().int().positive().optional(),
  dynamically_loaded_tools: z.boolean().optional(),
});

export const expertTalkBindingSchema = z.object({
  role: roleSchema,
  requested_model_id: z.string().min(1),
  effective_model_id: z.string().min(1),
  thinking_effort: z.string().min(1).optional(),
  protocol: z.enum(['anthropic', 'openai', 'openai_responses', 'google-genai']),
  provider: z.string().min(1),
  wire_model: z.string().min(1),
  target_fingerprint: z.string().min(1),
  capabilities: capabilitySchema,
  max_context_size: z.number().int().positive(),
  max_input_size: z.number().int().positive().optional(),
  max_output_size: z.number().int().positive().optional(),
  routing_environment_revision: z.string().min(1),
  route_decision_fingerprint: z.string().min(1),
});

export const expertTalkArtifactSchema = z.object({
  role: roleSchema,
  stage: z.enum(['opening', 'review', 'fusion']),
  state: artifactStateSchema,
  text: z.string().optional(),
  thinking: z.string().optional(),
  tools: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  })).optional(),
  digest: z.string().min(1).optional(),
  partial: z.boolean(),
  started_at: isoDateTimeSchema.optional(),
  ended_at: isoDateTimeSchema.optional(),
  usage: tokenUsageSchema.optional(),
  request_count: z.number().int().nonnegative().optional(),
  provider_attempt_count: z.number().int().nonnegative().optional(),
  tool_call_count: z.number().int().nonnegative().optional(),
  tool_result_tokens: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
  error_reason: z.string().min(1).optional(),
});

const expertTalkResultV1Schema = z.object({
  version: z.literal('expert_talk_result/v1'),
  answer: z.string().min(1),
  notes: z.object({
    consensus: z.array(z.string()),
    divergence: z.array(z.string()),
    uncertainty: z.array(z.string()),
    attribution: z.array(z.object({
      role: roleSchema,
      stage: z.enum(['opening', 'review']),
      claim: z.string().min(1),
    })),
  }),
});

export const expertTalkResultSchema = z.union([
  expertTalkResultV1Schema,
  z.object({
    version: z.string().min(1),
    answer: z.string().min(1),
  }),
]);

const runErrorSchema = z.object({
  reason: z.string().min(1),
  message: z.string().min(1),
  stage: stageSchema,
  role: roleSchema.optional(),
  retryable: z.boolean(),
  action: z.string().min(1),
});

const runUsageSchema = z.object({
  complete: z.boolean(),
  total: tokenUsageSchema.optional(),
  request_count: z.number().int().nonnegative().optional(),
  provider_attempt_count: z.number().int().nonnegative().optional(),
  tool_call_count: z.number().int().nonnegative().optional(),
  tool_result_tokens: z.number().int().nonnegative().optional(),
});

export const expertTalkRunSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  session_id: z.string().min(1),
  turn_id: z.number().int().nonnegative(),
  prompt_id: z.string().min(1),
  retry_of: z.string().min(1).optional(),
  state: z.enum([
    'running',
    'completed',
    'cancelled',
    'failed',
    'interrupted',
  ]),
  stage: stageSchema,
  created_at: isoDateTimeSchema,
  started_at: isoDateTimeSchema.optional(),
  ended_at: isoDateTimeSchema.optional(),
  updated_at: isoDateTimeSchema,
  bindings: z.object({
    fusion_lead: expertTalkBindingSchema,
    peer: expertTalkBindingSchema,
  }),
  opening: z.object({
    lead: expertTalkArtifactSchema,
    peer: expertTalkArtifactSchema,
  }),
  review: z.object({
    lead: expertTalkArtifactSchema,
    peer: expertTalkArtifactSchema,
  }),
  fusion: expertTalkArtifactSchema.optional(),
  result: expertTalkResultSchema.optional(),
  usage: runUsageSchema,
  error: runErrorSchema.optional(),
  orphaned_participant_ids: z.array(z.string().min(1)).optional(),
  progress_revision: z.number().int().nonnegative().optional(),
  revision: z.number().int().positive(),
});

export const expertTalkStatusSchema = z.object({
  schema_version: z.literal(1),
  feature: z.enum(['enabled', 'disabled']),
  resource_version: z.string().min(1),
  config: z.object({
    fusion_lead_model_id: z.string().min(1),
    peer_model_id: z.string().min(1),
    fusion_lead_thinking_effort: z.string().min(1).optional(),
    peer_thinking_effort: z.string().min(1).optional(),
  }).nullable(),
  activation: z.object({
    state: z.enum(['idle', 'armed']),
    arm_id: z.string().min(1).optional(),
    armed_at: isoDateTimeSchema.optional(),
  }),
  active_run_id: z.string().min(1).optional(),
  latest_run_id: z.string().min(1).optional(),
  pair_validation: z.object({
    state: z.enum(['valid', 'stale', 'ineligible', 'collapsed', 'unknown']),
    reason: z.string().optional(),
  }),
});

export const expertTalkConfigureSchema = z.object({
  fusion_lead_model_id: z.string().min(1),
  peer_model_id: z.string().min(1),
  fusion_lead_thinking_effort: z.string().min(1).optional(),
  peer_thinking_effort: z.string().min(1).optional(),
});

export const expertTalkDisarmSchema = z.object({
  arm_id: z.string().min(1).optional(),
});

export const expertTalkRunListSchema = z.object({
  runs: z.array(expertTalkRunSchema),
  next_cursor: z.string().min(1).optional(),
});

export const expertTalkRunListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const expertTalkRunParamsSchema = z.object({
  session_id: z.string().min(1),
  run_id: z.string().min(1),
});

export const expertTalkSessionParamsSchema = z.object({
  session_id: z.string().min(1),
});

export type ExpertTalkStatusWire = z.infer<typeof expertTalkStatusSchema>;
export type ExpertTalkRunWire = z.infer<typeof expertTalkRunSchema>;
