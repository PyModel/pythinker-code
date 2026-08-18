import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class AgentDynamicWorkflowExclusiveDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'agent-dynamic-workflow-exclusive-deny';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    const toolCalls = context.toolCalls;
    const agentDynamicWorkflowCount = toolCalls.filter(
      (toolCall) => toolCall.name === 'AgentDynamicWorkflow',
    ).length;

    if (agentDynamicWorkflowCount === 0) return;
    if (agentDynamicWorkflowCount === 1 && toolCalls.length === 1) return;

    return {
      kind: 'deny',
      message:
        agentDynamicWorkflowCount > 1
          ? multipleAgentDynamicWorkflowDeniedMessage(toolCalls.length > agentDynamicWorkflowCount)
          : mixedAgentDynamicWorkflowDeniedMessage(),
      reason: {
        agent_dynamic_workflow_tool_calls: agentDynamicWorkflowCount,
        tool_calls: toolCalls.length,
      },
    };
  }
}

function multipleAgentDynamicWorkflowDeniedMessage(hasOtherToolCalls: boolean): string {
  const suffix = hasOtherToolCalls
    ? ' AgentDynamicWorkflow also must not be combined with other tools in the same response.'
    : '';
  return (
    'AgentDynamicWorkflow must be called one dynamic_workflow at a time. Multiple AgentDynamicWorkflow calls are not forbidden, ' +
    'but issue them sequentially: call one AgentDynamicWorkflow, wait for its result, then call the next; ' +
    `or merge the work into a single AgentDynamicWorkflow when one dynamic_workflow can cover it.${suffix}`
  );
}

function mixedAgentDynamicWorkflowDeniedMessage(): string {
  return (
    'AgentDynamicWorkflow must be the only tool call in a model response. Retry with a single AgentDynamicWorkflow ' +
    'call by itself, then call any other tools after it returns.'
  );
}
