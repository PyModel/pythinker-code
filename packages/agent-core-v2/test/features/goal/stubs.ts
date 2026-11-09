import type { IAgentGoalService } from '#/features/goal/goalService';
import type { GoalStatus } from '#/features/goal/types';
import type { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';

export function stubAgentDynamicWorkflow(): IAgentDynamicWorkflowService {
  return {
    _serviceBrand: undefined,
    isActive: false,
    enter: () => undefined,
    exit: () => undefined,
  };
}

export function stubGoal(status?: GoalStatus): IAgentGoalService {
  return {
    getGoal: () => ({ goal: status === undefined ? null : { status } }),
  } as unknown as IAgentGoalService;
}
