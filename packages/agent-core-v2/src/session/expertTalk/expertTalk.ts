import type { Event } from '#/_base/event';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { ModelCapability } from '#/kosong/contract/capability';
import type { Protocol } from '#/kosong/protocol/protocol';
import type { TokenUsage } from '#/kosong/contract/usage';
import type { ContentPart } from '#/kosong/contract/message';
import type { PromptFileAttachment } from '#/agent/contextMemory/types';

export const EXPERT_TALK_VERSION = 'expert_talk/v1' as const;
export const EXPERT_TALK_RESULT_VERSION = 'expert_talk_result/v1' as const;
export const EXPERT_TALK_SCHEMA_VERSION = 1 as const;

export type ExpertTalkRole = 'fusion_lead' | 'peer';

export type ExpertTalkRunStatus =
  | 'OPENING'
  | 'REVIEWING'
  | 'FUSING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED_OPENING'
  | 'FAILED_REVIEW'
  | 'FAILED_FUSION'
  | 'INTERRUPTED';

export interface ExpertTalkPairV1 {
  readonly fusionLeadModelId: string;
  readonly peerModelId: string;
  readonly fusionLeadThinkingEffort?: string;
  readonly peerThinkingEffort?: string;
}

export interface ExpertTalkConfigV1 {
  readonly version: typeof EXPERT_TALK_VERSION;
  readonly resourceVersion: string;
  readonly pair?: ExpertTalkPairV1;
}

export interface ExpertTalkArmV1 {
  readonly armId: string;
  readonly armedAt: string;
}

export interface ExpertTalkBindingV1 {
  readonly role: ExpertTalkRole;
  readonly requestedModelId: string;
  readonly effectiveModelId: string;
  readonly thinkingEffort?: string;
  readonly protocol: Protocol;
  readonly provider: string;
  readonly wireModel: string;
  readonly targetFingerprint: string;
  readonly capabilities: ModelCapability;
  readonly maxContextSize: number;
  readonly maxInputSize?: number;
  readonly maxOutputSize?: number;
  readonly routingEnvironmentRevision: string;
  readonly routeDecisionFingerprint: string;
}

export interface ExpertTalkStageArtifactV1 {
  readonly status: 'completed' | 'failed' | 'unavailable';
  readonly text?: string;
  readonly error?: string;
  readonly errorReason?: ExpertTalkFailureReason;
  readonly digest?: string;
  readonly tools?: readonly ExpertTalkToolProgressV1[];
  readonly partial?: boolean;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly usage?: TokenUsage;
  readonly requestCount?: number;
  readonly providerAttemptCount?: number;
  readonly toolCallCount?: number;
  readonly toolResultTokens?: number;
}

export interface ExpertTalkToolProgressV1 {
  readonly id: string;
  readonly name?: string;
}

export interface ExpertTalkStageProgressV1 {
  readonly text?: string;
  readonly thinking?: string;
  readonly tools: readonly ExpertTalkToolProgressV1[];
  readonly startedAt: string;
}

export interface ExpertTalkRunProgressV1 {
  readonly revision: number;
  readonly leadOpening?: ExpertTalkStageProgressV1;
  readonly peerOpening?: ExpertTalkStageProgressV1;
  readonly leadReview?: ExpertTalkStageProgressV1;
  readonly peerReview?: ExpertTalkStageProgressV1;
  readonly fusion?: ExpertTalkStageProgressV1;
}

export type ExpertTalkFailureReason =
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_RESULT_BUDGET_EXCEEDED'
  | 'STAGE_REQUEST_BUDGET_EXCEEDED'
  | 'STAGE_TIMEOUT'
  | 'OPENING_FAILED'
  | 'REVIEW_FAILED'
  | 'FUSION_FAILED'
  | 'FUSION_RESULT_INVALID'
  | 'CANCELLED'
  | 'INTERRUPTED';

export interface ExpertTalkRunErrorV1 {
  readonly reason: ExpertTalkFailureReason;
  readonly message: string;
  readonly stage: 'opening' | 'review' | 'fusion' | 'terminal';
  readonly role?: ExpertTalkRole;
  readonly retryable: boolean;
  readonly action: string;
}

export interface ExpertTalkAttributionV1 {
  readonly role: ExpertTalkRole;
  readonly stage: 'opening' | 'review';
  readonly claim: string;
}

