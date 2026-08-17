import { uniq } from '@antfu/utils';
import type { ChatProvider, Tool } from '@pymodel/kosong';
import picomatch from 'picomatch';

import type { Agent } from '..';
import { makeErrorPayload } from '../../errors';
import type { ExecutableTool } from '../../loop';
import { createMcpAuthTool } from '../../mcp/auth-tool';
import type { McpConnectionManager, McpServerEntry } from '../../mcp';
import { mcpResultToExecutableOutput } from '../../mcp/output';
import { isMcpToolName, qualifyMcpToolName } from '../../mcp/tool-naming';
import type { MCPClient } from '../../mcp/types';
import { extendWorkspaceWithSkillRoots } from '../../skill';
import * as b from '../../tools/builtin';
import { isDynamicWorkflowDisabled } from '../../tools/builtin/collaboration/dynamic-workflow';
import { resolveWorkflowSizeGuideline } from '../dynamic-workflow/size-guideline';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../tools/store';
import type {
  BuiltinTool,
  McpServerRegistrationResult,
  McpToolCollision,
  ToolInfo,
  UserToolRegistration,
} from './types';

export * from './types';

interface McpToolEntry {
  readonly tool: ExecutableTool;
  readonly serverName: string;
}

export class ToolManager {
  protected builtinTools: Map<string, BuiltinTool> = new Map();
  private readonly fileReadState: b.FileReadState = new Map();
  protected readonly userTools: Map<string, ExecutableTool> = new Map();
  protected readonly mcpTools: Map<string, McpToolEntry> = new Map();
  private loopToolsOverride: readonly ExecutableTool[] | undefined;
  /** server name → list of qualified tool names registered for that server. */
  protected readonly mcpToolsByServer: Map<string, string[]> = new Map();
  protected enabledTools: Set<string> = new Set();
  /** Glob patterns (e.g. `mcp__*`, `mcp__github__*`) gating which MCP tools the profile exposes. */
  private mcpAccessPatterns: string[] = [];
  protected readonly store: Partial<ToolStoreData> = {};
  private mcpToolStatusUnsubscribe: (() => void) | undefined;

  constructor(protected readonly agent: Agent) {
    this.attachMcpTools();
    if (agent.config.hasProvider) {
      this.initializeBuiltinTools();
    }
  }

  protected get toolStore(): ToolStore {
    return {
      get: (key) => this.store[key],
      set: (key, value) => {
        this.updateStore(key, value);
      },
    };
  }

  attachMcpTools(): void {
    const mcp = this.agent.mcp;
    if (mcp === undefined) return;
    if (this.mcpToolStatusUnsubscribe !== undefined) return;
    for (const entry of mcp.list()) {
      if (entry.status === 'connected') {
        this.registerConnectedMcpServer(mcp, entry);
      } else if (entry.status === 'needs-auth') {
        this.registerNeedsAuthMcpServer(mcp, entry);
      }
    }
    this.mcpToolStatusUnsubscribe = mcp.onStatusChange((entry) => {
      this.handleMcpServerStatusChange(mcp, entry);
    });
  }

