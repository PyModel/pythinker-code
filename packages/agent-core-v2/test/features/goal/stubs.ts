import type { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';

export function stubAgentDynamicWorkflow(): IAgentDynamicWorkflowService {
  return {
    _serviceBrand: undefined,
    isActive: false,
    enter: () => undefined,
    exit: () => undefined,
  };
}
