import type { Agent } from '../..';
import type { PermissionPolicy } from '../types';
import { DynamicWorkflowExclusiveDenyPermissionPolicy } from './dynamic-workflow-exclusive-deny';
import { DynamicWorkflowPlanAskPermissionPolicy } from './dynamic-workflow-plan-ask';
import { AutoModeApprovePermissionPolicy } from './auto-mode-approve';
import { AutoModeAskUserQuestionDenyPermissionPolicy } from './auto-mode-ask-user-question-deny';
import { DefaultToolApprovePermissionPolicy } from './default-tool-approve';
import { ExitPlanModeReviewAskPermissionPolicy } from './exit-plan-mode-review-ask';
import { FallbackAskPermissionPolicy } from './fallback-ask';
import {
  GitControlPathAccessAskPermissionPolicy,
  SensitiveFileAccessAskPermissionPolicy,
} from './file-access-ask';
import { GitCwdWriteApprovePermissionPolicy } from './git-cwd-write-approve';
import { PlanModeGuardDenyPermissionPolicy } from './plan-mode-guard-deny';
import { PlanModeToolApprovePermissionPolicy } from './plan-mode-tool-approve';
import { PreToolCallHookPermissionPolicy } from './pre-tool-call-hook';
import { SessionApprovalHistoryPermissionPolicy } from './session-approval-history';
import {
  UserConfiguredAllowPermissionPolicy,
  UserConfiguredAskPermissionPolicy,
  UserConfiguredDenyPermissionPolicy,
} from './user-configured-rules';
import { YoloModeApprovePermissionPolicy } from './yolo-mode-approve';

/** Permission policies run in order; the first non-undefined result wins. */
export function createPermissionDecisionPolicies(agent: Agent): PermissionPolicy[] {
  return [
    // PreToolUse hook returned a block → deny.
    new PreToolCallHookPermissionPolicy(agent),
    // DynamicWorkflow is batch-exclusive and must run alone, regardless of permission mode.
    new DynamicWorkflowExclusiveDenyPermissionPolicy(),
    // auto mode + AskUserQuestion → deny.
    new AutoModeAskUserQuestionDenyPermissionPolicy(agent),
    // plan mode: Write/Edit outside the plan file, or TaskStop → deny.
    new PlanModeGuardDenyPermissionPolicy(agent),
    // User-configured deny rule matches → deny.
    new UserConfiguredDenyPermissionPolicy(agent),
    // auto mode + DynamicWorkflow → ask, so the plan preview still renders.
    // Must sit above the auto approval below, which would otherwise swallow it.
    new DynamicWorkflowPlanAskPermissionPolicy(agent),
    // auto mode → approve (any auto-mode block must be a deny rule above this).
    new AutoModeApprovePermissionPolicy(agent),
    // Approve-for-session memorized rule matches → approve. Runs before user-configured ask rules so an in-session grant beats a still-matching ask rule on later calls.
    new SessionApprovalHistoryPermissionPolicy(agent),
    // User-configured ask rule matches → ask.
    new UserConfiguredAskPermissionPolicy(agent),
    // User-configured allow rule matches → approve.
    new UserConfiguredAllowPermissionPolicy(agent),
    // ExitPlanMode with active plan_review + non-empty plan + non-auto → ask (tracks plan_submitted/plan_resolved itself). Runs before session history so a stale session approval can't bypass review of a new plan body.
    new ExitPlanModeReviewAskPermissionPolicy(agent),
    // EnterPlanMode, Write/Edit on the plan file, or ExitPlanMode with no actionable plan_review → approve.
    new PlanModeToolApprovePermissionPolicy(agent),
    // Access touches a sensitive file (.env, SSH key, credentials) → ask.
    new SensitiveFileAccessAskPermissionPolicy(),
    // Access touches .git or a git control-dir path → ask.
    new GitControlPathAccessAskPermissionPolicy(agent),
    // yolo mode → approve.
    new YoloModeApprovePermissionPolicy(agent),
    // No Dynamic Workflow policy sits here. Dynamic Workflow mode used to
    // approve every DynamicWorkflow call outright, which only ever fired in
    // manual mode (auto approves above, yolo just above) and so made the plan
    // preview unreachable for the one mode that asks for it. A DynamicWorkflow
    // call in manual mode now falls through to the ask below and renders its
    // plan; `session-approval-history` remembers the answer per description.
    // Tool is in the default-approve list (read-only / UI helpers) → approve.
    new DefaultToolApprovePermissionPolicy(),
    // Write/Edit on POSIX paths inside cwd inside a git work tree → approve.
    new GitCwdWriteApprovePermissionPolicy(agent),
    // Nothing matched → ask.
    new FallbackAskPermissionPolicy(),
  ];
}
