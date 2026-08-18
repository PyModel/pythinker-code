import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class DynamicWorkflowModeAgentDynamicWorkflowApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'dynamic-workflow-mode-agent-dynamic-workflow-approve';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (context.toolCall.name !== 'AgentDynamicWorkflow') return;
    if (!this.agent.dynamicWorkflowMode.isActive) return;
    return {
      kind: 'approve',
    };
  }
}
