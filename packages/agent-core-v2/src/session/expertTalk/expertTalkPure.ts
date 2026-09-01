import { createHash } from 'node:crypto';

import { Error2, ErrorCodes } from '#/errors';
import type { Model } from '#/kosong/model/catalog';
import {
  modelSupportsThinking,
  modelSupportsThinkingEffort,
  normalizeRequestedThinkingEffort,
} from '#/kosong/model/thinking';

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
export const EXPERT_TALK_OPENING_MAX_REQUESTS = 4;
export const EXPERT_TALK_REVIEW_MAX_REQUESTS = 1;
export const EXPERT_TALK_FUSION_MAX_REQUESTS = 2;
export const EXPERT_TALK_PROVIDER_ATTEMPTS_PER_REQUEST = 2;
export const EXPERT_TALK_OPENING_TOOL_RESULT_TOKENS = 8_192;
export const EXPERT_TALK_REVIEW_TOOL_RESULT_TOKENS = 4_096;
export const EXPERT_TALK_FUSION_TOOL_RESULT_TOKENS = 4_096;

const EXPERT_TALK_PACKET_OVERHEAD_TOKENS = 4_096;

export function resourceVersion(pair: ExpertTalkPairV1 | undefined, armId?: string): string {
  return sha256(JSON.stringify({ pair: pair ?? null, armId: armId ?? null }));
}

export function canonicalModelId(model: Model): string {
  return model.id;
}

export function canonicalThinkingEffort(
  requested: string | undefined,
  model: Model,
): string | undefined {
  const effort = normalizeRequestedThinkingEffort(requested);
  if (effort === undefined) return undefined;
  const declared = model.supportEfforts
    ?.map((candidate) => candidate.trim().toLowerCase())
    .filter((candidate) => candidate.length > 0) ?? [];
  const supported = effort === 'off'
    ? model.alwaysThinking !== true
    : declared.length > 0
      ? declared.includes(effort)
      : effort === 'on' && modelSupportsThinking(model);
  if (supported && modelSupportsThinkingEffort(effort, model, true)) return effort;
  const options = declared.length > 0
    ? [model.alwaysThinking === true ? undefined : 'off', ...declared].filter(Boolean).join(', ')
    : modelSupportsThinking(model)
      ? model.alwaysThinking === true ? 'on' : 'off, on'
      : 'off';
  throw new Error2(
    ErrorCodes.EXPERT_TALK_PAIR_INVALID,
    `Thinking effort "${requested}" is not supported by model "${model.id}". Supported efforts: ${options}.`,
    { details: { modelId: model.id, effort, supportedEfforts: options } },
  );
}

