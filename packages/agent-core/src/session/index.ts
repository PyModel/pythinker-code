import { homedir } from 'node:os';
import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { join } from 'pathe';
import { z } from 'zod';
import type { Kaos } from '@pymodel/kaos';
import type {
  ElicitRequestParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';

import { ErrorCodes, PythinkerError } from '#/errors';
import { getRootLogger, log } from '#/logging/logger';
import type { Logger, SessionLogHandle } from '#/logging/types';
import type {
  PythinkerConfig,
  SDKSessionRPC,
  SessionFileCheckpointPreview,
  WorkspaceDirectory,
} from '#/rpc';
import { proxyWithExtraPayload } from '#/rpc/types';

import { Agent, type AgentOptions, type AgentType } from '../agent';
import { InMemoryAgentRecordPersistence } from '../agent/records';
import {
  HookEngine,
  renderAsyncHookRewake,
  type HookDef,
  type HookResult,
  type ModelHookDef,
} from './hooks';
import type { PermissionManagerOptions, PermissionRule } from '../agent/permission';
import { parseBooleanEnv, resolveConfigValue, type BackgroundConfig } from '../config';
import { makeErrorPayload } from '../errors';
import {
  McpConnectionManager,
  McpOAuthService,
  mcpUrlStatusId,
  requestMcpFormElicitation,
  requestMcpUrlElicitation,
  type McpServerEntry,
  type SessionMcpConfig,
} from '../mcp';
import type { EnabledPluginSessionStart } from '../plugin';
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_INIT_PROMPT,
  loadAgentsMd,
  prepareSystemPromptContext,
  type OutputStyleConfig,
  type PreparedSystemPromptContext,
  type ResolvedAgentProfile,
} from '../profile';
import type { ProviderManager } from './provider-manager';
import {
  registerBuiltinSkills,
  SessionSkillRegistry,
  resolveSkillRoots,
  summarizeSkill,
  expandSkillParameters,
  type SkillRoot,
  type SkillSummary,
} from '../skill';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import { SessionSubagentHost } from './subagent-host';
import { SessionAdvisor } from './session-advisor';
import type { ToolServices } from '../tools/support/services';
import { FlagResolver, type ExperimentalFlagResolver } from '../flags';
import { abortError } from '../utils/abort';
import { SessionTaskGraph } from '../agent/task-graph';
import { SessionTeam } from './team';
import { SessionWorktree } from './worktree';
import {
  SessionFileCheckpointStore,
  type FileCheckpointSummary,
  type RestoreFileCheckpointResult,
} from './file-checkpoints';
import { LspManager, type LspServerConfigs } from '../lsp';
import { canonicalizePath, isWithinDirectory } from '../tools/policies/path-access';
import {
  listWorkingTreeChanges,
  readWorkingTreeDiff,
  type WorkingTreeChanges,
  type WorkingTreeFileDiff,
} from './working-tree';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const ADDITIONAL_DIRECTORIES_KEY = 'additionalDirectories';
const REMOVED_ADDITIONAL_DIRECTORIES_KEY = 'removedAdditionalDirectories';
const HOOK_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['ok'],
  additionalProperties: false,
} as const;

async function isGitIgnored(kaos: Kaos, candidate: string, cwd: string): Promise<boolean> {
  const relativePath = path.relative(cwd, candidate);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    return false;
  }
  try {
    const proc = await kaos
      .withCwd(cwd)
      .execWithEnv(['git', 'check-ignore', '--quiet', '--', relativePath], {
        ...(process.env as Record<string, string>),
        GIT_TERMINAL_PROMPT: '0',
      });
    proc.stdin.end();
    try {
      return (await proc.wait()) === 0;
    } finally {
      await proc.dispose();
    }
  } catch {
    return false;
  }
}

function resolveFileChangedWatchPaths(
  hooks: readonly HookDef[] | undefined,
  cwd: string,
): string[] {
  return [
    ...new Set(
      (hooks ?? [])
        .filter((hook) => hook.event === 'FileChanged')
        .flatMap((hook) => hook.matcher?.split('|') ?? [])
        .map((filePath) => filePath.trim())
        .filter((filePath) => filePath.length > 0)
        .map((filePath) => (path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath))),
    ),
  ];
}

export interface SessionOptions {
  readonly kaos: Kaos;
  readonly persistenceKaos?: Kaos;
  readonly config?: PythinkerConfig;
  readonly id?: string | undefined;
  readonly homedir: string;
  readonly pythinkerHomeDir?: string;
  readonly rpc: SDKSessionRPC;
  readonly toolServices?: ToolServices;
  readonly initializeMainAgent?: boolean | undefined;
  readonly providerManager?: ProviderManager | undefined;
  readonly background?: BackgroundConfig | undefined;
  readonly hooks?: readonly HookDef[];
  readonly allowedHttpHookUrls?: readonly string[];
  readonly httpHookAllowedEnvVars?: readonly string[];
  readonly permissionRules?: readonly PermissionRule[];
  readonly setupTrigger?: 'init' | 'maintenance';
  readonly skills?: SessionSkillConfig;
  readonly mcpConfig?: SessionMcpConfig;
  readonly telemetry?: TelemetryClient | undefined;
  readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
  readonly appVersion?: string;
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly agentProfiles?: Readonly<Record<string, ResolvedAgentProfile>>;
  readonly lspConfig?: LspServerConfigs;
  readonly outputStyle?: OutputStyleConfig | null;
}

export interface SessionSkillConfig {
  readonly userHomeDir?: string;
  /** Brand data dir (PYTHINKER_CODE_HOME); user brand skills live under `<brandHomeDir>/skills`. */
  readonly brandHomeDir?: string;
  readonly explicitDirs?: readonly string[];
  readonly extraDirs?: readonly string[];
  readonly pluginSkillRoots?: readonly SkillRoot[];
  readonly mergeAllAvailableSkills?: boolean;
  readonly builtinDir?: string;
}

export interface AgentMeta {
  readonly type: AgentType;
  readonly parentAgentId: string | null;
  readonly dynamicWorkflowItem?: string;
}

type AgentEntry = Agent | Promise<Agent>;

export interface CreateAgentOptions {
  readonly profile?: ResolvedAgentProfile;
  readonly parentAgentId?: string;
  readonly dynamicWorkflowItem?: string;
  readonly persistMetadata?: boolean;
}

export interface SessionMeta {
  sessionFormatVersion: typeof SESSION_FORMAT_VERSION;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  title: string;
  isCustomTitle: boolean;
  lastPrompt?: string;
  forkedFrom?: string;
  agents: Record<string, AgentMeta>;
  custom: Record<string, any>;
}

export const SESSION_FORMAT_VERSION = 2;

