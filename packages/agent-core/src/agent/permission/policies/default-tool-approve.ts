import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'LSP',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskCreate',
  'TaskGet',
  'TaskUpdate',
  'TaskOutput',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
  'CronList',
  'WebSearch',
  'Agent',
  'AskUserQuestion',
  'Skill',
  'StructuredOutput',
  // Goal control tools have no side effects on the world: GetGoal reads, and
  // mutation tools only record the goal's own runtime state.
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
]);

export class DefaultToolApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (
      context.toolCall.name === 'Config' &&
      typeof context.args === 'object' &&
      context.args !== null &&
      (context.args as Record<string, unknown>)['value'] === undefined
    ) {
      return { kind: 'approve' };
    }
    if (!DEFAULT_APPROVE_TOOLS.has(context.toolCall.name)) return;
    return {
      kind: 'approve',
    };
  }
}
