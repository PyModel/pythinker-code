import { AsyncLocalStorage } from 'node:async_hooks';

import {
  ErrorCodes,
  makeErrorPayload,
  type AdvisorStatus,
  type AgentContextData,
  type ApprovalRequest,
  type ApprovalResponse,
  type CoreAPI,
  type DynamicWorkflowModeTrigger,
  type Event,
  type ExperimentalFeatureState,
  type QuestionRequest,
  type QuestionResult,
  type RPCMethods,
  type SDKAPI,
  type SkillActivationResult,
  type ToolCallRequest,
  type ToolCallResponse,
} from '@pymodel/agent-core';
import type { Kaos } from '@pymodel/kaos';

import type { ApprovalHandler, QuestionHandler } from '#/events';
import type {
  AgentProfileCatalog,
  BackgroundTaskInfo,
  ConfigDiagnostics,
  ContextUsageReport,
  CreateSessionOptions,
  ExportSessionInput,
  ExportSessionResult,
  FileCheckpointSummary,
  CreateGoalInput,
  ForkSessionInput,
  GetConfigOptions,
  GoalSnapshot,
  GoalToolResult,
  PythinkerConfig,
  PythinkerConfigPatch,
  ListSessionsOptions,
  McpServerInfo,
  McpStartupMetrics,
  OutputStyleCatalog,
  PermissionMode,
  PluginInfo,
  PluginInstallOptions,
  PluginSummary,
  ReloadSummary,
  RestoreFileCheckpointResult,
  CompactOptions,
  SessionPlan,
  SessionMeta,
  SessionMetadataPatch,
  SessionFileCheckpointPreview,
  SessionStatus,
  SessionUsage,
  PromptInput,
  JsonObject,
  RenameSessionInput,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
  SkillSummary,
  Unsubscribe,
  WorkspaceDirectory,
  WorkingTreeChanges,
  WorkingTreeFileDiff,
} from '#/types';

const MAIN_AGENT_ID = 'main';

export interface SessionPromptRpcInput {
  readonly sessionId: string;
  readonly input: PromptInput;
  readonly outputSchema?: JsonObject;
}

export interface SessionIdRpcInput {
  readonly sessionId: string;
}

export interface SetSessionModelRpcInput extends SessionIdRpcInput {
  readonly model: string;
}

export interface SetSessionModelRpcResult {
  readonly model: string;
  readonly providerName?: string | undefined;
}

export interface SetSessionThinkingRpcInput extends SessionIdRpcInput {
  readonly level: string;
}

export interface SetSessionFastModeRpcInput extends SessionIdRpcInput {
  readonly enabled: boolean;
}

export interface SetSessionPermissionRpcInput extends SessionIdRpcInput {
  readonly mode: PermissionMode;
}

export interface SetSessionPlanModeRpcInput extends SessionIdRpcInput {
  readonly enabled: boolean;
}

export type SetSessionDynamicWorkflowModeRpcInput =
  | (SessionIdRpcInput & { readonly enabled: true; readonly trigger: DynamicWorkflowModeTrigger })
  | (SessionIdRpcInput & { readonly enabled: false });
export interface SetSessionAdvisorEnabledRpcInput extends SessionIdRpcInput {
  readonly enabled: boolean;
  readonly advisorId?: string;
}

export interface ActivateSkillRpcInput extends SessionIdRpcInput {
  readonly name: string;
  readonly args?: string | undefined;
}

export interface ReconnectMcpServerRpcInput extends SessionIdRpcInput {
  readonly name: string;
}

type ResolvedCoreAPI = RPCMethods<CoreAPI>;

export abstract class SDKRpcClientBase {
  private readonly interactiveAgentScope = new AsyncLocalStorage<string>();
  private readonly eventListeners = new Set<(event: Event) => void>();
  private readonly approvalHandlers = new Map<string, ApprovalHandler>();
  private readonly questionHandlers = new Map<string, QuestionHandler>();

  get interactiveAgentId(): string {
    return this.interactiveAgentScope.getStore() ?? MAIN_AGENT_ID;
  }

  withInteractiveAgent<T>(agentId: string, fn: () => T): T {
    return this.interactiveAgentScope.run(agentId, fn);
  }

  protected abstract getRpc(): Promise<ResolvedCoreAPI>;

