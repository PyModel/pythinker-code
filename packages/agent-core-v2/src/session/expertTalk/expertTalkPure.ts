import { createHash } from 'node:crypto';

import { Error2, ErrorCodes } from '#/errors';
import type { Model } from '#/kosong/model/catalog';

import {
  EXPERT_TALK_RESULT_VERSION,
  type ExpertTalkBindingV1,
  type ExpertTalkPairV1,
  type ExpertTalkResultV1,
  type ExpertTalkRole,
} from './expertTalk';

export const EXPERT_TALK_OPENING_OUTPUT_TOKENS = 4_096;
export const EXPERT_TALK_REVIEW_OUTPUT_TOKENS = 3_072;
export const EXPERT_TALK_FUSION_OUTPUT_TOKENS = 4_096;

export function resourceVersion(pair: ExpertTalkPairV1 | undefined, armId?: string): string {
  return sha256(JSON.stringify({ pair: pair ?? null, armId: armId ?? null }));
}

export function canonicalModelId(model: Model): string {
  return model.id;
}

export function bindingFor(
  role: ExpertTalkRole,
  requestedModelId: string,
  model: Model,
  routing?: {
    readonly environmentRevision: string;
    readonly decisionFingerprint: string;
  },
): ExpertTalkBindingV1 {
  const modelRevision = sha256(
    JSON.stringify({
      id: model.id,
      protocol: model.protocol,
      provider: model.providerName,
      baseUrl: model.baseUrl ?? null,
      name: model.name,
      capabilities: model.capabilities,
      maxContextSize: model.maxContextSize,
      maxInputSize: model.maxInputSize ?? null,
      maxOutputSize: model.maxOutputSize ?? null,
    }),
  );
  const targetFingerprint = sha256(
    JSON.stringify({
      protocol: model.protocol,
      provider: model.providerName,
      baseUrl: model.baseUrl ?? null,
      name: model.name,
    }),
  );
  return {
    role,
    requestedModelId,
    effectiveModelId: model.id,
    protocol: model.protocol,
    provider: model.providerName,
    wireModel: model.name,
    targetFingerprint,
    capabilities: { ...model.capabilities },
    maxContextSize: model.maxContextSize,
    maxInputSize: model.maxInputSize,
    maxOutputSize: model.maxOutputSize,
    routingEnvironmentRevision: routing?.environmentRevision ?? modelRevision,
    routeDecisionFingerprint:
      routing?.decisionFingerprint ?? sha256(`${requestedModelId}\u0000${modelRevision}`),
  };
}

export function assertEligibleBinding(
  binding: ExpertTalkBindingV1,
  modalities: readonly ('image' | 'audio' | 'video')[],
): void {
  const capability = binding.capabilities;
  if (!capability.tool_use || capability.max_context_tokens <= 0) {
    throw new Error2(
      ErrorCodes.EXPERT_TALK_PAIR_INVALID,
      `Model "${binding.requestedModelId}" does not support the complete Discussion protocol`,
      { details: { modelId: binding.requestedModelId } },
    );
  }
  for (const modality of modalities) {
    const supported =
      modality === 'image'
        ? capability.image_in
        : modality === 'audio'
          ? capability.audio_in
          : capability.video_in;
    if (!supported) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_PAIR_INVALID,
        `Model "${binding.requestedModelId}" does not support ${modality} input`,
        { details: { modelId: binding.requestedModelId, modality } },
      );
    }
  }
}

export function assertDistinctBindings(
  lead: ExpertTalkBindingV1,
  peer: ExpertTalkBindingV1,
): void {
  if (
    lead.effectiveModelId === peer.effectiveModelId ||
    lead.targetFingerprint === peer.targetFingerprint
  ) {
    throw new Error2(
      ErrorCodes.EXPERT_TALK_PAIR_COLLAPSED,
      'The configured Discussion pair resolves to one effective model target',
      {
        details: {
          leadModelId: lead.effectiveModelId,
          peerModelId: peer.effectiveModelId,
        },
      },
    );
  }
}

export function estimateAdmissionTokens(text: string, additionalTokens = 0): number {
  const estimate = Math.ceil(Buffer.byteLength(text, 'utf8') / 4) + additionalTokens;
  return admissionTokens(estimate);
}

export function admissionTokens(estimate: number): number {
  return Math.ceil(estimate * 1.25) + 512;
}

export function assertContextAdmission(
  lead: ExpertTalkBindingV1,
  peer: ExpertTalkBindingV1,
  baseInputTokens: number,
): void {
  const reviewInput = baseInputTokens + EXPERT_TALK_OPENING_OUTPUT_TOKENS * 2;
  const fusionInput =
    baseInputTokens +
    EXPERT_TALK_OPENING_OUTPUT_TOKENS * 2 +
    EXPERT_TALK_REVIEW_OUTPUT_TOKENS;
  assertStageContext(lead, reviewInput, EXPERT_TALK_REVIEW_OUTPUT_TOKENS, 'Architect review');
  assertStageContext(lead, fusionInput, EXPERT_TALK_FUSION_OUTPUT_TOKENS, 'fusion');
}

export function assertStageContext(
  binding: ExpertTalkBindingV1,
  requiredInputTokens: number,
  outputTokens: number,
  stage: string,
): void {
  assertStageFits(binding, requiredInputTokens, outputTokens, stage);
}

export function parseFusionResult(text: string): ExpertTalkResultV1 {
  const answer = text.trim();
  if (answer.length === 0) throw new TypeError('Fusion returned an empty Markdown answer');
  return {
    version: EXPERT_TALK_RESULT_VERSION,
    answer,
    notes: { consensus: [], divergence: [], uncertainty: [], attribution: [] },
  };
}

function assertStageFits(
  binding: ExpertTalkBindingV1,
  requiredInputTokens: number,
  outputTokens: number,
  stage: string,
): void {
  const maxContext = Math.min(
    binding.maxContextSize,
    binding.capabilities.max_context_tokens,
  );
  const maxInput = Math.min(
    binding.maxInputSize ?? Number.POSITIVE_INFINITY,
    binding.capabilities.max_input_tokens ?? Number.POSITIVE_INFINITY,
    maxContext - outputTokens,
  );
  if (maxInput >= requiredInputTokens) return;
  throw new Error2(
    ErrorCodes.EXPERT_TALK_CONTEXT_INSUFFICIENT,
    `Model "${binding.requestedModelId}" cannot fit the complete ${stage} packet`,
    {
      details: {
        modelId: binding.requestedModelId,
        stage,
        requiredInputTokens,
        maxInputTokens: maxInput,
      },
    },
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
