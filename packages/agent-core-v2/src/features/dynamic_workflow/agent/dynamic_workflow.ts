import { createDecorator } from "#/_base/di/instantiation";

export type DynamicWorkflowModeTrigger = 'manual' | 'task' | 'tool';

export interface IAgentDynamicWorkflowService {
  readonly _serviceBrand: undefined;

  readonly isActive: boolean;
  enter(trigger: DynamicWorkflowModeTrigger): void;
  exit(): void;
}

export const IAgentDynamicWorkflowService = createDecorator<IAgentDynamicWorkflowService>('agentDynamicWorkflowService');
