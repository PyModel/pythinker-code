import type {
  ApprovalRequest,
  ApprovalResponse,
  QuestionRequest,
  QuestionResult,
} from '#/interaction';

export type { PythinkerErrorPayload } from '#/errors';

export type { Event, ToolResultEvent } from '@pymodel/agent-core-v2/events';

export { MCP_OAUTH_AUTHORIZATION_URL_TOOL_UPDATE } from '@pymodel/agent-core-v2/tool/toolContract';

export type { AgentStatusUpdatedEvent } from '@pymodel/agent-core-v2/agent/usage/usageEvents';
export type { SessionMetaUpdatedEvent } from '@pymodel/agent-core-v2/session/sessionMetadata/sessionMetaEvents';
export type { GoalUpdatedEvent } from '@pymodel/agent-core-v2/features/goal/goalOps';
export type { SkillActivatedEvent } from '@pymodel/agent-core-v2/features/skill/skillOps';
export type { PluginCommandActivatedEvent } from '@pymodel/agent-core-v2/agent/pluginCommand/pluginCommand';
export type { ErrorEvent, WarningEvent } from '@pymodel/agent-core-v2/errors';
export type { UsageStatus } from '@pymodel/agent-core-v2/agent/usage/usage';

export type {
  TurnStartedEvent,
  TurnStepStartedEvent,
  TurnStepCompletedEvent,
  TurnStepRetryingEvent,
  TurnStepInterruptedEvent,
  TurnEndReason,
} from '@pymodel/agent-core-v2/agent/loop/turnEvents';
export type { TurnEndedEvent } from '@pymodel/agent-core-v2/agent/loop/turnOps';

export type {
  AssistantDeltaEvent,
  ThinkingDeltaEvent,
} from '@pymodel/agent-core-v2/agent/loop/turnEvents';

export type { HookResultEvent } from '@pymodel/agent-core-v2/features/externalHooks/agent/agentExternalHooksService';

export type {
  ToolCallStartedEvent,
  ToolCallDeltaEvent,
  ToolProgressEvent,
} from '@pymodel/agent-core-v2/agent/toolExecutor/toolExecutorEvents';

export type { ToolUpdate } from '@pymodel/agent-core-v2/tool/toolContract';
export type { McpOAuthAuthorizationUrlUpdateData } from '@pymodel/agent-core-v2/agent/mcp/tools/auth';

export type { ToolCallRequest, ToolCallResponse } from '#/interaction';

export type {
  ToolListUpdatedEvent,
  McpServerStatusEvent,
} from '@pymodel/agent-core-v2/agent/toolExecutor/toolExecutorEvents';
export type {
  ToolListUpdatedReason,
  McpServerStatusPayload,
} from '@pymodel/agent-core-v2/agent/mcp/mcpEvents';

export type { ApprovalRequest, ApprovalScope } from '#/interaction';
export type { ApprovalDecision, ApprovalResponse } from '#/interaction';

export type { ToolInputDisplay } from '@pymodel/agent-core-v2/tool/toolInputDisplay';

export type {
  QuestionRequest,
  QuestionItem,
  QuestionOption,
  QuestionAnswerMethod,
  QuestionAnswers,
  QuestionResponse,
  QuestionResult,
} from '#/interaction';

export type {
  SubagentSpawnedEvent,
  SubagentStartedEvent,
  SubagentCompletedEvent,
  SubagentFailedEvent,
} from '@pymodel/agent-core-v2/session/subagent/mirrorAgentRun';
export type { SubagentSuspendedEvent } from '@pymodel/agent-core-v2/features/dynamic_workflow/session/sessionDynamicWorkflowService';

export type {
  CompactionStartedEvent,
  CompactionBlockedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
} from '@pymodel/agent-core-v2/agent/fullCompaction/compactionOps';
export type { CompactionResult } from '@pymodel/agent-core-v2/agent/fullCompaction/types';

export type {
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@pymodel/agent-core-v2/agent/task/types';

export type { CronFiredEvent } from '@pymodel/agent-core-v2/features/cron/cronOps';

export type MaybePromise<T> = T | Promise<T>;

export type ApprovalHandler = (request: ApprovalRequest) => MaybePromise<ApprovalResponse>;

export type QuestionHandler = (request: QuestionRequest) => MaybePromise<QuestionResult>;
