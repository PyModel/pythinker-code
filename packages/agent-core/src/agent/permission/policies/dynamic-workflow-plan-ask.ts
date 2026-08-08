import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { SessionApprovalHistoryPermissionPolicy } from './session-approval-history';
import { UserConfiguredAllowPermissionPolicy } from './user-configured-rules';

/**
 * Keeps the Dynamic Workflow plan preview reachable in auto mode.
 *
 * Auto approves every tool call, which included the `DynamicWorkflow` call
 * itself — so the plan preview, the one consent gate before a fan-out of up to
 * 128 subagents, never rendered. The start prompt makes that the easy path: its
 * default option is "Switch to Auto and start", so pressing Enter both enabled
 * auto and silently gave up seeing the plan.
 *
 * Auto still governs everything the subagents then do. It no longer waives
 * seeing what is about to be launched.
 *
 * An explicit grant still wins, so the ask happens once per distinct plan
 * rather than on every call: a session approval recorded against this exact
 * plan, or a user-configured allow rule, falls through to the auto approval
 * below. YOLO is deliberately untouched — it is chosen explicitly and its own
 * label promises that everything is approved automatically.
 */
export class DynamicWorkflowPlanAskPermissionPolicy implements PermissionPolicy {
  readonly name = 'dynamic-workflow-plan-ask';

  private readonly sessionApprovals: SessionApprovalHistoryPermissionPolicy;
  private readonly userAllows: UserConfiguredAllowPermissionPolicy;

  constructor(private readonly agent: Agent) {
    // Composed rather than reimplemented: "approve for this session" and the
    // configured allow rules must mean the same thing here as they do below.
    this.sessionApprovals = new SessionApprovalHistoryPermissionPolicy(agent);
    this.userAllows = new UserConfiguredAllowPermissionPolicy(agent);
  }

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (this.agent.permission.mode !== 'auto') return;
    if (context.toolCall.name !== 'DynamicWorkflow') return;
    if (this.sessionApprovals.evaluate(context) !== undefined) return;
    if (this.userAllows.evaluate(context) !== undefined) return;
    return { kind: 'ask' };
  }
}
