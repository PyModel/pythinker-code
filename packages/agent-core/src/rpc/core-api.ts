import type { ContentPart } from '@pythoughts/kosong';

import type { BackgroundTaskInfo } from '#/agent/background';
import type { PartialCompactionDirection } from '#/agent/compaction';
import type { AgentConfigData } from '#/agent/config';
import type { AgentContextData, ContextUsageReport } from '#/agent/context';
import type {
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
} from '#/agent/goal';
import type { PermissionData, PermissionMode } from '#/agent/permission';
import type { PlanData } from '#/agent/plan';
import type { DynamicWorkflowModeTrigger } from '#/agent/dynamic-workflow';
import type { ToolInfo } from '#/agent/tool';
import type { PythinkerConfig, PythinkerConfigPatch, McpServerConfig } from '#/config';
import type { ExperimentalFeatureState } from '#/flags';
import type { PluginInfo, PluginInstallOptions, PluginSummary, ReloadSummary } from '#/plugin';
import type { ResumeSessionResult } from '#/rpc/resumed';
import type { SessionMeta } from '#/session';
import type {
  FileCheckpointPreview,
  FileCheckpointSummary,
  RestoreFileCheckpointResult,
} from '#/session/file-checkpoints';
import type { WorkingTreeChanges, WorkingTreeFileDiff } from '#/session/working-tree';

import type { UsageStatus } from './events';
import type { WithAgentId, WithSessionId } from './types';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type Unsubscribe = () => void;

export type { PythinkerConfig, PythinkerConfigPatch };

export type TextPromptPart = Extract<ContentPart, { type: 'text' }>;
export type PromptPart = Extract<ContentPart, { type: 'text' | 'image_url' | 'video_url' }>;

export type PromptInput = readonly PromptPart[];

export type EmptyPayload = {};
export type SessionMetadataPatch = Partial<Omit<SessionMeta, 'agents' | 'sessionFormatVersion'>>;

export interface ClientTelemetryInfo {
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly uiMode?: string | undefined;
}

export interface CreateSessionPayload {
  readonly id?: string | undefined;
  readonly workDir: string;
  readonly model?: string | undefined;
  readonly thinking?: string | undefined;
  readonly permission?: PermissionMode | undefined;
  readonly setupTrigger?: 'init' | 'maintenance';
  readonly metadata?: JsonObject | undefined;
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  readonly client?: ClientTelemetryInfo | undefined;
}

export interface CloseSessionPayload {
  readonly sessionId: string;
}

export interface ArchiveSessionPayload {
  readonly sessionId: string;
}

export interface ResumeSessionPayload {
  readonly sessionId: string;
  readonly setupTrigger?: 'init' | 'maintenance';
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  /**
   * Limit each returned agent replay to the most recent N user turns. Omit to
   * return the full replay.
   */
  readonly replayTurnLimit?: number;
}

export interface ReloadSessionPayload {
  readonly sessionId: string;
}

export interface ForkSessionPayload {
  readonly sessionId: string;
  readonly id?: string;
  readonly title?: string;
  readonly metadata?: JsonObject;
}

export interface ShellEnvironment {
  readonly term?: string | undefined;
  readonly termProgram?: string | undefined;
  readonly termProgramVersion?: string | undefined;
  readonly multiplexer?: string | undefined;
  readonly shell?: string | undefined;
}

export interface ExportSessionPayload {
  readonly sessionId: string;
  readonly outputPath?: string | undefined;
  /**
   * When true, the active global diagnostic log (`$PYTHINKER_CODE_HOME/logs/pythinker-code.log`)
   * is copied into the zip at `logs/global/pythinker-code.log`. Off by default to
   * avoid bundling events from concurrent sessions / other projects.
   */
  readonly includeGlobalLog?: boolean | undefined;
  /** Host version to record in the export manifest. */
  readonly version: string;
  /** How the CLI was installed (e.g. 'npm-global', 'native'). */
  readonly installSource?: string | undefined;
  readonly shellEnv?: ShellEnvironment | undefined;
}

