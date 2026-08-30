import { z } from 'zod';

import { noResult } from '../helpers.js';
import type { ServiceContract } from '../types.js';

const roleSchema = z.enum(['fusion_lead', 'peer']);
const failureReasonSchema = z.enum([
  'TOOL_NOT_ALLOWED',
  'TOOL_RESULT_BUDGET_EXCEEDED',
  'STAGE_REQUEST_BUDGET_EXCEEDED',
  'STAGE_TIMEOUT',
  'OPENING_FAILED',
  'REVIEW_FAILED',
  'FUSION_FAILED',
  'FUSION_RESULT_INVALID',
  'CANCELLED',
  'INTERRUPTED',
]);
const capabilitySchema = z.object({
  image_in: z.boolean(),
  video_in: z.boolean(),
  audio_in: z.boolean(),
  thinking: z.boolean(),
  tool_use: z.boolean(),
  max_context_tokens: z.number(),
  max_input_tokens: z.number().optional(),
  dynamically_loaded_tools: z.boolean().optional(),
});
const tokenUsageSchema = z.object({
  inputOther: z.number(),
  output: z.number(),
  inputCacheRead: z.number(),
  inputCacheCreation: z.number(),
});
const contentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('think'), think: z.string(), encrypted: z.string().optional() }),
  z.object({
    type: z.literal('image_url'),
    imageUrl: z.object({ url: z.string(), id: z.string().optional() }),
  }),
  z.object({
    type: z.literal('audio_url'),
    audioUrl: z.object({ url: z.string(), id: z.string().optional() }),
  }),
  z.object({
    type: z.literal('video_url'),
    videoUrl: z.object({ url: z.string(), id: z.string().optional() }),
  }),
]);

export const expertTalkPairSchema = z.object({
  fusionLeadModelId: z.string().min(1),
  peerModelId: z.string().min(1),
});

export const expertTalkConfigSchema = z.object({
  version: z.literal('expert_talk/v1'),
  resourceVersion: z.string().min(1),
  pair: expertTalkPairSchema.optional(),
});

export const expertTalkArmSchema = z.object({
  armId: z.string().min(1),
  armedAt: z.string().min(1),
});

export const expertTalkBindingSchema = z.object({
  role: roleSchema,
  requestedModelId: z.string().min(1),
  effectiveModelId: z.string().min(1),
  protocol: z.enum(['anthropic', 'openai', 'openai_responses', 'google-genai']),
  provider: z.string().min(1),
  wireModel: z.string().min(1),
  targetFingerprint: z.string().min(1),
  capabilities: capabilitySchema,
  maxContextSize: z.number().positive(),
  maxInputSize: z.number().positive().optional(),
  maxOutputSize: z.number().positive().optional(),
  routingEnvironmentRevision: z.string().min(1),
  routeDecisionFingerprint: z.string().min(1),
});

export const expertTalkArtifactSchema = z.object({
  status: z.enum(['completed', 'failed', 'unavailable']),
  text: z.string().optional(),
  error: z.string().optional(),
  errorReason: failureReasonSchema.optional(),
  digest: z.string().optional(),
  partial: z.boolean().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  usage: tokenUsageSchema.optional(),
  requestCount: z.number().optional(),
  providerAttemptCount: z.number().optional(),
  toolCallCount: z.number().optional(),
  toolResultTokens: z.number().optional(),
});

const expertTalkStageProgressSchema = z.object({
  text: z.string().optional(),
  thinking: z.string().optional(),
  tools: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
  })),
  startedAt: z.string().min(1),
});

export const expertTalkResultSchema = z.object({
  version: z.literal('expert_talk_result/v1'),
  answer: z.string().min(1),
  notes: z.object({
    consensus: z.array(z.string()),
    divergence: z.array(z.string()),
    uncertainty: z.array(z.string()),
    attribution: z.array(z.object({
      role: roleSchema,
      stage: z.enum(['opening', 'review']),
      claim: z.string(),
    })),
  }),
});

const expertTalkRunErrorSchema = z.object({
  reason: failureReasonSchema,
  message: z.string().min(1),
  stage: z.enum(['opening', 'review', 'fusion', 'terminal']),
  role: roleSchema.optional(),
  retryable: z.boolean(),
  action: z.string().min(1),
});