  updateStore<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
    this.agent.records.logRecord({
      type: 'tools.update_store',
      key,
      value,
    });
    this.store[key] = value;
  }

  registerUserTool(input: UserToolRegistration): void {
    const { name, description, parameters } = input;
    if (this.builtinTools.has(name)) {
      throw new Error(`Cannot register user tool "${name}": name collides with builtin tool`);
    }
    if (this.userTools.has(name)) {
      throw new Error(
        `Cannot register user tool "${name}": name collides with already-registered user tool`,
      );
    }
    if (this.mcpTools.has(name)) {
      throw new Error(
        `Cannot register user tool "${name}": name collides with registered MCP tool`,
      );
    }
    this.agent.records.logRecord({
      type: 'tools.register_user_tool',
      ...input,
    });
    const tool: ExecutableTool = {
      name,
      description,
      parameters,
      resolveExecution: (args) => {
        return {
          approvalRule: name,
          execute: async (context) => {
            return this.agent.rpc!.toolCall!(
              {
                turnId: Number(context.turnId),
                toolCallId: context.toolCallId,
                args,
              },
              { signal: context.signal },
            );
          },
        };
      },
    };
    this.userTools.set(name, tool);
    this.enabledTools.add(name);
  }

  unregisterUserTool(name: string): void {
    this.agent.records.logRecord({
      type: 'tools.unregister_user_tool',
      name,
    });
    this.userTools.delete(name);
    this.enabledTools.delete(name);
  }

  inheritUserTools(parent: ToolManager): void {
    for (const tool of parent.userTools.values()) {
      if (!parent.enabledTools.has(tool.name)) continue;
      this.registerUserTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
  }

  registerMcpServer(
    serverName: string,
    client: MCPClient,
    tools: readonly Tool[],
    enabledTools?: ReadonlySet<string>,
  ): McpServerRegistrationResult {
    this.unregisterMcpServer(serverName);
    const qualifiedNames: string[] = [];
    const collisions: McpToolCollision[] = [];
    const seenInThisCall = new Map<string, string>();
    for (const tool of tools) {
      if (enabledTools !== undefined && !enabledTools.has(tool.name)) continue;
      const qualified = qualifyMcpToolName(serverName, tool.name);
      const firstInThisCall = seenInThisCall.get(qualified);
      if (firstInThisCall !== undefined) {
        collisions.push({
          qualified,
          toolName: tool.name,
          collidesWith: { kind: 'same_server', toolName: firstInThisCall },
        });
        continue;
      }
      const collision = this.mcpToolCollision(qualified, tool.name);
      if (collision !== undefined) {
        collisions.push(collision);
        continue;
      }
      seenInThisCall.set(qualified, tool.name);
      const wrapped: ExecutableTool = {
        name: qualified,
        description: tool.description,
        parameters: tool.parameters,
        resolveExecution: (args) => {
          return {
            approvalRule: qualified,
            execute: async (context) => {
              // `args` has already been JSON-parsed and schema-validated by
              // the loop's preflight (`loop/tool-call.ts`), so the MCP
              // client gets a plain object directly.
              const result = await client.callTool(
                tool.name,
                (args ?? {}) as Record<string, unknown>,
                context.signal,
              );
              return mcpResultToExecutableOutput(result, qualified);
            },
          };
        },
      };
      this.mcpTools.set(qualified, { tool: wrapped, serverName });
      qualifiedNames.push(qualified);
    }
    this.mcpToolsByServer.set(serverName, qualifiedNames);
    return { registered: qualifiedNames, collisions };
  }

  private mcpToolCollision(
    qualified: string,
    toolName: string,
  ): McpToolCollision | undefined {
    if (this.builtinTools.has(qualified)) {
      return { qualified, toolName, collidesWith: { kind: 'builtin' } };
    }
    if (this.userTools.has(qualified)) {
      return { qualified, toolName, collidesWith: { kind: 'user' } };
    }
    const existingEntry = this.mcpTools.get(qualified);
    if (existingEntry !== undefined) {
      return {
        qualified,
        toolName,
        collidesWith: { kind: 'other_server', serverName: existingEntry.serverName },
      };
    }
    return undefined;
  }

  unregisterMcpServer(serverName: string): boolean {
    const existing = this.mcpToolsByServer.get(serverName);
    if (existing === undefined) return false;
    for (const qualified of existing) {
      this.mcpTools.delete(qualified);
    }
    this.mcpToolsByServer.delete(serverName);
    return true;
  }

  private handleMcpServerStatusChange(mcp: McpConnectionManager, entry: McpServerEntry): void {
    this.syncMcpResourceTools(mcp);
    if (entry.status === 'connected') {
      this.registerConnectedMcpServer(mcp, entry);
    } else if (entry.status === 'needs-auth') {
      this.registerNeedsAuthMcpServer(mcp, entry);
    } else if (entry.status === 'failed') {
      this.unregisterMcpServer(entry.name);
      this.agent.emitEvent({
        type: 'tool.list.updated',
        reason: 'mcp.failed',
        serverName: entry.name,
      });
    } else if (entry.status === 'disabled' || entry.status === 'pending') {
      const removed = this.unregisterMcpServer(entry.name);
      if (removed) {
        this.agent.emitEvent({
          type: 'tool.list.updated',
          reason: 'mcp.disconnected',
          serverName: entry.name,
        });
      }
    }
  }

  private registerNeedsAuthMcpServer(mcp: McpConnectionManager, entry: McpServerEntry): void {
    // Replace whatever tools (real or synthetic) were registered before; a
    // server flipping to needs-auth means previous tokens were invalidated.
    this.unregisterMcpServer(entry.name);
    const oauthService = mcp.oauthService;
    const serverUrl = mcp.getRemoteServerUrl(entry.name);
    if (oauthService === undefined || serverUrl === undefined) {
      // Misconfiguration: a server reached needs-auth without the manager
      // owning an OAuth service or being remote. Treat it as a no-op so the
      // existing failure error message keeps the user informed.
      return;
    }
    const tool = createMcpAuthTool({
      serverName: entry.name,
      serverUrl,
      oauthService,
      reconnect: async () => {
        await mcp.reconnect(entry.name);
      },
    });
    const collision = this.mcpToolCollision(tool.name, 'authenticate');
    if (collision === undefined) {
      this.mcpTools.set(tool.name, { tool, serverName: entry.name });
      this.mcpToolsByServer.set(entry.name, [tool.name]);
    } else {
      this.mcpToolsByServer.set(entry.name, []);
      this.emitMcpToolCollisions(entry.name, [collision]);
    }
    // Surface the updated tool list the same way a real toolset would show up.
    this.agent.emitEvent({
      type: 'tool.list.updated',
      reason: 'mcp.connected',
      serverName: entry.name,
    });
  }

  private registerConnectedMcpServer(mcp: McpConnectionManager, entry: McpServerEntry): void {
    const resolved = mcp.resolved(entry.name);
    if (resolved === undefined) return;
    const result = this.registerMcpServer(
      entry.name,
      resolved.client,
      resolved.tools,
      resolved.enabledNames,
    );
    this.emitMcpToolCollisions(entry.name, result.collisions);
    this.agent.emitEvent({
      type: 'tool.list.updated',
      reason: 'mcp.connected',
      serverName: entry.name,
    });
  }

  private emitMcpToolCollisions(serverName: string, collisions: readonly McpToolCollision[]): void {
    if (collisions.length === 0) return;
    const summary = collisions
      .map((c) => {
        if (c.collidesWith.kind === 'same_server') {
          return `"${c.toolName}" -> ${c.qualified} (collides with "${c.collidesWith.toolName}" from the same server)`;
        }
        if (c.collidesWith.kind === 'other_server') {
          return `"${c.toolName}" -> ${c.qualified} (collides with server "${c.collidesWith.serverName}")`;
        }
        return `"${c.toolName}" -> ${c.qualified} (collides with ${c.collidesWith.kind} tool)`;
      })
      .join('; ');
    this.agent.emitEvent({
      type: 'error',
      ...makeErrorPayload(
        'mcp.tool_name_collision',
        `MCP server "${serverName}" registered ${collisions.length} tool name` +
          `${collisions.length === 1 ? '' : 's'} ` +
          `that collide with existing tool names; the losing tools were dropped: ${summary}`,
        { details: { serverName, collisions: collisions as readonly unknown[] } },
      ),
    });
  }

  setActiveTools(names: readonly string[]): void {
    this.agent.records.logRecord({
      type: 'tools.set_active_tools',
      names,
    });
    // MCP entries are glob patterns gated separately; the rest are exact
    // builtin/user tool names. The split keeps every caller on one string[].
    this.enabledTools = new Set(names.filter((name) => !isMcpToolName(name)));
    this.mcpAccessPatterns = names.filter((name) => isMcpToolName(name));
  }

  patchActiveTools(input: {
    readonly tools?: readonly string[];
    readonly mcpPatterns?: readonly string[];
  }): void {
    this.setActiveTools([
      ...(input.tools ?? this.enabledTools),
      ...(input.mcpPatterns ?? this.mcpAccessPatterns),
    ]);
  }

  copyLoopToolsFrom(source: ToolManager): void {
    this.loopToolsOverride = source.loopTools;
  }

  private isMcpToolEnabled(name: string): boolean {
    return this.mcpAccessPatterns.some((pattern) => picomatch.isMatch(name, pattern));
  }

  *toolInfos(): Iterable<ToolInfo> {
    for (const tool of this.builtinTools.values()) {
      yield {
        name: tool.name,
        description: tool.description,
        active: this.enabledTools.has(tool.name),
        source: 'builtin',
        inputSchema: tool.parameters,
      };
    }
    for (const tool of this.userTools.values()) {
      yield {
        name: tool.name,
        description: tool.description,
        active: this.enabledTools.has(tool.name),
        source: 'user',
        inputSchema: tool.parameters,
      };
    }
    for (const entry of this.mcpTools.values()) {
      yield {
        name: entry.tool.name,
        description: entry.tool.description,
        active: this.isMcpToolEnabled(entry.tool.name),
        source: 'mcp',
        mcpServerId: entry.serverName,
        inputSchema: entry.tool.parameters,
      };
    }
  }

  data(): readonly ToolInfo[] {
    return Array.from(this.toolInfos());
  }

  getBuiltinTool(name: string): ExecutableTool | undefined {
    return this.builtinTools.get(name);
  }

  getSkillShellTool(shell: unknown): ExecutableTool {
    if (
      shell === 'powershell' &&
      this.agent.kaos.osEnv.osKind === 'Windows' &&
      this.agent.experimentalFlags.enabled('powershell')
    ) {
      return (
        this.getBuiltinTool('PowerShell') ??
        new b.PowerShellTool(this.agent.kaos, this.agent.config.cwd, undefined, {
          allowBackground: false,
        })
      );
    }
    return (
      this.getBuiltinTool('Bash') ??
      new b.BashTool(this.agent.kaos, this.agent.config.cwd, undefined, {
        allowBackground: false,
      })
    );
  }

  contextFiles(): readonly string[] {
    return [...this.fileReadState.keys()].toSorted();
  }

  invalidateFileReadState(paths: readonly string[]): void {
    for (const path of paths) this.fileReadState.delete(path);
  }

  storeData(): Readonly<Record<string, unknown>> {
    return { ...this.store };
  }

  initializeBuiltinTools() {
    const {
      kaos,
      toolServices,
      config: { cwd, provider, modelCapabilities },
      background,
    } = this.agent;
    const videoUploader = this.createVideoUploader(provider);
    const workspace = extendWorkspaceWithSkillRoots(
      {
        workspaceDir: cwd,
        additionalDirs: this.agent.additionalDirs,
      },
      this.agent.skills?.registry.getSkillRoots() ?? [],
    );
    const allowBackground =
      this.enabledTools.has('TaskList') &&
      this.enabledTools.has('TaskOutput') &&
      this.enabledTools.has('TaskStop');
    const goalToolsEnabled = this.agent.type === 'main';
    const mcp = this.agent.mcp;
    const mcpResourcesEnabled = this.hasMcpResourceServer(mcp);
    const taskGraphEnabled =
      this.agent.taskGraph !== undefined &&
      this.agent.experimentalFlags.enabled('task_graph');
    const teamsEnabled =
      this.agent.team !== undefined &&
      this.agent.experimentalFlags.enabled('agent_teams');
    const worktreeEnabled =
      this.agent.type === 'main' &&
      this.agent.worktree !== undefined &&
      this.agent.experimentalFlags.enabled('worktree_mode');
    const powerShellEnabled =
      kaos.osEnv.osKind === 'Windows' &&
      this.agent.experimentalFlags.enabled('powershell');
    const lspEnabled =
      this.agent.lsp !== undefined &&
      this.agent.lsp.hasServers &&
      this.agent.experimentalFlags.enabled('lsp');
    const dynamicWorkflowEnabled = !isDynamicWorkflowDisabled(this.agent.pythinkerConfig);
    const workflowSizeGuideline = resolveWorkflowSizeGuideline(this.agent.pythinkerConfig);
    const builtinTools = new Map(
      [
        new b.ReadTool(kaos, workspace, this.fileReadState),
        new b.WriteTool(
          kaos,
          workspace,
          this.fileReadState,
          (path) => this.agent.captureFileBeforeWrite(path),
        ),
        new b.EditTool(
          kaos,
          workspace,
          this.fileReadState,
          (path) => this.agent.captureFileBeforeWrite(path),
        ),
        new b.NotebookEditTool(
          kaos,
          workspace,
          this.fileReadState,
          (path) => this.agent.captureFileBeforeWrite(path),
        ),
        new b.GrepTool(kaos, workspace),
        new b.GlobTool(kaos, workspace),
        new b.BashTool(kaos, cwd, background, {
          allowBackground,
        }),
        powerShellEnabled &&
          new b.PowerShellTool(kaos, cwd, background, {
            allowBackground,
          }),
        lspEnabled && new b.LspTool(kaos, workspace, this.agent.lsp!),
        (modelCapabilities.image_in || modelCapabilities.video_in) &&
          new b.ReadMediaFileTool(kaos, workspace, modelCapabilities, videoUploader),
        new b.EnterPlanModeTool(this.agent),
        new b.ExitPlanModeTool(this.agent),
        worktreeEnabled && new b.EnterWorktreeTool(this.agent.worktree!, this.agent),
        worktreeEnabled && new b.ExitWorktreeTool(this.agent.worktree!, this.agent),
        // Goal tools are main-agent-only.
        goalToolsEnabled && new b.CreateGoalTool(this.agent),
        goalToolsEnabled && new b.GetGoalTool(this.agent),
        goalToolsEnabled && new b.SetGoalBudgetTool(this.agent),
        goalToolsEnabled && new b.UpdateGoalTool(this.agent),
        mcpResourcesEnabled && mcp && new b.ListMcpResourcesTool(mcp),
        mcpResourcesEnabled && mcp && new b.ReadMcpResourceTool(mcp, kaos),
        this.agent.rpc?.requestQuestion && new b.AskUserQuestionTool(this.agent),
        goalToolsEnabled &&
          toolServices?.configStore &&
          new b.ConfigTool(toolServices.configStore, this.agent),
        new b.TodoListTool(this.toolStore, this.agent.type === 'main'),
        taskGraphEnabled
          ? new b.TaskGraphListTool(this.agent.taskGraph!, background)
          : new b.TaskListTool(background),
        new b.TaskOutputTool(background),
        new b.TaskStopTool(background),
        taskGraphEnabled &&
          new b.TaskCreateTool(this.agent.taskGraph!, this.agent.hooks, this.agent.agentId),
        taskGraphEnabled && new b.TaskGetTool(this.agent.taskGraph!),
        taskGraphEnabled &&
          new b.TaskUpdateTool(
            this.agent.taskGraph!,
            this.agent.team,
            this.agent.agentId,
            this.agent.type === 'main',
            this.agent.hooks,
          ),
        teamsEnabled &&
          this.agent.type === 'main' &&
          new b.TeamCreateTool(this.agent.team!, this.agent.config.modelAlias ?? 'unknown'),
        teamsEnabled && this.agent.type === 'main' && new b.TeamDeleteTool(this.agent.team!),
        teamsEnabled && new b.SendMessageTool(this.agent.team!, this.agent.agentId),
        this.agent.cron && new b.CronCreateTool(this.agent.cron),
        this.agent.cron && new b.CronListTool(this.agent.cron),
        this.agent.cron && new b.CronDeleteTool(this.agent.cron),
        this.agent.skills?.registry.listInvocableSkills().length &&
          new b.SkillTool(this.agent),
        this.agent.subagentHost &&
          new b.AgentTool(
            this.agent.subagentHost,
            allowBackground ? background : undefined,
            this.agent.subagentHost.getProfiles(),
            {
              log: this.agent.log,
              forkContextEnabled: this.agent.experimentalFlags.enabled('agent_fork_context'),
              teamsEnabled,
              team: this.agent.team,
              agentId: this.agent.agentId,
              modelAlias: this.agent.config.modelAlias,
            },
          ),
        this.agent.subagentHost &&
          dynamicWorkflowEnabled &&
          new b.DynamicWorkflowTool(
            this.agent.subagentHost,
            this.agent.dynamicWorkflowMode,
            workflowSizeGuideline,
            (event) => this.agent.emitEvent(event),
          ),
        toolServices?.webSearcher && new b.WebSearchTool(toolServices.webSearcher),
        toolServices?.urlFetcher && new b.FetchURLTool(toolServices.urlFetcher, kaos),
      ]
        .filter((tool) => !!tool)
        .map((tool) => [tool.name, tool] as const),
    );
    for (const name of builtinTools.keys()) {
      this.logBuiltinToolCollision(name);
    }
    this.builtinTools = builtinTools;
  }

  private logBuiltinToolCollision(name: string): void {
    const existing = this.userTools.has(name)
      ? 'user'
      : this.mcpTools.has(name)
        ? 'mcp'
        : undefined;
    if (existing === undefined) return;
    this.agent.log.error('tool name collision', { name, existing, incoming: 'builtin' });
  }

  private hasMcpResourceServer(mcp: McpConnectionManager | undefined): boolean {
    return (
      mcp?.list().some(
        (entry) =>
          entry.status === 'connected' &&
          mcp.resolved(entry.name)?.client.supportsResources?.() === true,
      ) ?? false
    );
  }

  private syncMcpResourceTools(mcp: McpConnectionManager): void {
    if (this.hasMcpResourceServer(mcp)) {
      this.logBuiltinToolCollision('ListMcpResourcesTool');
      this.builtinTools.set('ListMcpResourcesTool', new b.ListMcpResourcesTool(mcp));
      this.logBuiltinToolCollision('ReadMcpResourceTool');
      this.builtinTools.set(
        'ReadMcpResourceTool',
        new b.ReadMcpResourceTool(mcp, this.agent.kaos),
      );
      return;
    }
    this.builtinTools.delete('ListMcpResourcesTool');
    this.builtinTools.delete('ReadMcpResourceTool');
  }

  refreshBuiltinTools(): void {
    this.initializeBuiltinTools();
  }

  private createVideoUploader(provider: ChatProvider): b.VideoUploader | undefined {
    const uploadVideo = provider.uploadVideo?.bind(provider);
    if (uploadVideo === undefined) return undefined;

    const modelAlias = this.agent.config.modelAlias!;
    const withAuth = this.agent.modelProvider?.resolveAuth?.(modelAlias, {
      log: this.agent.log,
    });
    if (withAuth === undefined) return (input) => uploadVideo(input);
    return (input) => withAuth((auth) => uploadVideo(input, { auth }));
  }

  get loopTools(): readonly ExecutableTool[] {
    if (this.loopToolsOverride !== undefined) return this.loopToolsOverride;
    const mcpNames = [...this.mcpTools.keys()].filter((name) => this.isMcpToolEnabled(name));
    // Mutation goal tools are only offered to the model while a goal exists.
    const hideGoalMutationTools = this.agent.goal.getGoal().goal === null;
    return uniq([...this.enabledTools, ...mcpNames])
      .toSorted((a, b) => a.localeCompare(b))
      .filter(
        (name) =>
          !(hideGoalMutationTools && (name === 'SetGoalBudget' || name === 'UpdateGoal')),
      )
      .map(
        (name) =>
          this.userTools.get(name) ??
          this.mcpTools.get(name)?.tool ??
          this.builtinTools.get(name),
      )
      .filter((tool) => !!tool);
  }
}