const AgentMetaSchema = z
  .object({
    type: z.enum(['main', 'sub', 'independent']),
    parentAgentId: z.string().nullable(),
    dynamicWorkflowItem: z.string().optional(),
  })
  .strict();

const SessionMetaSchema = z
  .object({
    sessionFormatVersion: z.literal(SESSION_FORMAT_VERSION),
    archived: z.boolean().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    title: z.string(),
    isCustomTitle: z.boolean(),
    lastPrompt: z.string().optional(),
    forkedFrom: z.string().optional(),
    agents: z.record(z.string(), AgentMetaSchema),
    custom: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseSessionMetadata(input: unknown): SessionMeta {
  if (!isRecord(input)) {
    throw invalidSessionMetadata('Session state metadata must be an object');
  }
  if (input['sessionFormatVersion'] !== SESSION_FORMAT_VERSION) {
    throw invalidSessionMetadata(
      `Unsupported session format version ${String(input['sessionFormatVersion'])}; expected ${SESSION_FORMAT_VERSION}`,
    );
  }
  validateRawPersistedAgentKeys(input);
  const parsed = SessionMetaSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidSessionMetadata(parsed.error.issues[0]?.message ?? 'Session state metadata is invalid');
  }
  validatePersistedAgents(parsed.data.agents);
  return parsed.data as SessionMeta;
}

function validateRawPersistedAgentKeys(input: Record<string, unknown>): void {
  const agents = input['agents'];
  if (isRecord(agents) && Object.hasOwn(agents, '__proto__')) {
    throw invalidSessionMetadata('Session agent id "__proto__" is reserved');
  }
}

function invalidSessionMetadata(message: string): PythinkerError {
  return new PythinkerError(ErrorCodes.SESSION_STATE_INVALID, message);
}

function validatePersistedAgents(agents: Record<string, AgentMeta>): void {
  for (const [id, meta] of Object.entries(agents)) {
    assertSafeAgentId(id);
    if (meta.parentAgentId !== null && !Object.hasOwn(agents, meta.parentAgentId)) {
      throw invalidSessionMetadata(
        `Session agent "${id}" references missing parent "${meta.parentAgentId}"`,
      );
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, chain: readonly string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw invalidSessionMetadata(
        `Session agent parent chain contains a cycle: ${[...chain, id].join(' -> ')}`,
      );
    }
    visiting.add(id);
    const parentAgentId = agents[id]!.parentAgentId;
    if (parentAgentId !== null) visit(parentAgentId, [...chain, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(agents)) visit(id, []);
}

function assertSafeAgentId(id: string): void {
  if (id.length > 0 && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\')) {
    return;
  }
  throw invalidSessionMetadata(`Session agent id "${id}" contains unsupported path characters`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BACKGROUND_KEEP_ALIVE_ON_EXIT_ENV = 'PYTHINKER_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT';
const ACTIVE_TURN_CLOSE_TIMEOUT_MS = 8_000;

async function waitForSettlementOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function elicitationHookResponse(
  results: readonly HookResult[],
): ElicitResult | undefined {
  if (results.some((result) => result.action === 'block')) {
    return { action: 'decline' };
  }
  const response = results.find(
    (result) => result.elicitationResponse !== undefined,
  )?.elicitationResponse;
  return response === undefined
    ? undefined
    : { action: response.action, content: response.content };
}

function promptArgumentHint(
  args: readonly { readonly name: string; readonly required?: boolean }[] | undefined,
): string | undefined {
  if (args === undefined || args.length === 0) return undefined;
  return args
    .map((arg) => (arg.required === true ? `<${arg.name}>` : `[${arg.name}]`))
    .join(' ');
}

export class Session {
  readonly rpc: SDKSessionRPC;
  readonly telemetry: TelemetryClient;
  readonly skills: SessionSkillRegistry;
  readonly agents: Map<string, AgentEntry> = new Map();
  readonly mcp: McpConnectionManager;
  readonly log: Logger;
  private readonly logHandle: SessionLogHandle | undefined;
  readonly hookEngine: HookEngine;
  readonly experimentalFlags: ExperimentalFlagResolver;
  readonly agentProfiles: Readonly<Record<string, ResolvedAgentProfile>>;
  readonly taskGraph: SessionTaskGraph;
  readonly team: SessionTeam;
  readonly worktree: SessionWorktree;
  readonly lsp: LspManager;
  readonly fileCheckpoints: SessionFileCheckpointStore | undefined;
  readonly advisor: SessionAdvisor;
  private fileChangedWatcher?: FSWatcher;
  private readonly fileChangedWatcherReady: Promise<void>;
  private fileChangedWatchCwd: string;
  private dynamicFileChangedWatchPaths: readonly string[] = [];
  private toolKaos: Kaos;
  private persistenceKaos: Kaos;
  private agentIdCounter = 0;
  private readonly skillsReady: Promise<void>;
  metadata: SessionMeta = {
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: 'New Session',
    isCustomTitle: false,
    agents: {},
    custom: {},
  };
  private writeMetadataPromise = Promise.resolve();

  constructor(public readonly options: SessionOptions) {
    // Attach the per-session log sink up front so the constructor's
    // fire-and-forget `loadSkills` / `loadMcpServers` failures (and
    // anything else that races) land in the session log, not just global.
    this.logHandle =
      options.id === undefined
        ? undefined
        : getRootLogger().attachSession({
          sessionId: options.id,
          sessionDir: options.homedir,
        });
    this.log =
      this.logHandle?.logger ??
      (options.id === undefined ? log : log.createChild({ sessionId: options.id }));
    this.advisor = new SessionAdvisor(this);
    this.rpc = options.rpc;
    this.experimentalFlags = options.experimentalFlags ?? new FlagResolver();
    this.agentProfiles = {
      ...DEFAULT_AGENT_PROFILES,
      ...options.agentProfiles,
    };
    this.taskGraph = new SessionTaskGraph(
      options.homedir === undefined ? undefined : join(options.homedir, 'tasks.json'),
    );
    this.team = new SessionTeam(
      this,
      options.homedir === undefined ? undefined : join(options.homedir, 'team.json'),
      this.taskGraph,
    );
    this.worktree = new SessionWorktree(
      options.homedir === undefined ? undefined : join(options.homedir, 'worktree.json'),
    );
    this.lsp = new LspManager(options.kaos, options.kaos.getcwd(), options.lspConfig ?? {});
    this.fileChangedWatchCwd = options.kaos.getcwd();
    this.hookEngine = new HookEngine(options.hooks, {
      cwd: options.kaos.getcwd(),
      sessionId: options.id,
      allowedHttpHookUrls: options.allowedHttpHookUrls,
      httpHookAllowedEnvVars: options.httpHookAllowedEnvVars,
      onAsyncRewake: (event, results) => {
        this.deliverAsyncHookRewake(event, results);
      },
      onStatus: (event, statusId, content, active) => {
        void this.rpc.emitEvent({
          type: 'hook.status',
          agentId: 'main',
          statusId,
          hookEvent: event,
          content,
          active,
        });
      },
      onWatchPaths: (_event, paths) => this.replaceDynamicFileChangedWatchPaths(paths),
      onCwdChanged: (cwd) => this.rebindFileChangedWatchCwd(cwd),
      runModelHook: (hook, event, input, signal) =>
        this.runModelHook(hook, event, input, signal),
    });
    const watchPaths = resolveFileChangedWatchPaths(options.hooks, options.kaos.getcwd());
    this.fileChangedWatcherReady = this.replaceFileChangedWatcher(watchPaths);
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.toolKaos = options.kaos;
    this.persistenceKaos = options.persistenceKaos ?? options.kaos;
    this.fileCheckpoints =
      options.homedir === undefined
        ? undefined
        : new SessionFileCheckpointStore(
            this.toolKaos,
            this.persistenceKaos,
            options.homedir,
            (message, error) => this.log.warn(message, { error }),
          );
    this.skills = new SessionSkillRegistry({
      sessionId: options.id,
      isPathIgnored: (candidate, cwd) =>
        isGitIgnored(this.persistenceKaos, candidate, cwd),
    });
    this.mcp = new McpConnectionManager({
      oauthService: new McpOAuthService({ pythinkerHomeDir: options.pythinkerHomeDir }),
      log: this.log,
      elicitationHandler: (serverName, params, requestId, signal) =>
        this.handleMcpElicitation(serverName, params, requestId, signal),
      elicitationCompletionHandler: (serverName, elicitationId) => {
        this.handleMcpElicitationComplete(serverName, elicitationId);
      },
    });
    this.mcp.onStatusChange((entry) => {
      this.onMcpServerStatusChange(entry);
    });
    this.skillsReady = this.loadSkills()
      .catch((error: unknown) => {
        this.log.error('skills load failed', error);
      })
      .then(() => {
        this.refreshAgentBuiltinTools();
      });
    void this.loadMcpServers().catch((error: unknown) => {
      this.emitInitialMcpLoadError(error);
    });
  }


  setToolKaos(kaos: Kaos) {
    this.toolKaos = kaos;
    this.fileCheckpoints?.setToolKaos(kaos);
    for (const agent of this.readyAgents()) {
      agent.setKaos(kaos.withCwd(agent.config.cwd));
    }
    this.refreshAgentBuiltinTools();
  }

  /**
   * Kaos used by session-internal bootstrap (AGENTS.md context, cwd listing)
   * and metadata persistence. Always backed by the persistence sink (typically
   * the local filesystem) so a transient ACP-side failure on system files like
   * `AGENTS.md` never blocks `bootstrapAgentProfile` — tool calls still route
   * through `agent.kaos` and continue to honor the ACP bridge.
   */
  systemContextKaos(cwd: string): Kaos {
    return this.persistenceKaos.withCwd(cwd);
  }

  async createMain() {
    await this.fileChangedWatcherReady;
    await this.triggerSetup();
    const { agent } = await this.createAgent({ type: 'main' }, {
      profile: this.mainProfile(),
    });
    await this.triggerSessionStart('startup');
    return agent;
  }

  async resume(): Promise<void> {
    await this.fileChangedWatcherReady;
    await this.skillsReady;
    await this.triggerSetup();
    this.log.info('session resume', { app_version: this.options.appVersion });
    const { agents } = await this.readMetadata();
    this.agents.clear();
    // Only the main agent is needed to reopen the session; subagents replay
    // lazily when an RPC or Agent(resume=...) call asks for their state.
    if (agents['main'] !== undefined) {
      await this.resumeAgent('main');
    }
    // A session migrated from an external tool ships a wire without the
    // `config.update` bootstrap events a natively-created agent writes, so the
    // main agent comes back with an empty system prompt and no tools. Apply the
    // default profile so the resumed session is usable. Native sessions always
    // replay a non-empty system prompt and never enter this branch.
    const main = this.getReadyAgent('main');
    const profile = this.mainProfile();
    if (main !== undefined && profile !== undefined && main.config.systemPrompt === '') {
      await this.bootstrapAgentProfile(main, profile, 'session_start');
    }
    await this.triggerSessionStart('resume');
  }

  async close(): Promise<void> {
    try {
      await this.closeFileChangedWatcher();
      await Promise.allSettled(
        Array.from(this.readyAgents(), async (agent) => agent.cron?.stop()),
      );
      await this.cancelActiveTurnsOnClose();
      await this.stopBackgroundTasksOnExit();
      await this.flushMetadata();
      await this.triggerSessionEnd('exit');
    } finally {
      try {
        await this.lsp.shutdown();
        await this.mcp.shutdown();
      } finally {
        await this.logHandle?.close();
      }
    }
  }

  async closeForReload(): Promise<void> {
    try {
      await this.closeFileChangedWatcher();
      await Promise.allSettled(
        Array.from(this.readyAgents(), async (agent) => agent.cron?.stop()),
      );
      await this.flushMetadata();
    } finally {
      try {
        await this.lsp.shutdown();
        await this.mcp.shutdown();
      } finally {
        await this.logHandle?.close();
      }
    }
  }

  private async cancelActiveTurnsOnClose(): Promise<void> {
    const backgroundAgentIds = this.activeBackgroundAgentIds();
    const cancellations: Array<Promise<void>> = [];
    for (const [agentId, entry] of this.agents) {
      if (!(entry instanceof Agent) || backgroundAgentIds.has(agentId)) continue;
      cancellations.push(this.cancelAgentTurnOnClose(entry));
    }
    await Promise.allSettled(cancellations);
  }

  private async closeFileChangedWatcher(): Promise<void> {
    await this.fileChangedWatcher?.close().catch((error) => {
      this.log.warn('file-change hook watcher close failed', { error });
    });
  }

  private async replaceDynamicFileChangedWatchPaths(paths: readonly string[]): Promise<void> {
    this.dynamicFileChangedWatchPaths = [
      ...new Set(paths.filter((filePath) => path.isAbsolute(filePath))),
    ];
    await this.replaceFileChangedWatcher([
      ...resolveFileChangedWatchPaths(this.options.hooks, this.fileChangedWatchCwd),
      ...this.dynamicFileChangedWatchPaths,
    ]);
  }

  private async rebindFileChangedWatchCwd(cwd: string): Promise<void> {
    this.fileChangedWatchCwd = cwd;
    await this.replaceFileChangedWatcher([
      ...resolveFileChangedWatchPaths(this.options.hooks, cwd),
      ...this.dynamicFileChangedWatchPaths,
    ]);
  }

  private async replaceFileChangedWatcher(paths: readonly string[]): Promise<void> {
    await this.fileChangedWatcher?.close();
    this.fileChangedWatcher = undefined;
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;

    const watcher = watch(uniquePaths, {
      persistent: false,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
      ignorePermissionErrors: true,
    });
    this.fileChangedWatcher = watcher;
    watcher.on('all', (event, filePath) => {
      if (event !== 'add' && event !== 'change' && event !== 'unlink') return;
      void this.hookEngine.fireAndForgetTrigger('FileChanged', {
        inputData: { filePath, event },
      });
    });
    await new Promise<void>((resolve) => {
      watcher.once('ready', resolve);
      watcher.once('error', () => resolve());
    });
  }

  private activeBackgroundAgentIds(): Set<string> {
    const agentIds = new Set<string>();
    for (const agent of this.readyAgents()) {
      for (const task of agent.background.list(true)) {
        if (task.kind === 'agent' && task.agentId !== undefined) {
          agentIds.add(task.agentId);
        }
      }
    }
    return agentIds;
  }

  private async cancelAgentTurnOnClose(agent: Agent): Promise<void> {
    if (!agent.turn.hasActiveTurn) return;

    let waitForTurn: Promise<unknown>;
    try {
      waitForTurn = agent.turn.waitForCurrentTurn();
    } catch (error: unknown) {
      this.log.debug('active turn wait unavailable during session close', {
        agentType: agent.type,
        agentHomedir: agent.homedir,
        error,
      });
      return;
    }

    agent.turn.cancel(undefined, abortError('Session closed'));
    const settled = await waitForSettlementOrTimeout(waitForTurn, ACTIVE_TURN_CLOSE_TIMEOUT_MS);
    if (!settled) {
      this.log.warn('timed out waiting for active turn to cancel during session close', {
        agentType: agent.type,
        agentHomedir: agent.homedir,
        timeoutMs: ACTIVE_TURN_CLOSE_TIMEOUT_MS,
      });
    }
  }

  private async stopBackgroundTasksOnExit(): Promise<void> {
    const keepAliveOnExit = resolveConfigValue({
      env: process.env,
      envKey: BACKGROUND_KEEP_ALIVE_ON_EXIT_ENV,
      configValue: this.options.background?.keepAliveOnExit,
      defaultValue: false,
      parseEnv: parseBooleanEnv,
    });
    if (keepAliveOnExit) return;
    await Promise.all(
      Array.from(this.readyAgents(), async (agent) => {
        const activeTasks = agent.background.list(true);
        await Promise.all(
          activeTasks.map((task) =>
            agent.background.suppressTerminalNotification(task.taskId),
          ),
        );
        await agent.background.stopAll('Session closed');
      }),
    );
  }

  async createAgent(
    config: Partial<AgentOptions>,
    options: CreateAgentOptions = {},
  ): Promise<{ readonly id: string; readonly agent: Agent }> {
    await this.skillsReady;
    const type = config.type ?? 'main';
    const id = type === 'main' ? 'main' : this.nextGeneratedAgentId();
    const homedir = this.agentDir(id);
    const parentAgentId = options.parentAgentId ?? null;
    const agent = this.instantiateAgent(id, homedir, type, config, parentAgentId);
    if (options.profile) {
      await this.bootstrapAgentProfile(
        agent,
        options.profile,
        type === 'main' ? 'session_start' : undefined,
      );
    }

    this.agents.set(id, agent);
    if (options.persistMetadata !== false) {
      this.metadata.agents[id] = {
        type,
        parentAgentId,
        dynamicWorkflowItem: options.dynamicWorkflowItem,
      };
      void this.writeMetadata();
    }

    return { id, agent };
  }

  async ensureAgentResumed(id: string): Promise<Agent> {
    const entry = this.agents.get(id);
    if (entry !== undefined) return this.resolveAgentEntry(entry);
    if (this.metadata.agents[id] === undefined) {
      throw new PythinkerError(ErrorCodes.AGENT_NOT_FOUND, `Agent "${id}" was not found`);
    }
    return this.resumeAgent(id);
  }

  async refreshInstructions(loadReason?: 'compact'): Promise<void> {
    const agent = await this.ensureAgentResumed('main');
    const profile =
      this.agentProfiles[agent.config.profileName ?? 'agent'] ??
      DEFAULT_AGENT_PROFILES['agent'];
    if (profile === undefined) throw new Error('Main agent profile was not found');
    await this.bootstrapAgentProfile(agent, profile, loadReason);
    agent.context.appendSystemReminder('The applicable AGENTS.md instructions were refreshed.', {
      kind: 'system_trigger',
      name: 'instructions',
    });
  }

  private mainProfile(): ResolvedAgentProfile {
    const name = this.experimentalFlags.enabled('coordinator_mode') ? 'coordinator' : 'agent';
    const profile = this.agentProfiles[name];
    if (profile === undefined) throw new Error(`Main agent profile "${name}" was not found`);
    return profile;
  }

  async listWorkingTreeChanges(): Promise<WorkingTreeChanges> {
    const agent = await this.ensureAgentResumed('main');
    return listWorkingTreeChanges(agent.kaos, agent.config.cwd);
  }

  async getWorkingTreeDiff(path: string): Promise<WorkingTreeFileDiff> {
    const agent = await this.ensureAgentResumed('main');
    return readWorkingTreeDiff(agent.kaos, agent.config.cwd, path);
  }

  listFileCheckpoints(): Promise<readonly FileCheckpointSummary[]> {
    return this.requireFileCheckpoints().list();
  }

  async previewFileCheckpoint(
    checkpointId: string,
  ): Promise<SessionFileCheckpointPreview> {
    const [preview, agent] = await Promise.all([
      this.requireFileCheckpoints().preview(checkpointId),
      this.ensureAgentResumed('main'),
    ]);
    return {
      ...preview,
      conversationAvailable: checkpointInActiveConversation(agent, checkpointId),
    };
  }

  async restoreFileCheckpoint(
    checkpointId: string,
  ): Promise<RestoreFileCheckpointResult> {
    const result = await this.requireFileCheckpoints().restore(checkpointId);
    const paths = [...result.restoredPaths, ...result.deletedPaths];
    for (const agent of this.readyAgents()) {
      agent.tools.invalidateFileReadState(paths);
    }
    return result;
  }

  private requireFileCheckpoints(): SessionFileCheckpointStore {
    if (this.fileCheckpoints === undefined) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        'File checkpoints are unavailable for this session.',
      );
    }
    return this.fileCheckpoints;
  }

  /**
   * Applies a profile's derived config — cwd, system prompt, active tools — to
   * an agent. Fresh creation and resume-of-an-incomplete-wire both route
   * through here so the two paths cannot drift apart.
   */
  private async bootstrapAgentProfile(
    agent: Agent,
    profile: ResolvedAgentProfile,
    instructionsLoadReason?: 'session_start' | 'compact',
  ): Promise<void> {
    const context = await this.prepareAgentProfileContext(agent, profile, instructionsLoadReason);
    agent.useProfile(
      profile,
      context,
      agent.type === 'main' ? (this.options.outputStyle ?? undefined) : undefined,
    );
  }

  /**
   * Builds the render context for one agent's profile. `InstructionsLoaded`
   * fires only when a load reason is given, so a caller that is merely
   * re-rendering an existing prompt does not replay a session-start hook.
   */
  private async prepareAgentProfileContext(
    agent: Agent,
    profile: ResolvedAgentProfile,
    instructionsLoadReason?: 'session_start' | 'compact',
  ): Promise<PreparedSystemPromptContext> {
    const memory =
      agent.experimentalFlags.enabled('agent_memory') && profile.memory !== undefined
        ? { name: profile.name, scope: profile.memory }
        : agent.experimentalFlags.enabled('agent_memory') && agent.type === 'main'
          ? { name: 'agent', scope: 'project' as const }
          : undefined;
    return prepareSystemPromptContext(
      this.systemContextKaos(agent.kaos.getcwd()),
      this.options.pythinkerHomeDir,
      memory,
      agent.type === 'main',
      agent.type === 'main' && instructionsLoadReason !== undefined
        ? (filePath, memoryType) => {
            void this.hookEngine.fireAndForgetTrigger('InstructionsLoaded', {
              matcherValue: instructionsLoadReason,
              inputData: {
                agentId: agent.agentId,
                filePath,
                memoryType,
                loadReason: instructionsLoadReason,
              },
            });
          }
        : undefined,
    );
  }

  listWorkspaceDirectories(): readonly WorkspaceDirectory[] {
    const removed = this.metadataDirectories(REMOVED_ADDITIONAL_DIRECTORIES_KEY);
    const result: WorkspaceDirectory[] = [];
    for (const directory of this.configuredWorkspaceDirectories()) {
      if (removed.some((candidate) => this.sameDirectory(candidate, directory))) continue;
      this.pushWorkspaceDirectory(result, { path: directory, source: 'user' });
    }
    for (const directory of this.metadataDirectories(ADDITIONAL_DIRECTORIES_KEY)) {
      this.pushWorkspaceDirectory(result, { path: directory, source: 'session' });
    }
    return result;
  }

  async addWorkspaceDirectory(input: string): Promise<WorkspaceDirectory> {
    const directory = this.canonicalWorkspaceDirectory(input);
    let stat;
    try {
      stat = await this.toolKaos.stat(directory);
    } catch (error) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `Directory "${directory}" was not found or cannot be accessed`,
        { cause: error },
      );
    }
    if ((stat.stMode & S_IFMT) !== S_IFDIR) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `"${directory}" is not a directory`,
      );
    }

    const primary = this.canonicalWorkspaceDirectory(
      this.getReadyAgent('main')?.config.cwd ?? this.toolKaos.getcwd(),
    );
    if (
      isWithinDirectory(directory, primary, this.toolKaos.pathClass()) ||
      this.listWorkspaceDirectories().some((entry) =>
        isWithinDirectory(directory, entry.path, this.toolKaos.pathClass()),
      )
    ) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `"${directory}" is already accessible within the workspace`,
      );
    }

    const configured = this.configuredWorkspaceDirectories().find((candidate) =>
      this.sameDirectory(candidate, directory),
    );
    if (configured !== undefined) {
      this.setMetadataDirectories(
        REMOVED_ADDITIONAL_DIRECTORIES_KEY,
        this.metadataDirectories(REMOVED_ADDITIONAL_DIRECTORIES_KEY).filter(
          (candidate) => !this.sameDirectory(candidate, configured),
        ),
      );
      await this.writeMetadata();
      this.refreshWorkspaceDirectories(`Workspace directory restored: ${JSON.stringify(directory)}.`);
      return { path: directory, source: 'user' };
    }

    this.setMetadataDirectories(ADDITIONAL_DIRECTORIES_KEY, [
      ...this.metadataDirectories(ADDITIONAL_DIRECTORIES_KEY),
      directory,
    ]);
    await this.writeMetadata();
    this.refreshWorkspaceDirectories(`Workspace directory added: ${JSON.stringify(directory)}.`);
    return { path: directory, source: 'session' };
  }

  async removeWorkspaceDirectory(input: string): Promise<void> {
    const directory = this.canonicalWorkspaceDirectory(input);
    const sessionDirectories = this.metadataDirectories(ADDITIONAL_DIRECTORIES_KEY);
    const sessionDirectory = sessionDirectories.find((candidate) =>
      this.sameDirectory(candidate, directory),
    );
    if (sessionDirectory === undefined) {
      const configured = this.configuredWorkspaceDirectories().find((candidate) =>
        this.sameDirectory(candidate, directory),
      );
      if (configured === undefined) {
        throw new PythinkerError(
          ErrorCodes.REQUEST_INVALID,
          `Workspace directory "${directory}" is not active`,
        );
      }
      this.setMetadataDirectories(REMOVED_ADDITIONAL_DIRECTORIES_KEY, [
        ...this.metadataDirectories(REMOVED_ADDITIONAL_DIRECTORIES_KEY),
        configured,
      ]);
    } else {
      this.setMetadataDirectories(
        ADDITIONAL_DIRECTORIES_KEY,
        sessionDirectories.filter((candidate) => !this.sameDirectory(candidate, directory)),
      );
    }
    await this.writeMetadata();
    this.refreshWorkspaceDirectories(`Workspace directory removed: ${JSON.stringify(directory)}.`);
  }

  private configuredWorkspaceDirectories(): readonly string[] {
    const result: string[] = [];
    for (const input of this.options.config?.additionalDirs ?? []) {
      const directory = this.canonicalWorkspaceDirectory(input);
      if (!result.some((candidate) => this.sameDirectory(candidate, directory))) {
        result.push(directory);
      }
    }
    return result;
  }

  private metadataDirectories(key: string): readonly string[] {
    const value = this.metadata.custom[key];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  private setMetadataDirectories(key: string, directories: readonly string[]): void {
    this.metadata = {
      ...this.metadata,
      custom: {
        ...this.metadata.custom,
        [key]: [...directories],
      },
    };
  }

  private canonicalWorkspaceDirectory(input: string): string {
    const trimmed = input.trim();
    const pathClass = this.toolKaos.pathClass();
    const pathApi = pathClass === 'win32' ? path.win32 : path.posix;
    const expanded =
      trimmed === '~'
        ? this.toolKaos.gethome()
        : trimmed.startsWith('~/') || (pathClass === 'win32' && trimmed.startsWith('~\\'))
          ? pathApi.join(this.toolKaos.gethome(), trimmed.slice(2))
          : trimmed;
    try {
      return canonicalizePath(expanded, this.options.kaos.getcwd(), pathClass);
    } catch (error) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        error instanceof Error ? error.message : 'Workspace directory path is invalid',
        { cause: error },
      );
    }
  }

  private sameDirectory(left: string, right: string): boolean {
    return (
      isWithinDirectory(left, right, this.toolKaos.pathClass()) &&
      isWithinDirectory(right, left, this.toolKaos.pathClass())
    );
  }

  private pushWorkspaceDirectory(
    directories: WorkspaceDirectory[],
    entry: WorkspaceDirectory,
  ): void {
    if (!directories.some((candidate) => this.sameDirectory(candidate.path, entry.path))) {
      directories.push(entry);
    }
  }

  private refreshWorkspaceDirectories(reminder: string): void {
    const directories = this.listWorkspaceDirectories().map((entry) => entry.path);
    for (const agent of this.readyAgents()) {
      agent.setAdditionalDirs(directories);
      agent.context.appendSystemReminder(reminder, {
        kind: 'system_trigger',
        name: 'workspace',
      });
    }
  }

  async generateAgentsMd(): Promise<void> {
    await this.hookEngine.trigger('Setup', {
      matcherValue: 'init',
      inputData: { agentId: 'main', trigger: 'init' },
    });
    await this.skillsReady;
    const mainAgent = this.requireMainAgent();

    try {
      const handle = await mainAgent.subagentHost!.spawn({
        profileName: 'coder',
        parentToolCallId: 'generate-agents-md',
        prompt: DEFAULT_INIT_PROMPT,
        description: 'Initialize AGENTS.md',
        runInBackground: false,
        signal: new AbortController().signal,
      });
      await handle.completion;

      const agentsMd = await loadAgentsMd(mainAgent.kaos, this.options.pythinkerHomeDir);
      mainAgent.context.appendSystemReminder(initCompletionReminder(agentsMd), {
        kind: 'injection',
        variant: 'init',
      });
      await mainAgent.records.flush();
    } catch (error) {
      throw new PythinkerError(
        ErrorCodes.SESSION_INIT_FAILED,
        error instanceof Error ? error.message : 'Init failed',
        { cause: error },
      );
    }
  }

  get hasActiveTurn(): boolean {
    for (const agent of this.readyAgents()) {
      if (agent.turn.hasActiveTurn) return true;
    }
    return false;
  }

  protected get metadataPath() {
    return join(this.options.homedir, 'state.json');
  }

  writeMetadata() {
    const text = JSON.stringify(this.metadata, null, 2);
    const write = async () => {
      await this.persistenceKaos.mkdir(this.options.homedir, { parents: true, existOk: true });
      await this.persistenceKaos.writeText(this.metadataPath, text);
    };
    this.writeMetadataPromise = this.writeMetadataPromise.then(write, write);
    return this.writeMetadataPromise;
  }

  async readMetadata(): Promise<SessionMeta> {
    try {
      const text = await this.persistenceKaos.readText(this.metadataPath);
      const metadata = parseSessionMetadata(JSON.parse(text));
      this.metadata = metadata;
      return metadata;
    } catch (error) {
      throw new PythinkerError(
        ErrorCodes.SESSION_INIT_FAILED,
        error instanceof Error ? error.message : 'Session state metadata is invalid',
        { cause: error },
      );
    }
  }

  async flushMetadata() {
    await this.skillsReady;
    await this.writeMetadataPromise;
    await Promise.all(Array.from(this.readyAgents()).map((agent) => agent.records.flush()));
  }

  async listSkills(): Promise<readonly SkillSummary[]> {
    await this.skillsReady;
    return [
      ...this.skills.listSkills().map(summarizeSkill),
      ...this.mcp.listPrompts().map(({ serverName, qualifiedName, prompt }) => ({
        name: qualifiedName,
        commandName: qualifiedName,
        description: prompt.description ?? '',
        path: `mcp://${serverName}/${prompt.name}`,
        source: 'extra' as const,
        type: 'prompt',
        disableModelInvocation: true,
        userInvocable: true,
        argumentHint: promptArgumentHint(prompt.arguments),
      })),
    ];
  }

  /**
   * Re-discovers skills from disk and replaces the registry entries.
   *
   * A skill written while the session is open — `/workflow save`, an edited
   * `SKILL.md` — is otherwise invisible until the session is reloaded, because
   * the registry is built once at construction. `loadRoots` registers with
   * `replace: true`, so re-running is idempotent for skills that already exist
   * and additive for new ones. A skill deleted from disk stays until the
   * session reloads; nothing needs its removal yet.
   */
  async reloadSkills(): Promise<void> {
    await this.skillsReady;
    await this.loadSkills();
    // The tool reads the registry as it runs, so it sees the new skill at once.
    // The model does not: the skill listing is rendered into the system prompt
    // when the profile is applied, so a workflow saved mid-session would stay
    // off the list the model reads until the session reloaded.
    const main = this.getReadyAgent('main');
    const profile = main?.activeProfile;
    if (main === undefined || profile === undefined) return;
    main.refreshSystemPrompt(
      profile,
      await this.prepareAgentProfileContext(main, profile),
      this.options.outputStyle ?? undefined,
    );
  }

  private async loadSkills(): Promise<void> {
    const roots = await resolveSkillRoots({
      paths: {
        userHomeDir: this.options.skills?.userHomeDir ?? homedir(),
        brandHomeDir: this.options.skills?.brandHomeDir ?? this.options.pythinkerHomeDir,
        workDir: this.options.kaos.getcwd(),
      },
      explicitDirs: this.options.skills?.explicitDirs,
      extraDirs: this.options.skills?.extraDirs,
      pluginSkillRoots: this.options.skills?.pluginSkillRoots,
      mergeAllAvailableSkills: this.options.skills?.mergeAllAvailableSkills,
      builtinDir: this.options.skills?.builtinDir,
    });
    await this.skills.loadRoots(roots);
    registerBuiltinSkills(this.skills);
  }

  private async loadMcpServers(): Promise<void> {
    const servers = this.options.mcpConfig?.servers;
    if (servers === undefined || Object.keys(servers).length === 0) return;
    await this.mcp.connectAll(servers);
    const entries = this.mcp.list().filter((entry) => entry.status !== 'disabled');
    const totalCount = entries.length;
    if (totalCount === 0) return;

    const connectedCount = entries.filter((entry) => entry.status === 'connected').length;
    if (connectedCount > 0) {
      this.telemetry.track('mcp_connected', {
        server_count: connectedCount,
        total_count: totalCount,
      });
    }

    const failedCount = entries.filter((entry) => entry.status === 'failed').length;
    if (failedCount > 0) {
      this.telemetry.track('mcp_failed', {
        failed_count: failedCount,
        total_count: totalCount,
      });
    }
  }

  private async handleMcpElicitation(
    serverName: string,
    params: ElicitRequestParams,
    requestId: string | number,
    signal: AbortSignal,
  ): Promise<ElicitResult> {
    const mode = params.mode === 'url' ? 'url' : 'form';
    const before = await this.hookEngine.trigger('Elicitation', {
      matcherValue: serverName,
      inputData: {
        agentId: 'main',
        mcpServerName: serverName,
        message: params.message,
        requestedSchema: params.mode === 'url' ? undefined : params.requestedSchema,
        mode,
        url: params.mode === 'url' ? params.url : undefined,
        elicitationId: params.mode === 'url' ? params.elicitationId : undefined,
      },
      signal,
    });
    const hookAnswer = elicitationHookResponse(before);
    const answer =
      hookAnswer ??
      (params.mode === 'url'
        ? await requestMcpUrlElicitation(serverName, params, requestId, signal, this.rpc)
        : await requestMcpFormElicitation(serverName, params, requestId, signal, this.rpc));
    const after = await this.hookEngine.trigger('ElicitationResult', {
      matcherValue: serverName,
      inputData: {
        agentId: 'main',
        mcpServerName: serverName,
        action: answer.action,
        content: answer.content,
        mode,
        elicitationId: params.mode === 'url' ? params.elicitationId : undefined,
      },
      signal,
    });
    return elicitationHookResponse(after) ?? answer;
  }

  private handleMcpElicitationComplete(serverName: string, elicitationId: string): void {
    void this.rpc.emitEvent({
      type: 'hook.status',
      agentId: 'main',
      statusId: mcpUrlStatusId(serverName, elicitationId),
      hookEvent: 'Elicitation',
      content: `MCP server "${serverName}" confirmed URL completion.`,
      active: false,
    });
    void this.hookEngine.fireAndForgetTrigger('Notification', {
      matcherValue: 'elicitation_complete',
      inputData: {
        agentId: 'main',
        mcpServerName: serverName,
        notificationType: 'elicitation_complete',
        elicitationId,
      },
    });
  }

  private emitInitialMcpLoadError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error('mcp initial load failed', error);
    void this.rpc.emitEvent({
      type: 'error',
      agentId: 'main',
      ...makeErrorPayload(ErrorCodes.MCP_STARTUP_FAILED, message),
    });
  }

  private onMcpServerStatusChange(entry: McpServerEntry): void {
    // Always surface server-level status changes to clients so the TUI/SDK
    // can keep its dashboard in sync, even before the main agent exists.
    void this.rpc.emitEvent({
      type: 'mcp.server.status',
      agentId: 'main',
      server: {
        name: entry.name,
        transport: entry.transport,
        status: entry.status,
        toolCount: entry.toolCount,
        error: entry.error,
      },
    });
  }

  private refreshAgentBuiltinTools(): void {
    for (const agent of this.readyAgents()) {
      if (!agent.config.hasProvider) continue;
      agent.tools.initializeBuiltinTools();
    }
  }

  private instantiateAgent(
    id: string,
    homedir: string,
    type: AgentType,
    config: Partial<AgentOptions> = {},
    parentAgentId: string | null = null,
  ): Agent {
    const parentAgent = parentAgentId !== null ? this.getReadyAgent(parentAgentId) : undefined;
    const cwd = parentAgent?.config.cwd ?? this.toolKaos.getcwd();
    const agent = new Agent({
      ...config,
      type,
      kaos: this.toolKaos.withCwd(cwd),
      toolServices: this.options.toolServices,
      config: this.options.config,
      homedir,
      skills: this.skills,
      rpc: proxyWithExtraPayload(this.rpc, { agentId: id }),
      modelProvider: this.options.providerManager,
      hookEngine: config.hookEngine ?? this.hookEngine,
      subagentHost: config.subagentHost ?? new SessionSubagentHost(this, id),
      mcp: this.mcp,
      permission: this.permissionOptions(parentAgentId, config.permission),
      telemetry: this.telemetry,
      log: this.log.createChild({ agentId: id }),
      pluginSessionStarts: type === 'main' ? this.options.pluginSessionStarts : undefined,
      experimentalFlags: this.experimentalFlags,
      taskGraph: this.taskGraph,
      team: this.team,
      onAfterCompaction:
        config.onAfterCompaction ??
        (type === 'main' ? () => this.refreshInstructions('compact') : undefined),
      agentId: id,
      worktree: this.worktree,
      lsp: this.lsp,
      additionalDirs: this.listWorkspaceDirectories().map((entry) => entry.path),
      fileCheckpoints: this.fileCheckpoints,
      onEvent:
        id === 'main'
          ? (event) => {
              if (event.type === 'turn.started') {
                this.advisor.onMainTurnStarted(event.origin);
              } else if (event.type === 'turn.ended' && event.reason === 'completed') {
                this.advisor.onMainTurnEnded();
              }
            }
          : undefined,
    });
    agent.setFileCheckpointId(parentAgent?.fileCheckpointId);
    return agent;
  }

  private permissionOptions(
    parentAgentId: string | null,
    input?: PermissionManagerOptions | undefined,
  ): PermissionManagerOptions {
    if (parentAgentId === null) {
      return {
        ...input,
        initialRules: input?.initialRules ?? this.options.permissionRules,
      };
    }
    return {
      ...input,
      parent: input?.parent ?? this.getReadyAgent(parentAgentId)?.permission,
    };
  }

  getReadyAgent(id: string): Agent | undefined {
    const entry = this.agents.get(id);
    return entry instanceof Agent ? entry : undefined;
  }

  *readyAgents(): Iterable<Agent> {
    for (const entry of this.agents.values()) {
      if (entry instanceof Agent) yield entry;
    }
  }

  private async resolveAgentEntry(entry: AgentEntry): Promise<Agent> {
    if (entry instanceof Agent) return entry;
    return entry;
  }

  private resumeAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<Agent> {
    if (stack.includes(id)) {
      throw new PythinkerError(
        ErrorCodes.SESSION_STATE_INVALID,
        `Session agent parent chain contains a cycle: ${[...stack, id].join(' -> ')}`,
      );
    }

    const entry = this.agents.get(id);
    if (entry !== undefined) return this.resolveAgentEntry(entry);

    const promise = this.resumePersistedAgent(id, stack);
    this.agents.set(id, promise);
    return promise;
  }

  private async resumePersistedAgent(
    id: string,
    stack: readonly string[] = [],
  ): Promise<Agent> {
    await this.skillsReady;
    const meta = this.metadata.agents[id];
    if (meta === undefined) {
      throw new PythinkerError(ErrorCodes.SESSION_STATE_INVALID, `Session agent "${id}" is missing`);
    }

    const parentAgentId = meta.parentAgentId ?? null;
    if (parentAgentId !== null) {
      await this.resumeAgent(parentAgentId, [...stack, id]);
    }

    try {
      const agent = this.instantiateAgent(id, this.agentDir(id), meta.type, {}, parentAgentId);
      await agent.resume();
      this.agents.set(id, agent);
      return agent;
    } catch (error) {
      const entry = this.agents.get(id);
      if (entry instanceof Promise) {
        this.agents.delete(id);
      }
      throw error;
    }
  }

  private nextGeneratedAgentId(): string {
    while (true) {
      const id = `agent-${this.agentIdCounter++}`;
      if (this.agents.has(id)) continue;
      if (this.metadata.agents[id] !== undefined) continue;
      return id;
    }
  }

  private agentDir(id: string): string {
    assertSafeAgentId(id);
    return join(this.options.homedir, 'agents', id);
  }

  private requireMainAgent(): Agent {
    const agent = this.getReadyAgent('main');
    if (agent === undefined) {
      throw new PythinkerError(ErrorCodes.AGENT_NOT_FOUND, 'Main agent was not found');
    }
    return agent;
  }

  private async triggerSessionStart(source: 'startup' | 'resume'): Promise<void> {
    await this.hookEngine.trigger('SessionStart', {
      matcherValue: source,
      inputData: { agentId: 'main', source },
    });
  }

  private async triggerSetup(): Promise<void> {
    const trigger = this.options.setupTrigger;
    if (trigger === undefined) return;
    await this.hookEngine.trigger('Setup', {
      matcherValue: trigger,
      inputData: { agentId: 'main', trigger },
    });
  }

  private deliverAsyncHookRewake(event: string, results: readonly HookResult[]): void {
    const rendered = renderAsyncHookRewake(event, results);
    const main = this.getReadyAgent('main');
    if (rendered === undefined || main === undefined) return;
    main.turn.steer([{ type: 'text', text: rendered.text }], {
      kind: 'hook_result',
      event,
    });
  }

  private async runModelHook(
    hook: ModelHookDef,
    event: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<HookResult> {
    const requestedAgentId = input['agent_id'];
    const parent =
      typeof requestedAgentId === 'string'
        ? this.getReadyAgent(requestedAgentId)
        : this.getReadyAgent('main');
    if (parent === undefined) {
      return {
        action: 'allow',
        stderr: `Cannot run ${hook.type} hook without its triggering agent.`,
      };
    }

    const timeoutSignal = AbortSignal.timeout(
      (hook.timeout ?? (hook.type === 'prompt' ? 30 : 60)) * 1000,
    );
    const combinedSignal =
      signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    let id: string | undefined;
    try {
      const created = await this.createAgent(
        {
          type: 'sub',
          generate: parent.rawGenerate,
          persistence: new InMemoryAgentRecordPersistence(),
          hookEngine: new HookEngine(),
        },
        {
          parentAgentId: parent.agentId,
          persistMetadata: false,
          profile: hook.type === 'agent' ? this.agentProfiles['verification'] : undefined,
        },
      );
      id = created.id;
      const child = created.agent;
      child.config.update({
        modelAlias: hook.model ?? parent.config.modelAlias,
        thinkingLevel: 'off',
        systemPrompt:
          hook.type === 'prompt'
            ? 'Evaluate the hook condition using the conversation and return the result with StructuredOutput.'
            : child.config.systemPrompt,
      });
      if (hook.type === 'prompt') {
        child.tools.setActiveTools([]);
        child.context.useProjectedHistoryFrom(parent.context);
      } else {
        child.tools.inheritUserTools(parent.tools);
        child.permission.setMode('yolo');
      }

      const prompt = expandSkillParameters(hook.prompt, JSON.stringify(input), {
        skillDir: '',
        sessionId: this.options.id,
      });
      const turnId = child.turn.prompt(
        [{ type: 'text', text: prompt }],
        { kind: 'system_trigger', name: `${hook.type}_hook:${event}` },
        HOOK_OUTPUT_SCHEMA,
      );
      if (turnId === null) {
        return { action: 'allow', stderr: `${hook.type} hook could not start a turn.` };
      }
      const result = await child.turn.waitForCurrentTurn(combinedSignal);
      const output = result.event.structuredOutput;
      if (
        result.event.reason !== 'completed' ||
        typeof output !== 'object' ||
        output === null ||
        typeof (output as { ok?: unknown }).ok !== 'boolean'
      ) {
        return { action: 'allow', stderr: `${hook.type} hook did not return structured output.` };
      }
      const parsed = output as { ok: boolean; reason?: unknown };
      if (parsed.ok) return { action: 'allow', structuredOutput: true };
      const reason =
        typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
          ? parsed.reason.trim()
          : `${hook.type} hook condition was not met.`;
      return {
        action: 'block',
        message: reason,
        reason,
        structuredOutput: true,
      };
    } catch (error) {
      return {
        action: 'allow',
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: timeoutSignal.aborted && signal?.aborted !== true,
      };
    } finally {
      if (id !== undefined) this.agents.delete(id);
    }
  }

  private async triggerSessionEnd(reason: 'exit'): Promise<void> {
    await this.hookEngine.trigger('SessionEnd', {
      matcherValue: reason,
      inputData: { agentId: 'main', reason },
    });
  }
}

export * from './subagent-host';
export * from './file-checkpoints';

function checkpointInActiveConversation(agent: Agent, checkpointId: string): boolean {
  const history = agent.context.data().history;
  const boundary = history.findLastIndex(
    (message) => message.origin?.kind === 'compaction_summary',
  );
  return history.some((message, index) => {
    if (index <= boundary) return false;
    const origin = message.origin;
    if (origin?.kind === 'user') return origin.checkpointId === checkpointId;
    return (
      origin?.kind === 'skill_activation' &&
      origin.trigger === 'user-slash' &&
      origin.checkpointId === checkpointId
    );
  });
}

function initCompletionReminder(agentsMd: string): string {
  const latest =
    agentsMd.trim().length === 0
      ? 'No AGENTS.md content was found after `/init` completed.'
      : agentsMd;
  return [
    'The user just ran `/init` slash command.',
    'The system has analyzed the codebase and generated an `AGENTS.md` file.',
    '',
    'Latest AGENTS.md file content:',
    latest,
  ].join('\n');
}