  async createSession(input: CreateSessionOptions): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    const { planMode, ...coreInput } = input;
    void planMode;
    return rpc.createSession(coreInput);
  }

  async createSessionWithKaos(
    input: CreateSessionOptions,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<SessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.createSession(input);
  }

  async resumeSession(input: ResumeSessionInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.resumeSession({ ...input, sessionId: input.id });
  }

  async resumeSessionWithKaos(
    input: ResumeSessionInput,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<ResumedSessionSummary> {
    void kaos;
    void persistenceKaos;
    return this.resumeSession(input);
  }

  async reloadSession(input: SessionIdRpcInput): Promise<ResumedSessionSummary> {
    const rpc = await this.getRpc();
    return rpc.reloadSession({ sessionId: input.sessionId });
  }

  async forkSession(input: ForkSessionInput): Promise<SessionSummary> {
    const rpc = await this.getRpc();
    return rpc.forkSession({
      sessionId: input.id,
      id: input.forkId,
      title: input.title,
      metadata: input.metadata,
    });
  }

  async closeSession(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.closeSession({ sessionId: input.sessionId });
  }

  async listSessions(input: ListSessionsOptions = {}): Promise<readonly SessionSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listSessions(input);
  }

  async renameSession(input: RenameSessionInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.renameSession({
      sessionId: input.id,
      title: input.title,
    });
  }

  async getSessionMetadata(input: SessionIdRpcInput): Promise<SessionMeta> {
    const rpc = await this.getRpc();
    return rpc.getSessionMetadata({ sessionId: input.sessionId });
  }

  async updateSessionMetadata(
    input: SessionIdRpcInput & { readonly metadata: SessionMetadataPatch },
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.updateSessionMetadata(input);
  }

  async exportSession(input: ExportSessionInput): Promise<ExportSessionResult> {
    const rpc = await this.getRpc();
    return rpc.exportSession({
      sessionId: input.id,
      outputPath: input.outputPath,
      includeGlobalLog: input.includeGlobalLog,
      version: input.version,
      installSource: input.installSource,
      shellEnv: input.shellEnv,
    });
  }

  async getConfig(input?: GetConfigOptions): Promise<PythinkerConfig> {
    const rpc = await this.getRpc();
    return rpc.getPythinkerConfig(input ?? {});
  }

  async getConfigDiagnostics(): Promise<ConfigDiagnostics> {
    const rpc = await this.getRpc();
    return rpc.getConfigDiagnostics({});
  }

  async getExperimentalFeatures(): Promise<readonly ExperimentalFeatureState[]> {
    const rpc = await this.getRpc();
    return rpc.getExperimentalFeatures({});
  }

  async listOutputStyles(workDir: string): Promise<OutputStyleCatalog> {
    const rpc = await this.getRpc();
    return rpc.listOutputStyles({ workDir });
  }

  async listAgentProfiles(workDir: string): Promise<AgentProfileCatalog> {
    const rpc = await this.getRpc();
    return rpc.listAgentProfiles({ workDir });
  }

  /** The workspace's skills without opening a session; excludes session-only MCP prompts. */
  async listWorkspaceSkills(workDir: string): Promise<readonly SkillSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listWorkspaceSkills({ workDir });
  }

  async setConfig(input: PythinkerConfigPatch): Promise<PythinkerConfig> {
    const rpc = await this.getRpc();
    return rpc.setPythinkerConfig(input);
  }

  /** Validated full replacement of the persisted config; deletions of providers/models survive close and reload. */
  async replaceConfig(config: PythinkerConfig): Promise<PythinkerConfig> {
    const rpc = await this.getRpc();
    return rpc.replacePythinkerConfig({ config });
  }

  async removeProvider(providerId: string): Promise<PythinkerConfig> {
    const rpc = await this.getRpc();
    return rpc.removePythinkerProvider({ providerId });
  }

  async prompt(input: SessionPromptRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.prompt({
      sessionId: input.sessionId,
      agentId,
      input: input.input,
      outputSchema: input.outputSchema,
    });
  }

  async steer(input: SessionPromptRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.steer({
      sessionId: input.sessionId,
      agentId,
      input: input.input,
    });
  }

  async generateAgentsMd(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.generateAgentsMd({ sessionId: input.sessionId });
  }

  async refreshInstructions(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.refreshInstructions({ sessionId: input.sessionId });
  }

  async listWorkingTreeChanges(input: SessionIdRpcInput): Promise<WorkingTreeChanges> {
    const rpc = await this.getRpc();
    return rpc.listWorkingTreeChanges({ sessionId: input.sessionId });
  }

  async getWorkingTreeDiff(
    input: SessionIdRpcInput & { path: string },
  ): Promise<WorkingTreeFileDiff> {
    const rpc = await this.getRpc();
    return rpc.getWorkingTreeDiff({
      sessionId: input.sessionId,
      path: input.path,
    });
  }

  async listFileCheckpoints(input: SessionIdRpcInput): Promise<readonly FileCheckpointSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listFileCheckpoints({ sessionId: input.sessionId });
  }

  async previewFileCheckpoint(
    input: SessionIdRpcInput & { checkpointId: string },
  ): Promise<SessionFileCheckpointPreview> {
    const rpc = await this.getRpc();
    return rpc.previewFileCheckpoint(input);
  }

  async restoreFileCheckpoint(
    input: SessionIdRpcInput & { checkpointId: string },
  ): Promise<RestoreFileCheckpointResult> {
    const rpc = await this.getRpc();
    return rpc.restoreFileCheckpoint(input);
  }

  async startBtw(input: SessionIdRpcInput): Promise<string> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.startBtw({
      sessionId: input.sessionId,
      agentId,
    });
  }

  async cancel(input: SessionIdRpcInput): Promise<void> {
    const agentId = this.interactiveAgentId;
    const rpc = await this.getRpc();
    return rpc.cancel({
      sessionId: input.sessionId,
      agentId,
    });
  }

  async setModel(input: SetSessionModelRpcInput): Promise<SetSessionModelRpcResult> {
    const rpc = await this.getRpc();
    return rpc.setModel({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      model: input.model,
    });
  }

  async setThinking(input: SetSessionThinkingRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setThinking({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      level: input.level,
    });
  }

  /** Toggles Fast mode for the session; the server rejects it when the active model does not support it. */
  async setFastMode(input: SetSessionFastModeRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setFastMode({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      enabled: input.enabled,
    });
  }

  async setPermission(input: SetSessionPermissionRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPermission({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      mode: input.mode,
    });
  }

  async setPlanMode(input: SetSessionPlanModeRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    if (!input.enabled) {
      return rpc.cancelPlan({
        sessionId: input.sessionId,
        agentId: this.interactiveAgentId,
      });
    }
    return rpc.enterPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async setDynamicWorkflowMode(input: SetSessionDynamicWorkflowModeRpcInput): Promise<void> {
    if (input.enabled) return this.enterDynamicWorkflow(input);
    return this.exitDynamicWorkflow(input);
  }

  async dynamicWorkflow(input: SessionPromptRpcInput): Promise<void> {
    await this.enterDynamicWorkflow({ sessionId: input.sessionId, trigger: 'task' });
    return this.prompt(input);
  }

  private async enterDynamicWorkflow(
    input: SessionIdRpcInput & { readonly trigger: DynamicWorkflowModeTrigger },
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.enterDynamicWorkflow({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      trigger: input.trigger,
    });
  }

  private async exitDynamicWorkflow(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.exitDynamicWorkflow({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getPlan(input: SessionIdRpcInput): Promise<SessionPlan> {
    const rpc = await this.getRpc();
    return rpc.getPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async clearPlan(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    await rpc.clearPlan({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async compact(input: SessionIdRpcInput & CompactOptions): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.beginCompaction({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      instruction: input.instruction,
      promptFromEnd: input.promptFromEnd,
      direction: input.direction,
    });
  }

  async cancelCompaction(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.cancelCompaction({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async undoHistory(input: SessionIdRpcInput & { count: number }): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.undoHistory({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      count: input.count,
    });
  }

  async getContext(input: SessionIdRpcInput): Promise<AgentContextData> {
    const rpc = await this.getRpc();
    return rpc.getContext({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getContextUsage(input: SessionIdRpcInput): Promise<ContextUsageReport> {
    const rpc = await this.getRpc();
    return rpc.getContextUsage({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getUsage(input: SessionIdRpcInput): Promise<SessionUsage> {
    const rpc = await this.getRpc();
    return rpc.getUsage({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async getStatus(input: SessionIdRpcInput): Promise<SessionStatus> {
    const rpc = await this.getRpc();
    const agentId = this.interactiveAgentId;
    const config = await rpc.getConfig({
      sessionId: input.sessionId,
      agentId,
    });
    const context = await rpc.getContext({
      sessionId: input.sessionId,
      agentId,
    });
    const permission = await rpc.getPermission({
      sessionId: input.sessionId,
      agentId,
    });
    const plan = await rpc.getPlan({
      sessionId: input.sessionId,
      agentId,
    });
    const dynamicWorkflowMode = await rpc.getDynamicWorkflowMode({
      sessionId: input.sessionId,
      agentId,
    });
    const usage = await rpc.getUsage({
      sessionId: input.sessionId,
      agentId,
    });
    const maxContextTokens = config.modelCapabilities?.max_context_tokens ?? 0;
    const contextTokens = context.tokenCount;
    const contextUsage = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;
    const hasUsage =
      usage.byModel !== undefined ||
      usage.total !== undefined ||
      usage.currentTurn !== undefined ||
      usage.totalCostUsd !== undefined;
    return {
      model: config.modelAlias ?? config.provider?.model,
      modelCostRates: config.modelCapabilities?.cost,
      thinkingLevel: config.thinkingLevel,
      // Default to disabled/unsupported so servers predating the fast mode fields report a stable status.
      fastMode: config.fastMode ?? false,
      fastModeSupported: config.fastModeSupported ?? false,
      permission: permission.mode,
      planMode: plan !== null,
      dynamicWorkflowMode,
      contextTokens,
      maxContextTokens,
      contextUsage,
      usage: hasUsage ? usage : undefined,
    };
  }

  async listSkills(input: SessionIdRpcInput): Promise<readonly SkillSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listSkills({ sessionId: input.sessionId });
  }

  async getAdvisorStatus(input: SessionIdRpcInput): Promise<readonly AdvisorStatus[]> {
    const rpc = await this.getRpc();
    return rpc.getAdvisorStatus({ sessionId: input.sessionId });
  }

  async setAdvisorEnabled(
    input: SetSessionAdvisorEnabledRpcInput,
  ): Promise<readonly AdvisorStatus[]> {
    const rpc = await this.getRpc();
    return rpc.setAdvisorEnabled({
      sessionId: input.sessionId,
      enabled: input.enabled,
      advisorId: input.advisorId,
    });
  }

  async reloadAdvisor(input: SessionIdRpcInput): Promise<readonly AdvisorStatus[]> {
    const rpc = await this.getRpc();
    return rpc.reloadAdvisor({ sessionId: input.sessionId });
  }
  async reloadSkills(input: SessionIdRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    await rpc.reloadSkills({ sessionId: input.sessionId });
  }

  async listContextFiles(input: SessionIdRpcInput): Promise<readonly string[]> {
    const rpc = await this.getRpc();
    return rpc.listContextFiles({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async listWorkspaceDirectories(input: SessionIdRpcInput): Promise<readonly WorkspaceDirectory[]> {
    const rpc = await this.getRpc();
    return rpc.listWorkspaceDirectories({ sessionId: input.sessionId });
  }

  async addWorkspaceDirectory(
    input: SessionIdRpcInput & { path: string },
  ): Promise<WorkspaceDirectory> {
    const rpc = await this.getRpc();
    return rpc.addWorkspaceDirectory(input);
  }

  async removeWorkspaceDirectory(input: SessionIdRpcInput & { path: string }): Promise<void> {
    const rpc = await this.getRpc();
    await rpc.removeWorkspaceDirectory(input);
  }

  async listBackgroundTasks(
    input: SessionIdRpcInput & { activeOnly?: boolean; limit?: number },
  ): Promise<readonly BackgroundTaskInfo[]> {
    const rpc = await this.getRpc();
    return rpc.getBackground({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      activeOnly: input.activeOnly,
      limit: input.limit,
    });
  }

  async getBackgroundTaskOutput(
    input: SessionIdRpcInput & { taskId: string; tail?: number },
  ): Promise<string> {
    const rpc = await this.getRpc();
    return rpc.getBackgroundOutput({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      taskId: input.taskId,
      tail: input.tail,
    });
  }

  async stopBackgroundTask(
    input: SessionIdRpcInput & { taskId: string; reason?: string },
  ): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.stopBackground({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      taskId: input.taskId,
      reason: input.reason,
    });
  }

  async createGoal(input: SessionIdRpcInput & CreateGoalInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.createGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      objective: input.objective,
      replace: input.replace,
    });
  }

  async getGoal(input: SessionIdRpcInput): Promise<GoalToolResult> {
    const rpc = await this.getRpc();
    return rpc.getGoal({ sessionId: input.sessionId, agentId: this.interactiveAgentId });
  }

  async pauseGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.pauseGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async resumeGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.resumeGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async cancelGoal(input: SessionIdRpcInput): Promise<GoalSnapshot> {
    const rpc = await this.getRpc();
    return rpc.cancelGoal({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
    });
  }

  async listMcpServers(input: SessionIdRpcInput): Promise<readonly McpServerInfo[]> {
    const rpc = await this.getRpc();
    return rpc.listMcpServers({ sessionId: input.sessionId });
  }

  async getMcpStartupMetrics(input: SessionIdRpcInput): Promise<McpStartupMetrics> {
    const rpc = await this.getRpc();
    return rpc.getMcpStartupMetrics({ sessionId: input.sessionId });
  }

  async reconnectMcpServer(input: ReconnectMcpServerRpcInput): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.reconnectMcpServer({ sessionId: input.sessionId, name: input.name });
  }

  async listPlugins(): Promise<readonly PluginSummary[]> {
    const rpc = await this.getRpc();
    return rpc.listPlugins({});
  }

  async installPlugin(source: string, options?: PluginInstallOptions): Promise<PluginSummary> {
    const rpc = await this.getRpc();
    return rpc.installPlugin({ source, options });
  }

  async setPluginEnabled(id: string, enabled: boolean): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPluginEnabled({ id, enabled });
  }

  async setPluginMcpServerEnabled(id: string, server: string, enabled: boolean): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.setPluginMcpServerEnabled({ id, server, enabled });
  }

  async removePlugin(id: string): Promise<void> {
    const rpc = await this.getRpc();
    return rpc.removePlugin({ id });
  }

  async reloadPlugins(): Promise<ReloadSummary> {
    const rpc = await this.getRpc();
    return rpc.reloadPlugins({});
  }

  async getPluginInfo(id: string): Promise<PluginInfo> {
    const rpc = await this.getRpc();
    return rpc.getPluginInfo({ id });
  }

  async activateSkill(input: ActivateSkillRpcInput): Promise<SkillActivationResult> {
    const rpc = await this.getRpc();
    return rpc.activateSkill({
      sessionId: input.sessionId,
      agentId: this.interactiveAgentId,
      name: input.name,
      args: input.args,
    });
  }

  onEvent(listener: (event: Event) => void): Unsubscribe {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  receiveEvent(event: Event): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  setApprovalHandler(sessionId: string, handler: ApprovalHandler | undefined): void {
    if (handler === undefined) {
      this.approvalHandlers.delete(sessionId);
      return;
    }
    this.approvalHandlers.set(sessionId, handler);
  }

  setQuestionHandler(sessionId: string, handler: QuestionHandler | undefined): void {
    if (handler === undefined) {
      this.questionHandlers.delete(sessionId);
      return;
    }
    this.questionHandlers.set(sessionId, handler);
  }

  clearSessionHandlers(sessionId: string): void {
    this.approvalHandlers.delete(sessionId);
    this.questionHandlers.delete(sessionId);
  }

  async requestApproval(
    request: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    const handler = this.approvalHandlers.get(request.sessionId);
    if (handler === undefined) {
      return {
        decision: 'cancelled',
        feedback: 'No approval handler registered.',
      };
    }

    try {
      return await handler(request);
    } catch (error) {
      this.receiveEvent({
        type: 'error',
        sessionId: request.sessionId,
        agentId: request.agentId,
        ...makeErrorPayload(ErrorCodes.SESSION_APPROVAL_HANDLER_ERROR, errorMessage(error)),
      });
      return {
        decision: 'cancelled',
        feedback: 'Approval handler failed.',
      };
    }
  }

  async requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
  ): Promise<QuestionResult> {
    const handler = this.questionHandlers.get(request.sessionId);
    if (handler === undefined) return null;

    try {
      return await handler(request);
    } catch (error) {
      this.receiveEvent({
        type: 'error',
        sessionId: request.sessionId,
        agentId: request.agentId,
        ...makeErrorPayload(ErrorCodes.SESSION_QUESTION_HANDLER_ERROR, errorMessage(error)),
      });
      return null;
    }
  }

  async toolCall(request: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      output: `SDK custom tool calls are not supported: ${request.toolCallId}`,
      isError: true,
    };
  }
}

export class ClientAPI implements SDKAPI {
  constructor(readonly client: SDKRpcClientBase) {}

  emitEvent(event: Event): void {
    this.client.receiveEvent(event);
  }

  requestApproval(
    request: ApprovalRequest & { sessionId: string; agentId: string },
  ): Promise<ApprovalResponse> {
    return this.client.requestApproval(request);
  }

  requestQuestion(
    request: QuestionRequest & { sessionId: string; agentId: string },
  ): Promise<QuestionResult> {
    return this.client.requestQuestion(request);
  }

  toolCall(request: ToolCallRequest): Promise<ToolCallResponse> {
    return this.client.toolCall(request);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