export interface ExportSessionManifest {
  readonly sessionId: string;
  readonly exportedAt: string;
  readonly pythinkerCodeVersion: string;
  readonly wireProtocolVersion: string;
  readonly os: string;
  readonly nodejsVersion: string;
  readonly sessionFirstActivity?: string | undefined;
  readonly sessionLastActivity?: string | undefined;
  readonly title?: string | undefined;
  readonly workspaceDir?: string | undefined;
  /** zip-relative path to the session diagnostic log when present. */
  readonly sessionLogPath?: string | undefined;
  /** zip-relative path to the bundled global diagnostic log (only when --include-global-log). */
  readonly globalLogPath?: string | undefined;
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

export interface ListSessionsPayload {
  readonly workDir?: string;
  readonly sessionId?: string;
  readonly includeArchive?: boolean;
}

export interface CoreInfo {
  readonly version: string;
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

export interface PromptPayload {
  readonly input: readonly ContentPart[];
  readonly outputSchema?: JsonObject;
}
export interface SteerPayload {
  readonly input: readonly ContentPart[];
}
export interface CancelPayload {
  readonly turnId?: number;
}
export interface SetThinkingPayload {
  readonly level: string;
}
export interface SetFastModePayload {
  readonly enabled: boolean;
}
export interface SetPermissionPayload {
  readonly mode: PermissionMode;
}
export interface SetModelPayload {
  readonly model: string;
}
export interface SetModelResult {
  readonly model: string;
  readonly providerName?: string | undefined;
}
export interface CancelPlanPayload {
  readonly id?: string;
}
export interface EnterDynamicWorkflowPayload {
  readonly trigger: DynamicWorkflowModeTrigger;
}
export interface BeginCompactionPayload {
  readonly instruction?: string;
  readonly promptFromEnd?: number;
  readonly direction?: PartialCompactionDirection;
}
export interface UndoHistoryPayload {
  readonly count: number;
}
export interface RegisterToolPayload {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
export interface UnregisterToolPayload {
  readonly name: string;
}
export interface SetActiveToolsPayload {
  readonly names: readonly string[];
}
export interface StopBackgroundPayload {
  readonly taskId: string;
  /** Free-form human-readable reason persisted with the task record. */
  readonly reason?: string;
}
export interface GetBackgroundOutputPayload {
  readonly taskId: string;
  readonly tail?: number;
}
export interface GetBackgroundPayload {
  /**
   * When omitted, returns all tasks (including terminal/lost). Pass
   * `true` to filter down to active-only — useful for model-facing
   * surfaces. UI/TUI consumers should leave it undefined.
   */
  readonly activeOnly?: boolean;
  /** Caps the number of tasks returned. When omitted, returns all matching tasks. */
  readonly limit?: number;
}
export interface SkillSummary {
  readonly name: string;
  readonly commandName?: string;
  readonly description: string;
  readonly path: string;
  readonly source: 'builtin' | 'user' | 'extra' | 'project';
  readonly type?: string | undefined;
  readonly disableModelInvocation?: boolean | undefined;
  readonly userInvocable?: boolean;
  readonly argumentHint?: string;
  readonly isSubSkill?: boolean | undefined;
}

export interface ActivateSkillPayload {
  readonly name: string;
  readonly args?: string | undefined;
}

export interface SkillActivationResult {
  readonly execution: 'inline' | 'fork';
  readonly result?: string;
}

export interface McpServerInfo {
  readonly name: string;
  readonly transport: 'stdio' | 'http' | 'sse';
  readonly status: 'pending' | 'connected' | 'failed' | 'disabled' | 'needs-auth';
  readonly toolCount: number;
  readonly error?: string;
}

export interface McpStartupMetrics {
  readonly durationMs: number;
}

export interface ReconnectMcpServerPayload {
  readonly name: string;
}

export interface InstallPluginPayload {
  readonly source: string;
  readonly options?: PluginInstallOptions;
}

export interface SetPluginEnabledPayload {
  readonly id: string;
  readonly enabled: boolean;
}

export interface SetPluginMcpServerEnabledPayload {
  readonly id: string;
  readonly server: string;
  readonly enabled: boolean;
}

export interface RemovePluginPayload {
  readonly id: string;
}

export interface GetPluginInfoPayload {
  readonly id: string;
}

export type ReloadPluginsResult = ReloadSummary;
export type { PluginSummary, PluginInfo };

export interface RenameSessionPayload {
  readonly title: string;
}

export interface UpdateSessionMetadataPayload {
  readonly metadata: SessionMetadataPatch;
}

export interface WorkspaceDirectory {
  readonly path: string;
  readonly source: 'user' | 'session';
}

export interface WorkspaceDirectoryPayload {
  readonly path: string;
}

export interface WorkingTreeDiffPayload {
  readonly path: string;
}

export interface FileCheckpointIdPayload {
  readonly checkpointId: string;
}

export interface SessionFileCheckpointPreview extends FileCheckpointPreview {
  readonly conversationAvailable: boolean;
}

// Goal lifecycle payloads and re-exported goal value types. These describe the
// deterministic user/SDK control surface; the goal's terminal status is decided
// by the model via the UpdateGoal tool (or the goal driver on budget/error),
// not set through this API.
export type {
  GoalBudgetLimits,
  GoalBudgetReport,
  GoalChange,
  GoalChangeStats,
  GoalSnapshot,
  GoalStatus,
  GoalToolResult,
};

export interface CreateGoalPayload {
  readonly objective: string;
  readonly replace?: boolean;
}

export interface GetPythinkerConfigPayload {
  readonly reload?: boolean;
}

export interface ConfigDiagnostics {
  /** Warnings from the most recent config.toml load attempt; empty when the config is fully valid. */
  readonly warnings: readonly string[];
}

export interface ListOutputStylesPayload {
  readonly workDir: string;
}

export interface OutputStyleSummary {
  readonly name: string;
  readonly description: string;
  readonly source: 'built-in' | 'plugin' | 'user' | 'project';
  readonly active: boolean;
  readonly forced?: boolean;
}

export interface OutputStyleCatalog {
  readonly active: string;
  readonly styles: readonly OutputStyleSummary[];
}

export interface ListAgentProfilesPayload {
  readonly workDir: string;
}

export interface ListWorkspaceSkillsPayload {
  readonly workDir: string;
}

export interface AgentProfileSummary {
  readonly name: string;
  readonly description?: string;
  readonly source: 'built-in' | 'plugin' | 'user' | 'project';
  readonly tools: readonly string[];
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: PermissionMode;
  readonly background?: boolean;
  readonly maxTurns?: number;
  readonly isolation?: 'worktree';
  readonly memory?: 'user' | 'project' | 'local';
  readonly whenToUse?: string;
  readonly subagents: readonly string[];
}

export interface AgentProfileCatalog {
  readonly profiles: readonly AgentProfileSummary[];
  readonly warnings: readonly {
    readonly path: string;
    readonly error: string;
  }[];
}

export type SetPythinkerConfigPayload = PythinkerConfigPatch;

export interface ReplacePythinkerConfigPayload {
  readonly config: PythinkerConfig;
}

export interface RemovePythinkerProviderPayload {
  readonly providerId: string;
}

export interface AgentAPI {
  prompt: (payload: PromptPayload) => void;
  steer: (payload: SteerPayload) => void;
  cancel: (payload: CancelPayload) => void;
  undoHistory: (payload: UndoHistoryPayload) => void;
  setThinking: (payload: SetThinkingPayload) => void;
  setFastMode: (payload: SetFastModePayload) => void;
  setPermission: (payload: SetPermissionPayload) => void;
  setModel: (payload: SetModelPayload) => SetModelResult;
  getModel: (payload: EmptyPayload) => string;
  enterPlan: (payload: EmptyPayload) => void;
  cancelPlan: (payload: CancelPlanPayload) => void;
  clearPlan: (payload: EmptyPayload) => void;
  enterDynamicWorkflow: (payload: EnterDynamicWorkflowPayload) => void;
  exitDynamicWorkflow: (payload: EmptyPayload) => void;
  getDynamicWorkflowMode: (payload: EmptyPayload) => boolean;
  beginCompaction: (payload: BeginCompactionPayload) => void;
  cancelCompaction: (payload: EmptyPayload) => void;
  registerTool: (payload: RegisterToolPayload) => void;
  unregisterTool: (payload: UnregisterToolPayload) => void;
  setActiveTools: (payload: SetActiveToolsPayload) => void;
  stopBackground: (payload: StopBackgroundPayload) => void;
  clearContext: (payload: EmptyPayload) => void;
  activateSkill: (payload: ActivateSkillPayload) => SkillActivationResult;
  startBtw: (payload: EmptyPayload) => string;
  createGoal: (payload: CreateGoalPayload) => GoalSnapshot;
  getGoal: (payload: EmptyPayload) => GoalToolResult;
  pauseGoal: (payload: EmptyPayload) => GoalSnapshot;
  resumeGoal: (payload: EmptyPayload) => GoalSnapshot;
  cancelGoal: (payload: EmptyPayload) => GoalSnapshot;
  getBackgroundOutput: (payload: GetBackgroundOutputPayload) => string;
  getContext: (payload: EmptyPayload) => AgentContextData;
  getContextUsage: (payload: EmptyPayload) => ContextUsageReport;
  getConfig: (payload: EmptyPayload) => AgentConfigData;
  getPermission: (payload: EmptyPayload) => PermissionData;
  getPlan: (payload: EmptyPayload) => PlanData;
  getUsage: (payload: EmptyPayload) => UsageStatus;
  getTools: (payload: EmptyPayload) => readonly ToolInfo[];
  listContextFiles: (payload: EmptyPayload) => readonly string[];
  getBackground: (payload: GetBackgroundPayload) => readonly BackgroundTaskInfo[];
}

type AgentAPIWithId = WithAgentId<AgentAPI>;

export interface SessionAPI extends AgentAPIWithId {
  renameSession: (payload: RenameSessionPayload) => void;
  updateSessionMetadata: (payload: UpdateSessionMetadataPayload) => void;
  getSessionMetadata: (payload: EmptyPayload) => SessionMeta;
  listWorkspaceDirectories: (payload: EmptyPayload) => readonly WorkspaceDirectory[];
  addWorkspaceDirectory: (payload: WorkspaceDirectoryPayload) => WorkspaceDirectory;
  removeWorkspaceDirectory: (payload: WorkspaceDirectoryPayload) => void;
  listSkills: (payload: EmptyPayload) => readonly SkillSummary[];
  /** Re-discovers skills from disk so one written mid-session becomes usable. */
  reloadSkills: (payload: EmptyPayload) => void;
  listMcpServers: (payload: EmptyPayload) => readonly McpServerInfo[];
  getMcpStartupMetrics: (payload: EmptyPayload) => McpStartupMetrics;
  reconnectMcpServer: (payload: ReconnectMcpServerPayload) => void;
  generateAgentsMd: (payload: EmptyPayload) => void;
  refreshInstructions: (payload: EmptyPayload) => void;
  listWorkingTreeChanges: (payload: EmptyPayload) => WorkingTreeChanges;
  getWorkingTreeDiff: (payload: WorkingTreeDiffPayload) => WorkingTreeFileDiff;
  listFileCheckpoints: (payload: EmptyPayload) => readonly FileCheckpointSummary[];
  previewFileCheckpoint: (payload: FileCheckpointIdPayload) => SessionFileCheckpointPreview;
  restoreFileCheckpoint: (payload: FileCheckpointIdPayload) => RestoreFileCheckpointResult;
}

type SessionAPIWithId = WithSessionId<SessionAPI>;

export interface CoreAPI extends SessionAPIWithId {
  getCoreInfo: (payload: EmptyPayload) => CoreInfo;
  getExperimentalFeatures: (payload: EmptyPayload) => readonly ExperimentalFeatureState[];
  getPythinkerConfig: (payload: GetPythinkerConfigPayload) => PythinkerConfig;
  getConfigDiagnostics: (payload: EmptyPayload) => ConfigDiagnostics;
  listOutputStyles: (payload: ListOutputStylesPayload) => OutputStyleCatalog;
  listAgentProfiles: (payload: ListAgentProfilesPayload) => AgentProfileCatalog;
  listWorkspaceSkills: (payload: ListWorkspaceSkillsPayload) => readonly SkillSummary[];
  setPythinkerConfig: (payload: SetPythinkerConfigPayload) => PythinkerConfig;
  replacePythinkerConfig: (payload: ReplacePythinkerConfigPayload) => PythinkerConfig;
  removePythinkerProvider: (payload: RemovePythinkerProviderPayload) => PythinkerConfig;
  createSession: (payload: CreateSessionPayload) => SessionSummary;
  closeSession: (payload: CloseSessionPayload) => void;
  archiveSession: (payload: ArchiveSessionPayload) => void;
  resumeSession: (payload: ResumeSessionPayload) => ResumeSessionResult;
  reloadSession: (payload: ReloadSessionPayload) => ResumeSessionResult;
  forkSession: (payload: ForkSessionPayload) => ResumeSessionResult;
  listSessions: (payload: ListSessionsPayload) => readonly SessionSummary[];
  exportSession: (payload: ExportSessionPayload) => ExportSessionResult;
  listPlugins: (payload: EmptyPayload) => readonly PluginSummary[];
  installPlugin: (payload: InstallPluginPayload) => PluginSummary;
  setPluginEnabled: (payload: SetPluginEnabledPayload) => void;
  setPluginMcpServerEnabled: (payload: SetPluginMcpServerEnabledPayload) => void;
  removePlugin: (payload: RemovePluginPayload) => void;
  reloadPlugins: (payload: EmptyPayload) => ReloadPluginsResult;
  getPluginInfo: (payload: GetPluginInfoPayload) => PluginInfo;
}
