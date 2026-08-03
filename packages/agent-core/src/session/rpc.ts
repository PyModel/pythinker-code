import { ErrorCodes, PythinkerError } from '#/errors';
import { convertMCPContentBlock } from '#/mcp/output';
import type {
  ActivateSkillPayload,
  AgentAPI,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CreateGoalPayload,
  EmptyPayload,
  EnterDynamicWorkflowPayload,
  FileCheckpointIdPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  McpServerInfo,
  McpStartupMetrics,
  PromptPayload,
  ReconnectMcpServerPayload,
  RenameSessionPayload,
  RegisterToolPayload,
  SessionAPI,
  SetActiveToolsPayload,
  SetFastModePayload,
  SetModelPayload,
  SetPermissionPayload,
  SetThinkingPayload,
  SkillSummary,
  SteerPayload,
  StopBackgroundPayload,
  UndoHistoryPayload,
  UnregisterToolPayload,
  UpdateSessionMetadataPayload,
  WorkspaceDirectory,
  WorkspaceDirectoryPayload,
  WorkingTreeDiffPayload,
} from '#/rpc';
import type { PromisableMethods } from '#/utils/types';

import type { Session, SessionMeta } from '.';
import {
  promptMetadataTextFromPayload,
  promptMetadataTextFromSkill,
  titleFromPromptMetadataText,
} from './prompt-metadata';

type AgentScopedPayload<T> = T & { agentId: string };

export class SessionAPIImpl implements PromisableMethods<SessionAPI> {
  constructor(protected readonly session: Session) {}

  async renameSession(payload: RenameSessionPayload): Promise<void> {
    const title = payload.title.trim();
    if (title.length === 0) {
      throw new PythinkerError(ErrorCodes.SESSION_TITLE_EMPTY, 'Session title cannot be empty');
    }
    this.session.metadata = {
      ...this.session.metadata,
      title,
      isCustomTitle: true,
      updatedAt: new Date().toISOString(),
    };
    await this.session.writeMetadata();
  }

  async updateSessionMetadata(payload: UpdateSessionMetadataPayload): Promise<void> {
    if (Object.prototype.hasOwnProperty.call(payload.metadata, 'sessionFormatVersion')) {
      throw new PythinkerError(
        ErrorCodes.SESSION_STATE_INVALID,
        'sessionFormatVersion cannot be updated',
      );
    }
    this.session.metadata = {
      ...this.session.metadata,
      ...payload.metadata,
      agents: this.session.metadata.agents,
      sessionFormatVersion: this.session.metadata.sessionFormatVersion,
    };
    await this.session.writeMetadata();
  }

  getSessionMetadata(_payload: EmptyPayload): SessionMeta {
    return this.session.metadata;
  }

  listWorkspaceDirectories(_payload: EmptyPayload): readonly WorkspaceDirectory[] {
    return this.session.listWorkspaceDirectories();
  }

  addWorkspaceDirectory(payload: WorkspaceDirectoryPayload): Promise<WorkspaceDirectory> {
    return this.session.addWorkspaceDirectory(payload.path);
  }

  removeWorkspaceDirectory(payload: WorkspaceDirectoryPayload): Promise<void> {
    return this.session.removeWorkspaceDirectory(payload.path);
  }

  listSkills(_payload: EmptyPayload): Promise<readonly SkillSummary[]> {
    return this.session.listSkills();
  }

  listMcpServers(_payload: EmptyPayload): readonly McpServerInfo[] {
    return this.session.mcp.list();
  }

  async getMcpStartupMetrics(_payload: EmptyPayload): Promise<McpStartupMetrics> {
    await this.session.mcp.waitForInitialLoad();
    return { durationMs: this.session.mcp.initialLoadDurationMs() };
  }

  async reconnectMcpServer(payload: ReconnectMcpServerPayload): Promise<void> {
    await this.session.mcp.reconnect(payload.name);
  }

  generateAgentsMd(_payload: EmptyPayload): Promise<void> {
    return this.session.generateAgentsMd();
  }

  refreshInstructions(_payload: EmptyPayload): Promise<void> {
    return this.session.refreshInstructions();
  }

  listWorkingTreeChanges(_payload: EmptyPayload) {
    return this.session.listWorkingTreeChanges();
  }

  getWorkingTreeDiff(payload: WorkingTreeDiffPayload) {
    return this.session.getWorkingTreeDiff(payload.path);
  }

  listFileCheckpoints(_payload: EmptyPayload) {
    return this.session.listFileCheckpoints();
  }

  async previewFileCheckpoint(payload: FileCheckpointIdPayload) {
    return this.session.previewFileCheckpoint(normalizeCheckpointId(payload));
  }

