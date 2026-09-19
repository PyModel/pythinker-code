import type { ContextSpliced } from '@pymodel/agent-core-v2/agent/contextMemory/contextEvents';
import type { HookResult } from '@pymodel/agent-core-v2/features/externalHooks/agent/agentExternalHooksService';
import type {
  CompactionBlocked,
  CompactionCancelled,
  CompactionCompleted,
  CompactionStarted,
} from '@pymodel/agent-core-v2/agent/fullCompaction/compactionOps';
import type { ContextUndone, CronFired, GoalUpdated } from '@pymodel/agent-core-v2';
import type {
  AssistantDelta,
  ThinkingDelta,
  ToolCallDelta,
  TurnStarted,
  TurnStepCompleted,
  TurnStepInterrupted,
  TurnStepRetrying,
  TurnStepStarted,
} from '@pymodel/agent-core-v2/agent/loop/turnEvents';
import type { TurnEnded, TurnSteer } from '@pymodel/agent-core-v2/agent/loop/turnOps';
import type { AgentErrorEvent } from '@pymodel/agent-core-v2/agent/mcp/mcpEvents';
import type { PluginCommandActivated } from '@pymodel/agent-core-v2/agent/pluginCommand/pluginCommand';
import type { WarningIssued } from '@pymodel/agent-core-v2/agent/profile/profileOps';
import type {
  PromptAborted,
  PromptCompleted,
  PromptQueued,
  PromptStarted,
  PromptSteered,
  PromptSubmitted,
} from '@pymodel/agent-core-v2/agent/prompt/promptService';
import type { PromptAccepted } from '@pymodel/agent-core-v2/agent/prompt/promptOps';
import type {
  ShellCompleted,
  ShellOutput,
  ShellStarted,
} from '@pymodel/agent-core-v2/agent/shellCommand/shellCommandService';
import type { SkillActivated } from '@pymodel/agent-core-v2/features/skill/skillOps';
import type {
  TaskNotified,
  TaskStarted,
  TaskTerminatedNotice,
} from '@pymodel/agent-core-v2/agent/task/taskOps';
import type {
  PermissionApprovalRequested,
  PermissionApprovalResolved,
} from '@pymodel/agent-core-v2/agent/toolApproval/toolApprovalService';
import type {
  ToolCallStarted,
  ToolProgress,
  ToolResultEvent,
} from '@pymodel/agent-core-v2/agent/toolExecutor/toolExecutorEvents';
import type { AgentStatusUpdated } from '@pymodel/agent-core-v2/agent/usage/usageEvents';
import type { PlanRevision } from '@pymodel/agent-core-v2/features/plan/planOps';
import type { SubagentSuspended } from '@pymodel/agent-core-v2/features/dynamic_workflow/session/sessionDynamicWorkflowService';
import type {
  SubagentCompleted,
  SubagentFailed,
  SubagentSpawned,
  SubagentStarted,
} from '@pymodel/agent-core-v2/session/subagent/mirrorAgentRun';

export type ProjectionBusEvent =
  | ({ readonly type: 'plan.revision' } & PlanRevision)
  | ({ readonly type: 'turn.started' } & TurnStarted)
  | ({ readonly type: 'turn.ended' } & TurnEnded)
  | ({ readonly type: 'turn.step.started' } & TurnStepStarted)
  | ({ readonly type: 'turn.step.completed' } & TurnStepCompleted)
  | ({ readonly type: 'turn.step.interrupted' } & TurnStepInterrupted)
  | ({ readonly type: 'turn.step.retrying' } & TurnStepRetrying)
  | ({ readonly type: 'assistant.delta' } & AssistantDelta)
  | ({ readonly type: 'thinking.delta' } & ThinkingDelta)
  | ({ readonly type: 'tool.call.delta' } & ToolCallDelta)
  | ({ readonly type: 'tool.progress' } & ToolProgress)
  | ({ readonly type: 'tool.call.started' } & ToolCallStarted)
  | ({ readonly type: 'tool.result' } & ToolResultEvent)
  | ({ readonly type: 'task.started' } & TaskStarted)
  | ({ readonly type: 'task.terminated' } & TaskTerminatedNotice)
  | ({ readonly type: 'task.notified' } & TaskNotified)
  | ({ readonly type: 'shell.started' } & ShellStarted)
  | ({ readonly type: 'shell.output' } & ShellOutput)
  | ({ readonly type: 'shell.completed' } & ShellCompleted)
  | ({ readonly type: 'subagent.spawned' } & SubagentSpawned)
  | ({ readonly type: 'subagent.started' } & SubagentStarted)
  | ({ readonly type: 'subagent.completed' } & SubagentCompleted)
  | ({ readonly type: 'subagent.failed' } & SubagentFailed)
  | ({ readonly type: 'subagent.suspended' } & SubagentSuspended)
  | ({ readonly type: 'goal.updated' } & GoalUpdated)
  | ({ readonly type: 'agent.status.updated' } & AgentStatusUpdated)
  | ({ readonly type: 'prompt.accepted' } & PromptAccepted)
  | ({ readonly type: 'prompt.queued' } & PromptQueued)
  | ({ readonly type: 'prompt.submitted' } & PromptSubmitted)
  | ({ readonly type: 'prompt.started' } & PromptStarted)
  | ({ readonly type: 'prompt.completed' } & PromptCompleted)
  | ({ readonly type: 'prompt.aborted' } & PromptAborted)
  | ({ readonly type: 'prompt.steered' } & PromptSteered)
  | ({ readonly type: 'turn.steer' } & TurnSteer)
  | ({ readonly type: 'hook.result' } & HookResult)
  | ({ readonly type: 'skill.activated' } & SkillActivated)
  | ({ readonly type: 'plugin_command.activated' } & PluginCommandActivated)
  | ({ readonly type: 'cron.fired' } & CronFired)
  | ({ readonly type: 'compaction.started' } & CompactionStarted)
  | ({ readonly type: 'compaction.blocked' } & CompactionBlocked)
  | ({ readonly type: 'compaction.cancelled' } & CompactionCancelled)
  | ({ readonly type: 'compaction.completed' } & CompactionCompleted)
  | ({ readonly type: 'context.spliced' } & ContextSpliced)
  | ({ readonly type: 'context.undone' } & ContextUndone)
  | ({ readonly type: 'permission.approval.requested' } & PermissionApprovalRequested)
  | ({ readonly type: 'permission.approval.resolved' } & PermissionApprovalResolved)
  | ({ readonly type: 'error' } & AgentErrorEvent)
  | ({ readonly type: 'warning' } & WarningIssued);

export const PROJECTION_IGNORED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'mcp.server.status',
  'tool.list.updated',
]);
