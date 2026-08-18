import type { TokenUsage } from '#/kosong/contract/usage';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

type SessionDynamicWorkflowTaskBase<T> = {
  readonly data: T;
  readonly profileName: string;
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly prompt: string;
  readonly description: string;
  readonly dynamicWorkflowIndex?: number;
  readonly dynamic_workflowItem?: string;
  readonly runInBackground: boolean;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
};

export type SessionDynamicWorkflowSpawnTask<T = unknown> = SessionDynamicWorkflowTaskBase<T> & {
  readonly kind: 'spawn';
  readonly resumeAgentId?: undefined;
  readonly binding?: { readonly model: string; readonly thinking?: string };
};

export type SessionDynamicWorkflowResumeTask<T = unknown> = SessionDynamicWorkflowTaskBase<T> & {
  readonly kind: 'resume';
  readonly resumeAgentId: string;
};

export type SessionDynamicWorkflowTask<T = unknown> = SessionDynamicWorkflowSpawnTask<T> | SessionDynamicWorkflowResumeTask<T>;

export interface SessionDynamicWorkflowRunArgs<T = unknown> {
  readonly callerAgentId: string;
  readonly tasks: readonly SessionDynamicWorkflowTask<T>[];
}

export interface SessionDynamicWorkflowRunResult<T = unknown> {
  readonly task: SessionDynamicWorkflowTask<T>;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly usage?: TokenUsage;
  readonly error?: string;
}

export interface ISessionDynamicWorkflowService {
  readonly _serviceBrand: undefined;

  getDynamicWorkflowItem(args: {
    readonly callerAgentId: string;
    readonly agentId: string;
  }): Promise<string | undefined>;
  run<T>(args: SessionDynamicWorkflowRunArgs<T>): Promise<readonly SessionDynamicWorkflowRunResult<T>[]>;
  cancel(args: { readonly callerAgentId: string }): void;
}

export const ISessionDynamicWorkflowService: ServiceIdentifier<ISessionDynamicWorkflowService> =
  createDecorator<ISessionDynamicWorkflowService>('sessionDynamicWorkflowService');
