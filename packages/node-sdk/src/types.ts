import type {
  ExportSessionManifest,
  PartialCompactionDirection,
  ResumeSessionResult,
  ShellEnvironment,
  TelemetryClient,
  TelemetryContextPatch,
  TelemetryProperties,
} from '@pythoughts/agent-core';
import type { Kaos } from '@pythoughts/kaos';
import type { ContentPart, ModelCostRates } from '@pythoughts/kosong';
import type {
  PythinkerHostIdentity,
  OAuthRefreshOutcome,
} from '@pythoughts/pythinker-code-oauth';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type Unsubscribe = () => void;

export type {
  AgentReplayRecord,
  AgentProfileCatalog,
  AgentProfileSummary,
  AgentBackgroundTaskInfo,
  BackgroundConfig,
  BackgroundTaskInfo,
  BackgroundTaskStatus,
  ConfigDiagnostics,
  ContextMessage,
  ContextUsageCategory,
  ContextUsageReport,
  ContextUsageTool,
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  ExportSessionManifest,
  FileCheckpointSummary,
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
  PythinkerConfig,
  PythinkerConfigPatch,
  LoopControl,
  McpServerInfo,
  McpStartupMetrics,
  ModelAlias,
  PythoughtsServiceConfig,
  OAuthRef,
  OutputStyleCatalog,
  OutputStyleSummary,
  PartialCompactionDirection,
  PluginComponentDeclarations,
  PluginConfigDeclaration,
  PluginDefinitionJsonObject,
  PluginDefinitionJsonPrimitive,
  PluginDefinitionJsonValue,
  PluginGithubMetadata,
  PluginGithubRef,
  PluginInfo,
  PluginInstallDefinition,
  PluginInstallOptions,
  PluginMcpServerInfo,
  PluginPathDeclaration,
  PluginSource,
  PluginSummary,
  ProcessBackgroundTaskInfo,
  PromptOrigin,
  ProviderConfig,
  ProviderType,
  QuestionBackgroundTaskInfo,
  ReloadSummary,
  RestoreFileCheckpointResult,
  ResumedAgentState,
  SessionMeta,
  SessionMetadataPatch,
  SessionFileCheckpointPreview,
  ServicesConfig,
  ShellEnvironment,
  SkillSummary,
  ThinkingConfig,
  ToolInfo,
  WorkspaceDirectory,
  WorkingTreeChange,
  WorkingTreeChanges,
  WorkingTreeChangeStatus,
  WorkingTreeFileDiff,
} from '@pythoughts/agent-core';

export type { PythinkerHostIdentity, OAuthRefreshOutcome };
export type { TelemetryClient, TelemetryContextPatch, TelemetryProperties };
export type { ContentPart, ModelCostRates, Role, ToolCall } from '@pythoughts/kosong';

export type PermissionMode = 'yolo' | 'manual' | 'auto';

export interface CreateGoalInput {
  readonly objective: string;
  readonly replace?: boolean;
}

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

export type PromptInput = readonly PromptPart[];

export interface PromptOptions {
  readonly outputSchema?: JsonObject;
}

export interface PythinkerHarnessOptions {
  readonly identity?: PythinkerHostIdentity | undefined;
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly autoLoadConfig?: boolean | undefined;
  readonly uiMode?: string;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly onOAuthRefresh?: ((outcome: OAuthRefreshOutcome) => void) | undefined;
}

export interface CreateSessionOptions {
  readonly id?: string | undefined;
  readonly workDir: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly permission?: PermissionMode | undefined;
  readonly setupTrigger?: 'init' | 'maintenance';
  readonly planMode?: boolean;
  readonly metadata?: JsonObject | undefined;
  readonly kaos?: Kaos | undefined;
  readonly persistenceKaos?: Kaos | undefined;
}

export interface RenameSessionInput {
  readonly id: string;
  readonly title: string;
}

export interface ResumeSessionInput {
  readonly id: string;
  readonly setupTrigger?: 'init' | 'maintenance';
  readonly kaos?: Kaos | undefined;
  readonly persistenceKaos?: Kaos | undefined;
  /**
   * Limit each returned agent replay to the most recent N user turns. Omit to
   * return the full replay.
   */
  readonly replayTurnLimit?: number;
}

export interface ForkSessionInput {
  readonly id: string;
  readonly forkId?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
}

export interface ExportSessionInput {
  readonly id: string;
  readonly outputPath?: string | undefined;
  readonly includeGlobalLog?: boolean | undefined;
  /** Host version to record in the export manifest. */
  readonly version: string;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionResult {
  readonly zipPath: string;
  readonly entries: readonly string[];
  readonly sessionDir: string;
  readonly manifest: ExportSessionManifest;
}

export interface ListSessionsOptions {
  readonly workDir?: string;
  readonly sessionId?: string;
}

export interface GetConfigOptions {
  readonly reload?: boolean | undefined;
}

export interface CompactOptions {
  readonly instruction?: string | undefined;
  readonly promptFromEnd?: number;
  readonly direction?: PartialCompactionDirection;
}

export interface PlanInfo {
  readonly id: string;
  readonly content: string;
  readonly path: string;
}

export type SessionPlan = PlanInfo | null;

export interface TokenUsage {
  readonly inputOther: number;
  readonly output: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
}

export interface SessionUsage {
  readonly byModel?: Record<string, TokenUsage> | undefined;
  readonly currentTurn?: TokenUsage | undefined;
  readonly total?: TokenUsage | undefined;
  readonly totalCostUsd?: number;
}

export interface SessionStatus {
  readonly model?: string;
  readonly modelCostRates?: ModelCostRates;
  readonly thinkingLevel: string;
  /** Whether Fast mode is currently enabled for this session. */
  readonly fastMode?: boolean;
  /** Whether the active provider/model supports Fast mode at all. */
  readonly fastModeSupported?: boolean;
  readonly permission: PermissionMode;
  readonly planMode: boolean;
  readonly dynamicWorkflowMode: boolean;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly contextUsage: number;
  readonly usage?: SessionUsage;
}

export interface SessionSummary {
  readonly id: string;
  readonly title?: string | undefined;
  readonly lastPrompt?: string;
  readonly workDir: string;
  readonly sessionDir: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived?: boolean | undefined;
  readonly metadata?: JsonObject | undefined;
}

export type ResumedSessionState = Pick<
  ResumeSessionResult,
  'sessionMetadata' | 'agents'
>;

export interface ResumedSessionSummary extends SessionSummary, ResumedSessionState {}