export const expertTalkRunSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal('expert_talk/v1'),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.number(),
  promptId: z.string().min(1),
  status: z.enum([
    'PREPARING',
    'OPENING',
    'OPINIONS_READY',
    'REVIEWING',
    'REVIEW_READY',
    'FUSING',
    'COMPLETED',
    'CANCELLED',
    'FAILED_OPENING',
    'FAILED_REVIEW',
    'FAILED_FUSION',
    'INTERRUPTED',
  ]),
  prompt: z.string(),
  modalities: z.array(z.enum(['image', 'audio', 'video'])),
  createdAt: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  retryOf: z.string().optional(),
  bindings: z.tuple([expertTalkBindingSchema, expertTalkBindingSchema]),
  artifacts: z.object({
    leadOpening: expertTalkArtifactSchema.optional(),
    peerOpening: expertTalkArtifactSchema.optional(),
    leadReview: expertTalkArtifactSchema.optional(),
    fusion: expertTalkArtifactSchema.optional(),
  }),
  progress: z.object({
    revision: z.number().int().nonnegative(),
    leadOpening: expertTalkStageProgressSchema.optional(),
    peerOpening: expertTalkStageProgressSchema.optional(),
    leadReview: expertTalkStageProgressSchema.optional(),
    fusion: expertTalkStageProgressSchema.optional(),
  }).optional(),
  result: expertTalkResultSchema.optional(),
  error: expertTalkRunErrorSchema.optional(),
  orphanedParticipantIds: z.array(z.string().min(1)).optional(),
  revision: z.number(),
});

export const expertTalkStatusSchema = z.object({
  version: z.literal('expert_talk/v1'),
  enabled: z.boolean(),
  featureSource: z.enum(['master-env', 'env', 'config', 'default']),
  config: expertTalkConfigSchema,
  pairValidation: z.object({
    state: z.enum(['valid', 'stale', 'ineligible', 'collapsed', 'unknown']),
    reason: z.string().optional(),
  }),
  arm: expertTalkArmSchema.optional(),
  activeRun: expertTalkRunSchema.optional(),
  latestRun: expertTalkRunSchema.optional(),
});

export const expertTalkStartInputSchema = z.object({
  armId: z.string(),
  clientId: z.string(),
  prompt: z.string(),
  promptId: z.string().optional(),
  modalities: z.array(z.enum(['image', 'audio', 'video'])).optional(),
  content: z.array(contentPartSchema).optional(),
});

export const expertTalkStartResultSchema = z.object({
  runId: z.string(),
  promptId: z.string(),
  status: expertTalkRunSchema.shape.status,
  createdAt: z.string(),
});

export const expertTalkChangedEventSchema = z.object({ status: expertTalkStatusSchema });

export const sessionExpertTalkContract = {
  status: { input: z.tuple([]), output: expertTalkStatusSchema },
  configure: {
    input: z.tuple([expertTalkPairSchema, z.string().optional()]),
    output: expertTalkConfigSchema,
  },
  clear: { input: z.tuple([z.string().optional()]), output: expertTalkConfigSchema },
  arm: {
    input: z.tuple([z.string(), z.string().optional()]),
    output: expertTalkArmSchema,
  },
  disarm: { input: z.tuple([z.string(), z.string().optional()]), output: noResult },
  start: { input: z.tuple([expertTalkStartInputSchema]), output: expertTalkStartResultSchema },
  listRuns: { input: z.tuple([]), output: z.array(expertTalkRunSchema) },
  getRun: { input: z.tuple([z.string()]), output: expertTalkRunSchema },
  cancel: { input: z.tuple([z.string()]), output: expertTalkRunSchema },
  review: { input: z.tuple([z.string()]), output: expertTalkRunSchema },
  finish: { input: z.tuple([z.string()]), output: expertTalkRunSchema },
  fuse: { input: z.tuple([z.string()]), output: expertTalkRunSchema },
  retry: { input: z.tuple([z.string()]), output: expertTalkStartResultSchema },
} satisfies ServiceContract;
