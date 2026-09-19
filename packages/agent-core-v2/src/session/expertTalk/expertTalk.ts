import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export const EXPERT_TALK_VERSION = 'expert_talk/v1' as const;

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
  readonly resourceVersion: string;
}

export interface ExpertTalkStatusV1 {
  readonly config: ExpertTalkConfigV1;
  readonly enabled?: boolean;
  readonly armId?: string;
  readonly arm?: ExpertTalkArmV1;
  readonly runId?: string;
  readonly runStatus?: ExpertTalkRunStatus;
  readonly activeRun?: ExpertTalkRunV1;
  readonly latestRun?: ExpertTalkRunV1;
}

export interface ExpertTalkStartResult {
  readonly runId: string;
}

export interface ExpertTalkRunV1 {
  readonly runId: string;
  readonly status: ExpertTalkRunStatus;
  readonly armId: string;
  readonly error?: string;
}

export interface ExpertTalkRunPageV1 {
  readonly items: readonly ExpertTalkRunV1[];
  readonly nextCursor?: string;
}

export interface ExpertTalkListRunsOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ExpertTalkBindingV1 {
  readonly armId: string;
  readonly pair: ExpertTalkPairV1;
}

export interface ExpertTalkStageArtifactV1 {
  readonly stage: string;
  readonly content: string;
}

export interface ISessionExpertTalkService {
  readonly _serviceBrand: undefined;
  getStatus(): Promise<ExpertTalkStatusV1>;
  configure(pair: ExpertTalkPairV1, expectedVersion?: string): Promise<ExpertTalkConfigV1>;
  clear(expectedVersion?: string): Promise<ExpertTalkConfigV1>;
  arm(expectedVersion?: string): Promise<ExpertTalkArmV1>;
  disarm(armId: string): Promise<void>;
  start(input: {
    readonly armId: string;
    readonly prompt: string;
    readonly content?: readonly unknown[];
  }): Promise<ExpertTalkStartResult>;
  listRuns(options?: ExpertTalkListRunsOptions): Promise<ExpertTalkRunPageV1>;
  cancel(runId: string): Promise<void>;
  retry(runId: string): Promise<ExpertTalkStartResult>;
}

export const ISessionExpertTalkService: ServiceIdentifier<ISessionExpertTalkService> =
  createDecorator<ISessionExpertTalkService>('sessionExpertTalkService');
