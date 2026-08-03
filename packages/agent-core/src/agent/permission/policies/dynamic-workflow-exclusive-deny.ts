import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class DynamicWorkflowExclusiveDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'dynamic-workflow-exclusive-deny';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    const toolCalls = context.toolCalls;
    const dynamicWorkflowCount = toolCalls.filter(
      (toolCall) => toolCall.name === 'DynamicWorkflow',
    ).length;

    if (dynamicWorkflowCount === 0) return;
    if (dynamicWorkflowCount === 1 && toolCalls.length === 1) return;

    return {
      kind: 'deny',
      message:
        dynamicWorkflowCount > 1
          ? multipleDynamicWorkflowDeniedMessage(toolCalls.length > dynamicWorkflowCount)
          : mixedDynamicWorkflowDeniedMessage(),
      reason: {
        dynamic_workflow_tool_calls: dynamicWorkflowCount,
        tool_calls: toolCalls.length,
      },
    };
  }
}

function multipleDynamicWorkflowDeniedMessage(hasOtherToolCalls: boolean): string {
  const suffix = hasOtherToolCalls
    ? ' DynamicWorkflow also must not be combined with other tools in the same response.'
    : '';
  return (
    'DynamicWorkflow must be called one workflow at a time. Multiple DynamicWorkflow calls are not forbidden, ' +
    'but issue them sequentially: call one DynamicWorkflow, wait for its result, then call the next; ' +
    `or merge the work into a single DynamicWorkflow when one workflow can cover it.${suffix}`
  );
}

function mixedDynamicWorkflowDeniedMessage(): string {
  return (
    'DynamicWorkflow must be the only tool call in a model response. Retry with a single DynamicWorkflow ' +
    'call by itself, then call any other tools after it returns.'
  );
}
