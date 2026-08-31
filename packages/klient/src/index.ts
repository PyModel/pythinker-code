/**
 * `@pymodel/klient` public surface — the transport-agnostic client facade
 * over the agent-core-v2 engine. Create a klient with one of the transport
 * entry points (`@pymodel/klient/ipc` or `/memory`); everything
 * exported here behaves identically regardless of which one carried the
 * bytes.
 */

export type {
  CallOptions,
  EventSourceRef,
  IDisposable,
  KlientChannel,
  ScopeRef,
} from './core/channel.js';
export { RPCError } from './core/errors.js';
export { KlientValidationError, type ValidationPhase } from './core/validation.js';
export {
  createKlientFromChannel,
  type AgentHandle,
  type Klient,
  type KlientOptions,
  type SessionHandle,
} from './core/klient.js';
export type { KlientEvents } from './core/events/hub.js';
export type { Caller, ScopedCaller, ScopedStreamCaller } from './core/facade/global.js';

export type {
  ConfigTargetLiteral,
  FileDownload,
  GlobalAuthFacade,
  GlobalConfigFacade,
  GlobalFacade,
  GlobalFilesFacade,
  GlobalFlagsFacade,
  GlobalHostFsFacade,
  GlobalKosongFacade,
  GlobalMcpFacade,
  GlobalPluginsFacade,
  GlobalSessionsFacade,
  GlobalWorkspacesFacade,
  KlientEnvInfo,
  ModelCatalogItem,
  ProviderCatalogItem,
  RefreshProviderModelsOptions,
  RefreshProviderModelsResponse,
  SetDefaultModelResponse,
} from './core/facade/global.js';

export type {
  AnonymousProviderInput,
  GenerateEvent,
  GenerateInput,
  GenerateParams,
  ProviderAuth,
  ProviderInput,
} from './core/facade/kosong-types.js';

export type {
  SessionApprovalsFacade,
  SessionFacade,
  SessionInteractionsFacade,
  SessionExpertTalkFacade,
  SessionQuestionsFacade,
  SessionRestoreOptions,
  SessionSkillsFacade,
  SessionStatus,
} from './core/facade/session.js';
export type {
  AgentCommandInfo,
  AgentContextData,
  AgentPromptLaunchResult,
  AgentFacade,
  AgentTaskInfo,
  McpServerEntry,
  PlanData,
  PromptLaunchResult,
  PromptWithSkillsInput,
  PromptWithSkillsResult,
  SetModelResult,
  ShellCommandResult,
  ThinkingLevel,
  UsageStatus,
} from './core/facade/agent.js';

export type {
  CatalogChangedPayload,
  KlientEventName,
  KlientEventPayloads,
  SessionArchivedPayload,
  SessionMetaUpdatedPayload,
} from './contract/global/events.js';
export type { SessionEventPayloads } from './contract/session/events.js';
export type {
  ExpertTalkArmV1,
  ExpertTalkBindingV1,
  ExpertTalkChangedEvent,
  ExpertTalkConfigV1,
  ExpertTalkPairV1,
  ExpertTalkResultV1,
  ExpertTalkRunV1,
  ExpertTalkStartResult,
  ExpertTalkStatusV1,
} from '@pymodel/agent-core-v2/session/expertTalk/expertTalk';
export type { AgentEventPayloads } from './contract/agent/events.js';

// Wire types re-exported for consumer convenience (type-only; the engine is
// not pulled in at runtime for http consumers).
export type {
  SessionListQuery,
  SessionSummary,
} from '@pymodel/agent-core-v2/app/sessionIndex/sessionIndex';
export type { Page } from '@pymodel/agent-core-v2/persistence/interface/queryStore';
export type {
  Workspace,
  WorkspaceUpdate,
} from '@pymodel/agent-core-v2/app/workspace/workspace';
export type {
  ConfigDiagnostic,
  ConfigInspectValue,
} from '@pymodel/agent-core-v2/app/config/config';
export type { ProviderConfig } from '@pymodel/agent-core-v2/kosong/provider/provider';
export type { AuthStatus } from '@pymodel/agent-core-v2/app/auth/auth';
export type { ExperimentalFeatureState } from '@pymodel/agent-core-v2/app/flag/flag';
export type {
  FsBrowseResponse,
  FsHomeResponse,
} from '@pymodel/agent-core-v2/app/hostFolderBrowser/hostFolderBrowser';
export type { FileMeta } from '@pymodel/agent-core-v2/app/file/fileService';
export type {
  PluginCommandDef,
  PluginInfo,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from '@pymodel/agent-core-v2/app/plugin/types';
export type {
  AgentMeta,
  SessionMeta,
  SessionMetaPatch,
} from '@pymodel/agent-core-v2/session/sessionMetadata/sessionMetadata';
export type {
  ApprovalRequest,
  ApprovalResponse,
} from '@pymodel/agent-core-v2/session/approval/approval';
export type {
  QuestionRequest,
  QuestionResult,
} from '@pymodel/agent-core-v2/session/question/question';
export type {
  Interaction,
  InteractionKind,
} from '@pymodel/agent-core-v2/features/interaction/interaction';
export type { SkillSummary } from '@pymodel/agent-core-v2/features/skill/catalog/types';
export type {
  GlobalMcpServerConfig,
  McpManagedServer,
  McpServerAuthBeginResult,
  McpServerAuthState,
  McpServerAuthStatus,
  McpServerInspection,
  McpServerLocator,
  McpServerTestResult,
  McpServerTestTarget,
} from '@pymodel/agent-core-v2/app/mcpManagement/mcpManagement';
export type { ContentPart } from '@pymodel/agent-core-v2/kosong/contract/message';
export type { PermissionMode } from '@pymodel/agent-core-v2/agent/permissionPolicy/types';