  async restoreFileCheckpoint(payload: FileCheckpointIdPayload) {
    return this.session.restoreFileCheckpoint(normalizeCheckpointId(payload));
  }


  async prompt({ agentId, ...payload }: AgentScopedPayload<PromptPayload>) {
    const prompt = promptMetadataTextFromPayload(payload);
    if (agentId === 'main') {
      await this.updatePromptMetadata(prompt);
    }
    const agent = await this.session.ensureAgentResumed(agentId);
    if (
      agentId !== 'main' ||
      agent.turn.hasActiveTurn ||
      this.session.fileCheckpoints === undefined
    ) {
      return agent.rpcMethods.prompt(payload);
    }
    const checkpointId = await this.session.fileCheckpoints.beginUserCheckpoint(
      prompt ?? 'User prompt',
    );
    agent.setFileCheckpointId(checkpointId);
    agent.turn.prompt(
      payload.input,
      { kind: 'user', checkpointId },
      payload.outputSchema,
    );
  }

  async steer({ agentId, ...payload }: AgentScopedPayload<SteerPayload>) {
    return (await this.getAgent(agentId)).steer(payload);
  }

  async cancel({ agentId, ...payload }: AgentScopedPayload<CancelPayload>) {
    return (await this.getAgent(agentId)).cancel(payload);
  }

  async undoHistory({ agentId, ...payload }: AgentScopedPayload<UndoHistoryPayload>) {
    return (await this.getAgent(agentId)).undoHistory(payload);
  }

  async setModel({ agentId, ...payload }: AgentScopedPayload<SetModelPayload>) {
    return (await this.getAgent(agentId)).setModel(payload);
  }

  async setThinking({ agentId, ...payload }: AgentScopedPayload<SetThinkingPayload>) {
    return (await this.getAgent(agentId)).setThinking(payload);
  }

  async setFastMode({ agentId, ...payload }: AgentScopedPayload<SetFastModePayload>) {
    return (await this.getAgent(agentId)).setFastMode(payload);
  }

  async setPermission({ agentId, ...payload }: AgentScopedPayload<SetPermissionPayload>) {
    return (await this.getAgent(agentId)).setPermission(payload);
  }