export interface ExpertTalkFusionNotesV1 {
  readonly consensus: readonly string[];
  readonly divergence: readonly string[];
  readonly uncertainty: readonly string[];
  readonly attribution: readonly ExpertTalkAttributionV1[];
}

export interface ExpertTalkResultV1 {
  readonly version: typeof EXPERT_TALK_RESULT_VERSION;
  readonly answer: string;
  readonly notes: ExpertTalkFusionNotesV1;
}

export interface ExpertTalkRunArtifactsV1 {
  readonly leadOpening?: ExpertTalkStageArtifactV1;
  readonly peerOpening?: ExpertTalkStageArtifactV1;
  readonly leadReview?: ExpertTalkStageArtifactV1;
  readonly peerReview?: ExpertTalkStageArtifactV1;
  readonly fusion?: ExpertTalkStageArtifactV1;
}

export interface ExpertTalkRunV1 {
  readonly schemaVersion: typeof EXPERT_TALK_SCHEMA_VERSION;
  readonly version: typeof EXPERT_TALK_VERSION;
  readonly runId: string;
  readonly sessionId: string;
  readonly turnId: number;
  readonly promptId: string;
  readonly status: ExpertTalkRunStatus;
  readonly prompt: string;
  readonly modalities: readonly ('image' | 'audio' | 'video')[];
  readonly createdAt: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly retryOf?: string;
  readonly bindings: readonly [ExpertTalkBindingV1, ExpertTalkBindingV1];
  readonly artifacts: ExpertTalkRunArtifactsV1;
  readonly progress?: ExpertTalkRunProgressV1;
  readonly result?: ExpertTalkResultV1;
  readonly error?: ExpertTalkRunErrorV1;
  readonly orphanedParticipantIds?: readonly string[];
  readonly revision: number;
}

export interface ExpertTalkPairValidationV1 {
  readonly state: 'valid' | 'stale' | 'ineligible' | 'collapsed' | 'unknown';
  readonly reason?: string;
}

export interface ExpertTalkStatusV1 {
  readonly version: typeof EXPERT_TALK_VERSION;
  readonly enabled: boolean;
  readonly featureSource: 'master-env' | 'env' | 'config' | 'default';
  readonly config: ExpertTalkConfigV1;
  readonly pairValidation: ExpertTalkPairValidationV1;
  readonly arm?: ExpertTalkArmV1;
  readonly activeRun?: ExpertTalkRunV1;
  readonly latestRun?: ExpertTalkRunV1;
}

export interface ExpertTalkStartInput {
  readonly armId: string;
  readonly clientId: string;
  readonly prompt: string;
  readonly promptId?: string;
  readonly modalities?: readonly ('image' | 'audio' | 'video')[];
  readonly content?: readonly ContentPart[];
  readonly attachments?: readonly PromptFileAttachment[];
}

export interface ExpertTalkStartResult {
  readonly runId: string;
  readonly promptId: string;
  readonly status: ExpertTalkRunStatus;
  readonly createdAt: string;
}

export interface ExpertTalkListRunsOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ExpertTalkRunPageV1 {
  readonly items: readonly ExpertTalkRunV1[];
  readonly nextCursor?: string;
}

export interface ExpertTalkChangedEvent {
  readonly status: ExpertTalkStatusV1;
}

export interface ISessionExpertTalkService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<ExpertTalkChangedEvent>;

  status(): ExpertTalkStatusV1;
  configure(pair: ExpertTalkPairV1, expectedVersion?: string): Promise<ExpertTalkConfigV1>;
  clear(expectedVersion?: string): Promise<ExpertTalkConfigV1>;
  arm(clientId: string, expectedVersion?: string): ExpertTalkArmV1;
  disarm(clientId: string, armId?: string): void;
  start(input: ExpertTalkStartInput): Promise<ExpertTalkStartResult>;
  listRuns(options?: ExpertTalkListRunsOptions): ExpertTalkRunPageV1;
  hasPromptId(promptId: string): boolean;
  getRun(runId: string): ExpertTalkRunV1;
  cancel(runId: string): Promise<ExpertTalkRunV1>;
  retry(runId: string): Promise<ExpertTalkStartResult>;
  prepareControllerActivation(): void;
  releaseClient(clientId: string): void;
}

export const ISessionExpertTalkService: ServiceIdentifier<ISessionExpertTalkService> =
  createDecorator<ISessionExpertTalkService>('sessionExpertTalkService');
