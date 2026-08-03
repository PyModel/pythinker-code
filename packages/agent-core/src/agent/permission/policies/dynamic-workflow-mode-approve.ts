import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class DynamicWorkflowModeApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'dynamic-workflow-mode-approve';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (context.toolCall.name !== 'DynamicWorkflow') return;
    if (!this.agent.dynamicWorkflowMode.isActive) return;
    return {
      kind: 'approve',
    };
  }
}