  async getModel({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getModel(payload);
  }

  async enterPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).enterPlan(payload);
  }

  async cancelPlan({ agentId, ...payload }: AgentScopedPayload<CancelPlanPayload>) {
    return (await this.getAgent(agentId)).cancelPlan(payload);
  }

  async clearPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearPlan(payload);
  }

  async enterDynamicWorkflow({ agentId, ...payload }: AgentScopedPayload<EnterDynamicWorkflowPayload>) {
    return (await this.getAgent(agentId)).enterDynamicWorkflow(payload);
  }

  async exitDynamicWorkflow({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).exitDynamicWorkflow(payload);
  }

  async getDynamicWorkflowMode({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getDynamicWorkflowMode(payload);
  }

  async beginCompaction({ agentId, ...payload }: AgentScopedPayload<BeginCompactionPayload>) {
    return (await this.getAgent(agentId)).beginCompaction(payload);
  }

  async cancelCompaction({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelCompaction(payload);
  }

  async registerTool({ agentId, ...payload }: AgentScopedPayload<RegisterToolPayload>) {
    return (await this.getAgent(agentId)).registerTool(payload);
  }

  async unregisterTool({ agentId, ...payload }: AgentScopedPayload<UnregisterToolPayload>) {
    return (await this.getAgent(agentId)).unregisterTool(payload);
  }

  async setActiveTools({ agentId, ...payload }: AgentScopedPayload<SetActiveToolsPayload>) {
    return (await this.getAgent(agentId)).setActiveTools(payload);
  }

  async stopBackground({ agentId, ...payload }: AgentScopedPayload<StopBackgroundPayload>) {
    return (await this.getAgent(agentId)).stopBackground(payload);
  }

  async clearContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).clearContext(payload);
  }

  async activateSkill({ agentId, ...payload }: AgentScopedPayload<ActivateSkillPayload>) {
    const prompt = promptMetadataTextFromSkill(payload);
    if (agentId === 'main') {
      await this.updatePromptMetadata(prompt);
    }
    const agent = await this.session.ensureAgentResumed(agentId);
    if (
      agentId === 'main' &&
      !agent.turn.hasActiveTurn &&
      this.session.fileCheckpoints !== undefined
    ) {
      agent.setFileCheckpointId(
        await this.session.fileCheckpoints.beginUserCheckpoint(
          prompt ?? `/${payload.name}`,
        ),
      );
    }
    const mcpPrompt = this.session.mcp.resolvePrompt(payload.name);
    let result;
    if (mcpPrompt === undefined) {
      result = await agent.rpcMethods.activateSkill(payload);
    } else {
      if (mcpPrompt.client.getPrompt === undefined) {
        throw new PythinkerError(
          ErrorCodes.REQUEST_INVALID,
          `MCP server "${mcpPrompt.serverName}" does not support prompts`,
        );
      }
      const values = (payload.args ?? '').split(' ');
      const args = Object.fromEntries(
        (mcpPrompt.prompt.arguments ?? []).flatMap((argument, index) => {
          const value = values[index];
          return value === undefined ? [] : [[argument.name, value]];
        }),
      );
      const messages = await mcpPrompt.client.getPrompt(
        mcpPrompt.prompt.name,
        args,
      );
      const content = messages
        .map((message) => convertMCPContentBlock(message.content))
        .filter((part) => part !== null);
      if (content.length === 0) {
        throw new PythinkerError(
          ErrorCodes.REQUEST_INVALID,
          `MCP prompt "${payload.name}" returned no supported content`,
        );
      }
      if (agent.skills === null) {
        throw new PythinkerError(
          ErrorCodes.SKILL_NOT_FOUND,
          `Skill "${payload.name}" was not found`,
        );
      }
      result = agent.skills.activateMcpPrompt(
        payload,
        content,
        `mcp://${mcpPrompt.serverName}/${mcpPrompt.prompt.name}`,
      );
    }
    return result;
  }

  async startBtw({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>): Promise<string> {
    return (await this.getAgent(agentId)).startBtw(payload);
  }

  async createGoal({ agentId, ...payload }: AgentScopedPayload<CreateGoalPayload>) {
    return (await this.getAgent(agentId)).createGoal(payload);
  }

  async getGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getGoal(payload);
  }

  async pauseGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).pauseGoal(payload);
  }

  async resumeGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).resumeGoal(payload);
  }

  async cancelGoal({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).cancelGoal(payload);
  }

  async getBackgroundOutput({
    agentId,
    ...payload
  }: AgentScopedPayload<GetBackgroundOutputPayload>) {
    return (await this.getAgent(agentId)).getBackgroundOutput(payload);
  }

  async getContext({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getContext(payload);
  }

  async getContextUsage({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getContextUsage(payload);
  }

  async getConfig({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getConfig(payload);
  }

  async getPermission({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPermission(payload);
  }

  async getPlan({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getPlan(payload);
  }

  async getUsage({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getUsage(payload);
  }

  async getTools({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).getTools(payload);
  }

  async listContextFiles({ agentId, ...payload }: AgentScopedPayload<EmptyPayload>) {
    return (await this.getAgent(agentId)).listContextFiles(payload);
  }

  async getBackground({ agentId, ...payload }: AgentScopedPayload<GetBackgroundPayload>) {
    return (await this.getAgent(agentId)).getBackground(payload);
  }

  private async getAgent(agentId: string): Promise<PromisableMethods<AgentAPI>> {
    const agent = await this.session.ensureAgentResumed(agentId);
    return agent.rpcMethods;
  }

  private needUpdateEasyTitle(metadata: SessionMeta): boolean {
    if (hasCustomTitle(metadata)) return false;
    if (!isUntitled(metadata.title)) return false;
    return true;
  }

  private async updatePromptMetadata(lastPrompt: string | undefined): Promise<void> {
    if (lastPrompt === undefined) return;

    const title = this.needUpdateEasyTitle(this.session.metadata)
      ? titleFromPromptMetadataText(lastPrompt)
      : undefined;
    const now = new Date().toISOString();
    const nextMetadata = {
      ...this.session.metadata,
      lastPrompt,
      updatedAt: now,
    };
    if (title !== undefined) {
      nextMetadata.title = title;
      nextMetadata.isCustomTitle = false;
    }

    this.session.metadata = nextMetadata;
    await this.session.writeMetadata();
    await this.session.rpc.emitEvent({
      type: 'session.meta.updated',
      agentId: 'main',
      title,
      patch: {
        title,
        isCustomTitle: title === undefined ? undefined : false,
        lastPrompt,
      },
    });
  }
}

function normalizeCheckpointId(payload: FileCheckpointIdPayload): string {
  const checkpointId = payload.checkpointId.trim();
  if (checkpointId.length === 0) {
    throw new PythinkerError(
      ErrorCodes.REQUEST_INVALID,
      'Checkpoint ID cannot be empty.',
    );
  }
  return checkpointId;
}

function isUntitled(title: unknown): boolean {
  return typeof title !== 'string' || title.trim().length === 0 || title === 'New Session';
}

function hasCustomTitle(metadata: SessionMeta): boolean {
  if (metadata.isCustomTitle) return true;
  return typeof (metadata as SessionMeta & { customTitle?: unknown }).customTitle === 'string';
}