export function bindingFor(
  role: ExpertTalkRole,
  requestedModelId: string,
  model: Model,
  routing?: {
    readonly environmentRevision?: string;
    readonly decisionFingerprint?: string;
    readonly thinkingEffort?: string;
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
    thinkingEffort: routing?.thinkingEffort,
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
      routing?.decisionFingerprint ?? sha256(
        `${requestedModelId}\u0000${modelRevision}\u0000${routing?.thinkingEffort ?? ''}`,
      ),
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
  const maxOutput = binding.maxOutputSize ?? Number.POSITIVE_INFINITY;
  if (maxOutput < EXPERT_TALK_OPENING_OUTPUT_TOKENS) {
    throw new Error2(
      ErrorCodes.EXPERT_TALK_PAIR_INVALID,
      `Model "${binding.requestedModelId}" cannot produce the required Discussion output`,
      {
        details: {
          modelId: binding.requestedModelId,
          requiredOutputTokens: EXPERT_TALK_OPENING_OUTPUT_TOKENS,
          maxOutputTokens: maxOutput,
        },
      },
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
  return admissionTokens(estimateInputTokens(text, additionalTokens));
}

export function estimateInputTokens(text: string, additionalTokens = 0): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4) + additionalTokens;
}

export function admissionTokens(estimate: number): number {
  return Math.ceil(estimate * 1.25) + 512;
}

export function assertContextAdmission(
  lead: ExpertTalkBindingV1,
  peer: ExpertTalkBindingV1,
  baseInputTokens: number,
): void {
  const openingInput = admissionTokens(
    baseInputTokens + EXPERT_TALK_PACKET_OVERHEAD_TOKENS + EXPERT_TALK_OPENING_TOOL_RESULT_TOKENS,
  );
  const reviewInput = admissionTokens(
    baseInputTokens +
    EXPERT_TALK_PACKET_OVERHEAD_TOKENS +
    EXPERT_TALK_OPENING_TOOL_RESULT_TOKENS +
    EXPERT_TALK_OPENING_OUTPUT_TOKENS * 2 +
    EXPERT_TALK_REVIEW_TOOL_RESULT_TOKENS,
  );
  const fusionInput = admissionTokens(
    baseInputTokens +
    EXPERT_TALK_PACKET_OVERHEAD_TOKENS +
    EXPERT_TALK_OPENING_OUTPUT_TOKENS * 2 +
    EXPERT_TALK_REVIEW_OUTPUT_TOKENS * 2 +
    EXPERT_TALK_FUSION_TOOL_RESULT_TOKENS,
  );
  assertStageContext(lead, openingInput, EXPERT_TALK_OPENING_OUTPUT_TOKENS, 'Fusion Lead opening');
  assertStageContext(peer, openingInput, EXPERT_TALK_OPENING_OUTPUT_TOKENS, 'Peer Expert opening');
  assertStageContext(lead, reviewInput, EXPERT_TALK_REVIEW_OUTPUT_TOKENS, 'Fusion Lead review');
  assertStageContext(peer, reviewInput, EXPERT_TALK_REVIEW_OUTPUT_TOKENS, 'Peer Expert review');
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
  const source = unwrapJsonFence(text.trim());
  if (source.length === 0) throw new TypeError('Fusion returned empty output');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new TypeError('Fusion returned invalid JSON');
  }
  if (!isRecord(parsed)) throw new TypeError('Fusion result must be an object');
  if (parsed['version'] !== EXPERT_TALK_RESULT_VERSION) {
    throw new TypeError(`Fusion result version must be ${EXPERT_TALK_RESULT_VERSION}`);
  }
  const answer = parsed['answer'];
  if (typeof answer !== 'string' || answer.trim().length === 0) {
    throw new TypeError('Fusion result answer must be non-empty');
  }
  const notes = parsed['notes'];
  if (!isRecord(notes)) throw new TypeError('Fusion result notes must be an object');
  const attribution = notes['attribution'];
  if (!Array.isArray(attribution)) {
    throw new TypeError('Fusion result notes.attribution must be an array');
  }
  return {
    version: EXPERT_TALK_RESULT_VERSION,
    answer,
    notes: {
      consensus: stringArray(notes['consensus'], 'consensus'),
      divergence: stringArray(notes['divergence'], 'divergence'),
      uncertainty: stringArray(notes['uncertainty'], 'uncertainty'),
      attribution: attribution.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new TypeError(`Fusion result notes.attribution[${String(index)}] must be an object`);
        }
        const role = entry['role'];
        if (role !== 'fusion_lead' && role !== 'peer') {
          throw new TypeError(`Fusion result notes.attribution[${String(index)}].role is invalid`);
        }
        const stage = entry['stage'];
        if (stage !== 'opening' && stage !== 'review') {
          throw new TypeError(`Fusion result notes.attribution[${String(index)}].stage is invalid`);
        }
        const claim = entry['claim'];
        if (typeof claim !== 'string' || claim.trim().length === 0) {
          throw new TypeError(`Fusion result notes.attribution[${String(index)}].claim is invalid`);
        }
        return { role, stage, claim };
      }),
    },
  };
}

function unwrapJsonFence(value: string): string {
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(value);
  return match?.[1]?.trim() ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`Fusion result notes.${name} must be a string array`);
  }
  return value;
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
