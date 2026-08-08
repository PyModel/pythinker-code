import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

import { KaosShellNotFoundError, LocalKaos, type Kaos } from '@pythoughts/kaos';
import { watch, type FSWatcher } from 'chokidar';
import { join } from 'pathe';

import { ErrorCodes, PythinkerError } from '#/errors';
import { getRootLogger, log } from '#/logging/logger';
import { PluginManager } from '#/plugin';
import { LocalFetchURLProvider } from '#/tools/providers/local-fetch-url';
import { PythoughtsFetchURLProvider } from '#/tools/providers/pythoughts-fetch-url';
import { PythoughtsWebSearchProvider } from '#/tools/providers/pythoughts-web-search';
import type { PromisableMethods } from '#/utils/types';
import { getCoreVersion } from '#/version';

import { Agent } from '../agent';
import { resolveThinkingLevel } from '../agent/config/thinking';
import { limitAgentReplayByTurns } from '../agent/replay/turns';
import {
  ensurePythinkerHome,
  loadRuntimeConfigSafe,
  mergeConfigPatch,
  readConfigFileForUpdate,
  resolveConfigPath,
  resolvePythinkerHome,
  writeConfigFile,
  type PythinkerConfig,
  type PythoughtsServiceConfig,
} from '../config';
import { FLAG_DEFINITIONS, FlagResolver, type ExperimentalFeatureState } from '../flags';
import type { Logger } from '../logging/types';
import { resolveSessionMcpConfig, mergeCallerMcpServers, type SessionMcpConfig } from '../mcp';
import { listWorkspaceSkills } from '../skill/workspace';
import {
  DEFAULT_AGENT_PROFILES,
  loadAgentProfilesFromDirectories,
  loadOutputStyles,
  loadPluginAgentProfiles,
  resolveOutputStyle,
  type OutputStyleConfig,
  type ResolvedAgentProfile,
} from '../profile';
import { Session, type SessionMeta, type SessionSkillConfig } from '../session';
import { exportSessionDirectory } from '../session/export';
import {
  ProviderManager,
} from '../session/provider-manager';
import { SessionAPIImpl } from '../session/rpc';
import { normalizeWorkDir, SessionStore } from '../session/store/index';
import {
  noopTelemetryClient,
  withTelemetryContext,
  withTelemetryProperties,
  type TelemetryClient,
  type TelemetryProperties,
} from '../telemetry';
import type { ToolServices } from '../tools/support/services';
import type { CoreRPCClient } from './client';
import type {
  ActivateSkillPayload,
  AgentProfileCatalog,
  AgentProfileSummary,
  ArchiveSessionPayload,
  BeginCompactionPayload,
  CancelPayload,
  CancelPlanPayload,
  CloseSessionPayload,
  ConfigDiagnostics,
  CoreAPI,
  CoreInfo,
  CreateGoalPayload,
  CreateSessionPayload,
  ClientTelemetryInfo,
  EmptyPayload,
  EnterDynamicWorkflowPayload,
  GoalSnapshot,
  GoalToolResult,
  ExportSessionPayload,
  ExportSessionResult,
  FileCheckpointIdPayload,
  ForkSessionPayload,
  GetBackgroundOutputPayload,
  GetBackgroundPayload,
  GetPythinkerConfigPayload,
  GetPluginInfoPayload,
  InstallPluginPayload,
  ListSessionsPayload,
  ListAgentProfilesPayload,
  ListWorkspaceSkillsPayload,
  ListOutputStylesPayload,
  McpServerInfo,
  SkillActivationResult,
  McpStartupMetrics,
  OutputStyleCatalog,
  PluginInfo,
  PluginSummary,
  PromptPayload,
  ReconnectMcpServerPayload,
  RegisterToolPayload,
  ReloadSessionPayload,
  ReloadPluginsResult,
  RemovePythinkerProviderPayload,
  RemovePluginPayload,
  RenameSessionPayload,
  ReplacePythinkerConfigPayload,
  ResumeSessionPayload,
  SessionSummary,
  SetActiveToolsPayload,
  SetFastModePayload,
  SetPythinkerConfigPayload,
  SetModelPayload,
  SetModelResult,
  SetPermissionPayload,
  SetPluginEnabledPayload,
  SetPluginMcpServerEnabledPayload,
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
} from './core-api';
import type { ResumedAgentState, ResumeSessionResult } from './resumed';
import type { SDKRPC } from './sdk-api';
import { proxyWithExtraPayload } from './types';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;
type RenameSessionRequest = SessionScopedPayload<RenameSessionPayload>;
type UpdateSessionMetadataRequest = SessionScopedPayload<UpdateSessionMetadataPayload>;

export interface PythinkerCoreOptions {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
  readonly runtime?: ToolServices | undefined;
  readonly pythinkerRequestHeaders?: Record<string, string> | undefined;
  readonly resolveWorkspaceId?: (workDir: string) => Promise<string | undefined>;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient | undefined;
  readonly appVersion?: string;
}

export class PythinkerCore implements PromisableMethods<CoreAPI> {
  readonly sdk: Promise<SDKRPC>;
  readonly homeDir: string;
  readonly configPath: string;
  readonly sessions = new Map<string, Session>();
  readonly telemetry: TelemetryClient;

  private kaos: Promise<Kaos> | undefined;
  private runtime: ToolServices | undefined;
  private config: PythinkerConfig;
  private configWarnings: readonly string[] = [];
  private readonly runtimeOverride: ToolServices | undefined;
  private readonly userHomeDir: string;
  private readonly pythinkerRequestHeaders: Record<string, string> | undefined;
  private readonly skillDirs: readonly string[];
  private readonly sessionStore: SessionStore;
  readonly plugins: PluginManager;
  private pluginsReady: Promise<void>;
  private pluginsLoadError: Error | undefined;
  private readonly appVersion: string | undefined;
  private readonly experimentalFlags: FlagResolver;
  private readonly configWatcher: FSWatcher;
  private configWatchContents: string | undefined;
  private configWatchQueue = Promise.resolve();

  constructor(
    protected readonly rpcClient: CoreRPCClient,
    options: PythinkerCoreOptions = {},
  ) {
    this.homeDir = resolvePythinkerHome(options.homeDir);
    this.userHomeDir = homedir();
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.runtimeOverride = options.runtime;
    this.runtime = options.runtime;
    this.pythinkerRequestHeaders = options.pythinkerRequestHeaders;
    this.skillDirs = options.skillDirs ?? [];
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.appVersion = options.appVersion;
    ensurePythinkerHome(this.homeDir);
    // Schema errors degrade (invalid sections are dropped with warnings) so a
    // typo cannot prevent startup, but a file that cannot be used at all —
    // TOML syntax error, unreadable — fails fast: defaults-only would start
    // the app looking logged out, which is worse than the parse error.
    const loaded = loadRuntimeConfigSafe(this.configPath);
    if (loaded.fileError !== undefined) {
      throw loaded.fileError;
    }
    this.config = loaded.config;
    this.configWarnings = [...loaded.fileWarnings, ...loaded.envWarnings];
    if (this.configWarnings.length > 0) {
      log.warn('config load degraded', { warnings: this.configWarnings });
    }
    this.experimentalFlags = new FlagResolver(
      process.env,
      FLAG_DEFINITIONS,
      this.config.experimental,
    );
    this.configWatchContents = readConfigContentsSync(this.configPath);
    this.configWatcher = watch(this.configPath, {
      persistent: false,
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50,
      },
    });
    this.configWatcher
      .on('add', () => this.enqueueExternalConfigChange())
      .on('change', () => this.enqueueExternalConfigChange())
      .on('unlink', () => this.enqueueExternalConfigChange())
      .on('ready', () => this.enqueueExternalConfigChange())
      .on('error', (error) => {
        log.warn('config watcher failed', { error });
      });
    this.sessionStore = new SessionStore(this.homeDir, {
      resolveWorkspaceId: options.resolveWorkspaceId,
    });
    this.plugins = new PluginManager({ pythinkerHomeDir: this.homeDir });
    // Capture the error rather than swallow it: mutators and explicit /plugins
    // reads rethrow so the user sees what's wrong; createSession/resumeSession
    // degrade silently (no plugin skills, no sessionStart injections) so the harness still
    // starts. Reload clears the error on success.
    this.pluginsReady = this.plugins.load().catch((error: unknown) => {
      this.pluginsLoadError = error instanceof Error ? error : new Error(String(error));
    });
    log.info('experimental flags enabled', { flags: this.experimentalFlags.enabledIds() });

    this.sdk = rpcClient(this);
  }

  async createSession(input: CreateSessionPayload): Promise<SessionSummary> {
    return this.createSessionWithOverrides(input, {});
  }

  async createSessionWithOverrides(
    input: CreateSessionPayload,
    overrides: { kaos?: Kaos; persistenceKaos?: Kaos },
  ): Promise<SessionSummary> {
    const options = input;
    const workDir = requiredWorkDir('createSession', options.workDir);
    const config = this.reloadProviderManager();
    const id = options.id ?? createSessionId();
    const thinkingLevel = resolveThinkingLevel(options.thinking, config);
    const permissionMode = options.permission ?? config.defaultPermissionMode;
    const baseMcpConfig = await resolveSessionMcpConfig({
      cwd: workDir,
      homeDir: this.homeDir,
    });
    const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, options.mcpServers);
    const clientTelemetry = clientTelemetryProperties(options.client);
    const sessionTelemetryBase = withTelemetryContext(this.telemetry, { sessionId: id });
    const sessionTelemetry =
      Object.keys(clientTelemetry).length === 0
        ? sessionTelemetryBase
        : withTelemetryProperties(sessionTelemetryBase, clientTelemetry);

    await this.pluginsReady;
    const pluginSessionStarts = this.plugins.enabledSessionStarts();
    const mcpConfig = this.mergePluginMcpConfig(withCallerMcp);

    // Session ctor attaches its own log sink. If anything in the setup-after-
    // ctor block throws, `session.close()` releases the sink (and mcp).
    const runtime = await this.resolveRuntime(config);
    const [agentProfiles, outputStyle] = await Promise.all([
      this.loadAgentProfiles(workDir),
      this.loadSelectedOutputStyle(workDir, config),
    ]);
    const parentKaos = overrides.kaos ?? (await this.getKaos());
    const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
    let createdSession: Session | undefined;
    let summary: SessionSummary;
    try {
      summary = await this.sessionStore.create({ id, workDir }, async (provisionalSummary) => {
        const session = new Session({
          kaos: parentKaos.withCwd(workDir),
          persistenceKaos,
          toolServices: runtime,
          config,
          id,
          homedir: provisionalSummary.sessionDir,
          pythinkerHomeDir: this.homeDir,
          rpc: proxyWithExtraPayload(await this.sdk, { sessionId: id }),
          providerManager: this.resolveProviderManager(id),
          background: config.background,
          hooks: config.hooks,
          allowedHttpHookUrls: config.allowedHttpHookUrls,
          httpHookAllowedEnvVars: config.httpHookAllowedEnvVars,
          permissionRules: config.permission?.rules,
          setupTrigger: options.setupTrigger,
          skills: this.resolveSessionSkillConfig(config),
          mcpConfig,
          lspConfig: this.plugins.enabledLspServers(),
          experimentalFlags: this.experimentalFlags,
          agentProfiles,
          outputStyle,
          telemetry: sessionTelemetry,
          pluginSessionStarts,
          appVersion: this.appVersion,
        });
        try {
          session.metadata = {
            ...session.metadata,
            createdAt: new Date(provisionalSummary.createdAt).toISOString(),
            updatedAt: new Date(provisionalSummary.updatedAt).toISOString(),
            title: provisionalSummary.title ?? session.metadata.title,
            isCustomTitle:
              provisionalSummary.title !== undefined ? true : session.metadata.isCustomTitle,
            custom: options.metadata === undefined ? {} : { ...options.metadata },
          };
          const mainAgent = await session.createMain();
          mainAgent.config.update({
            modelAlias: options.model ?? config.defaultModel,
            thinkingLevel,
          });
          if (permissionMode !== undefined) {
            mainAgent.permission.setMode(permissionMode);
          }
          // Honor config.defaultPlanMode for fresh sessions. Resumed sessions
          // restore their own plan state from records and never re-apply this.
          if (config.defaultPlanMode === true) {
            await mainAgent.planMode.enter();
          }
          await session.writeMetadata();
          await session.flushMetadata();
          createdSession = session;
        } catch (error) {
          await session.close().catch(() => {});
          throw error;
        }
      });
    } catch (error) {
      await createdSession?.close().catch(() => {});
      throw error;
    }
    if (createdSession === undefined) {
      throw new PythinkerError(ErrorCodes.SESSION_INIT_FAILED, `Session "${id}" did not initialize`);
    }
    this.sessions.set(id, createdSession);
    if (Object.keys(clientTelemetry).length > 0) {
      sessionTelemetry.track('session_started', { resumed: false });
    }
    return {
      ...summary,
      metadata: options.metadata,
    };
  }

  getCoreInfo(): CoreInfo {
    return { version: getCoreVersion() };
  }

  getExperimentalFeatures(): readonly ExperimentalFeatureState[] {
    return this.experimentalFlags.explainAll();
  }

  async closeSession({ sessionId }: CloseSessionPayload): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  async archiveSession({ sessionId }: ArchiveSessionPayload): Promise<void> {
    await this.closeSession({ sessionId });
    await this.sessionStore.archive(sessionId);
  }

  async resumeSession(input: ResumeSessionPayload): Promise<ResumeSessionResult> {
    return this.resumeSessionWithOverrides(input, {});
  }

  async resumeSessionWithOverrides(
    input: ResumeSessionPayload,
    overrides: { kaos?: Kaos; persistenceKaos?: Kaos },
  ): Promise<ResumeSessionResult> {
    let summary: SessionSummary;
    try {
      summary = await this.sessionStore.get(input.sessionId);
    } catch (error) {
      if (
        error instanceof PythinkerError &&
        (error.code === ErrorCodes.SESSION_STATE_INVALID ||
          error.code === ErrorCodes.SESSION_STATE_NOT_FOUND)
      ) {
        const initError = new PythinkerError(
          ErrorCodes.SESSION_INIT_FAILED,
          `Session "${input.sessionId}" could not be initialized`,
          { cause: error },
        );
        withTelemetryContext(this.telemetry, { sessionId: input.sessionId }).track(
          'session_load_failed',
          { reason: telemetryErrorReason(initError) },
        );
        throw initError;
      }
      throw error;
    }
    const active = this.sessions.get(summary.id);
    if (active !== undefined) {
      if (overrides.kaos !== undefined) {
        active.setToolKaos(overrides.kaos.withCwd(summary.workDir));
      }
      return resumeSessionResult(summary, active, input.replayTurnLimit);
    }

    const config = this.reloadProviderManager();
    const baseMcpConfig = await resolveSessionMcpConfig({
      cwd: summary.workDir,
      homeDir: this.homeDir,
    });
    const withCallerMcp = mergeCallerMcpServers(baseMcpConfig, input.mcpServers);
    await this.pluginsReady;
    const pluginSessionStarts = this.plugins.enabledSessionStarts();
    const mcpConfig = this.mergePluginMcpConfig(withCallerMcp);
    const runtime = await this.resolveRuntime(config);
    const [agentProfiles, outputStyle] = await Promise.all([
      this.loadAgentProfiles(summary.workDir),
      this.loadSelectedOutputStyle(summary.workDir, config),
    ]);
    const parentKaos = overrides.kaos ?? (await this.getKaos());
    const persistenceKaos = overrides.persistenceKaos ?? parentKaos;
    const session = new Session({
      kaos: parentKaos.withCwd(summary.workDir),
      persistenceKaos,
      toolServices: runtime,
      config,
      id: summary.id,
      homedir: summary.sessionDir,
      pythinkerHomeDir: this.homeDir,
      rpc: proxyWithExtraPayload(await this.sdk, { sessionId: summary.id }),
      providerManager: this.resolveProviderManager(summary.id),
      background: config.background,
      hooks: config.hooks,
      allowedHttpHookUrls: config.allowedHttpHookUrls,
      httpHookAllowedEnvVars: config.httpHookAllowedEnvVars,
      permissionRules: config.permission?.rules,
      setupTrigger: input.setupTrigger,
      skills: this.resolveSessionSkillConfig(config),
      mcpConfig,
      lspConfig: this.plugins.enabledLspServers(),
      experimentalFlags: this.experimentalFlags,
      agentProfiles,
      outputStyle,
      telemetry: withTelemetryContext(this.telemetry, { sessionId: summary.id }),
      initializeMainAgent: false,
      pluginSessionStarts,
      appVersion: this.appVersion,
    });
    try {
      await session.resume();
      await this.refreshSessionRuntimeConfig(session, config);
    } catch (error) {
      await session.close().catch(() => {});
      withTelemetryContext(this.telemetry, { sessionId: summary.id }).track('session_load_failed', {
        reason: telemetryErrorReason(error),
      });
      throw error;
    }
    this.sessions.set(summary.id, session);
    return resumeSessionResult(summary, session, input.replayTurnLimit);
  }

  async reloadSession(input: ReloadSessionPayload): Promise<ResumeSessionResult> {
    const summary = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(summary.id);
    if (active?.hasActiveTurn === true) {
      throw new PythinkerError(
        ErrorCodes.TURN_AGENT_BUSY,
        `Session "${summary.id}" cannot be reloaded while a turn is running`,
        { details: { sessionId: summary.id } },
      );
    }

    this.reloadProviderManager();
    this.clearRuntimeCache();
    await this.reloadPlugins({});

    if (active !== undefined) {
      await active.closeForReload();
      this.sessions.delete(summary.id);
    }
    return this.resumeSession({ sessionId: summary.id });
  }

  async forkSession(input: ForkSessionPayload): Promise<ResumeSessionResult> {
    const source = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(source.id);
    if (active?.hasActiveTurn === true) {
      throw new PythinkerError(
        ErrorCodes.SESSION_FORK_ACTIVE_TURN,
        `Session "${source.id}" cannot be forked while a turn is running`,
        { details: { sessionId: source.id } },
      );
    }

    if (active !== undefined) {
      await active.flushMetadata();
    }

    const id = input.id ?? createSessionId();
    await this.sessionStore.fork({
      sourceId: source.id,
      targetId: id,
      title: input.title,
      metadata: input.metadata,
    });
    return this.resumeSession({ sessionId: id });
  }

  async listSessions(input: ListSessionsPayload = {}): Promise<readonly SessionSummary[]> {
    return this.sessionStore.list(input);
  }

  async renameSession({ sessionId, ...payload }: RenameSessionRequest): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      await new SessionAPIImpl(session).renameSession(payload);
      return;
    }
    await this.sessionStore.rename(sessionId, payload.title);
  }

  async exportSession(input: ExportSessionPayload): Promise<ExportSessionResult> {
    const summary = await this.sessionStore.get(input.sessionId);
    const active = this.sessions.get(input.sessionId);
    // Closed sessions have no `Session.log`; create an ad-hoc child bound to
    // their id so the entries still route to the session log file.
    const exportLog = active?.log ?? log.createChild({ sessionId: input.sessionId });
    if (active !== undefined) {
      try {
        await active.flushMetadata();
      } catch (error) {
        exportLog.warn('flushMetadata failed before export', { error });
      }
    }
    await warnIfLogFlushFails(exportLog, 'export session log flush failed', () =>
      getRootLogger().flushSession(input.sessionId),
    );
    if (input.includeGlobalLog === true) {
      await warnIfLogFlushFails(exportLog, 'export global log flush failed', () =>
        getRootLogger().flushGlobal(),
      );
    }
    const result = await exportSessionDirectory({
      request: input,
      summary,
      homeDir: this.homeDir,
      globalLogPath: getRootLogger().getConfig()?.globalLogPath,
    });
    return result;
  }

  async getPythinkerConfig(input?: GetPythinkerConfigPayload): Promise<PythinkerConfig> {
    if (input?.reload) {
      this.reloadRuntimeConfig();
    }
    return this.config;
  }

  async getConfigDiagnostics(_input?: EmptyPayload): Promise<ConfigDiagnostics> {
    return { warnings: this.configWarnings };
  }

  async listOutputStyles({ workDir }: ListOutputStylesPayload): Promise<OutputStyleCatalog> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    const config = this.reloadRuntimeConfig();
    const result = await loadOutputStyles({
      brandHome: this.homeDir,
      workDir: requiredWorkDir('listOutputStyles', workDir),
      pluginSources: this.plugins.enabledOutputStyleSources(),
    });
    for (const failure of result.failures) {
      log.warn('output style load failed', failure);
    }
    const active = resolveOutputStyle(result.styles, config.outputStyle)?.name ?? 'default';
    return {
      active,
      styles: Object.entries(result.styles).map(([name, style]) => ({
        name,
        description: style?.description ?? 'Use the standard Pythinker response style.',
        source: style?.source ?? 'built-in',
        active: name === active,
        forced: style?.forceForPlugin,
      })),
    };
  }

  async listAgentProfiles({ workDir }: ListAgentProfilesPayload): Promise<AgentProfileCatalog> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    return this.loadAgentProfileCatalog(requiredWorkDir('listAgentProfiles', workDir));
  }

  // Resolves the same roots a session would, so a caller that has no session yet
  // (a freshly opened editor panel) still sees the workspace's real skill list.
  async listWorkspaceSkills({
    workDir,
  }: ListWorkspaceSkillsPayload): Promise<readonly SkillSummary[]> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    return listWorkspaceSkills({
      workDir: requiredWorkDir('listWorkspaceSkills', workDir),
      // The lenient runtime read, matching session creation: a warning in an
      // unrelated config section must not make listing skills throw.
      ...this.resolveSessionSkillConfig(this.reloadRuntimeConfig()),
    });
  }

  async setPythinkerConfig(input: SetPythinkerConfigPayload): Promise<PythinkerConfig> {
    const config = mergeConfigPatch(this.readConfigForWrite(), input);
    return this.writePythinkerConfig(config);
  }

  // Unlike setPythinkerConfig (which merges a patch), this replaces the
  // whole config verbatim; callers must supply a complete, valid config.
  replacePythinkerConfig({ config }: ReplacePythinkerConfigPayload): Promise<PythinkerConfig> {
    return this.writePythinkerConfig(config);
  }

  private async writePythinkerConfig(config: PythinkerConfig): Promise<PythinkerConfig> {
    const blocked = await this.triggerConfigChangeHooks();
    if (blocked !== undefined) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `ConfigChange hook blocked the settings update: ${blocked.reason}`,
      );
    }
    await writeConfigFile(this.configPath, config);
    this.configWatchContents = await readConfigContents(this.configPath);
    return this.reloadRuntimeConfig();
  }

  async removePythinkerProvider(input: RemovePythinkerProviderPayload): Promise<PythinkerConfig> {
    const config = this.readConfigForWrite();
    delete config.providers[input.providerId];

    let removedDefault = false;
    const existingModels = config.models ?? {};
    for (const [key, model] of Object.entries(existingModels)) {
      if (
        typeof model === 'object' &&
        model !== null &&
        !Array.isArray(model) &&
        model['provider'] === input.providerId
      ) {
        delete existingModels[key];
        if (config.defaultModel === key) removedDefault = true;
      }
    }
    config.models = existingModels;

    if (removedDefault) {
      config.defaultModel = undefined;
    }

    if (config.defaultProvider === input.providerId) {
      config.defaultProvider = undefined;
    }

    return this.writePythinkerConfig(config);
  }

  prompt({ sessionId, ...payload }: SessionAgentPayload<PromptPayload>) {
    return this.sessionApi(sessionId).prompt(payload);
  }

  steer({ sessionId, ...payload }: SessionAgentPayload<SteerPayload>) {
    return this.sessionApi(sessionId).steer(payload);
  }

  cancel({ sessionId, ...payload }: SessionAgentPayload<CancelPayload>) {
    return this.sessionApi(sessionId).cancel(payload);
  }

  undoHistory({ sessionId, ...payload }: SessionAgentPayload<UndoHistoryPayload>) {
    return this.sessionApi(sessionId).undoHistory(payload);
  }

  async setModel({
    sessionId,
    ...payload
  }: SessionAgentPayload<SetModelPayload>): Promise<SetModelResult> {
    this.reloadProviderManager();
    return this.sessionApi(sessionId).setModel(payload);
  }

  setThinking({ sessionId, ...payload }: SessionAgentPayload<SetThinkingPayload>) {
    return this.sessionApi(sessionId).setThinking(payload);
  }

  setFastMode({ sessionId, ...payload }: SessionAgentPayload<SetFastModePayload>) {
    return this.sessionApi(sessionId).setFastMode(payload);
  }

  setPermission({ sessionId, ...payload }: SessionAgentPayload<SetPermissionPayload>) {
    return this.sessionApi(sessionId).setPermission(payload);
  }

  getModel({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getModel(payload);
  }

  enterPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).enterPlan(payload);
  }

  cancelPlan({ sessionId, ...payload }: SessionAgentPayload<CancelPlanPayload>) {
    return this.sessionApi(sessionId).cancelPlan(payload);
  }

  clearPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).clearPlan(payload);
  }

  enterDynamicWorkflow({ sessionId, ...payload }: SessionAgentPayload<EnterDynamicWorkflowPayload>) {
    return this.sessionApi(sessionId).enterDynamicWorkflow(payload);
  }

  exitDynamicWorkflow({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).exitDynamicWorkflow(payload);
  }

  getDynamicWorkflowMode({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getDynamicWorkflowMode(payload);
  }

  beginCompaction({ sessionId, ...payload }: SessionAgentPayload<BeginCompactionPayload>) {
    return this.sessionApi(sessionId).beginCompaction(payload);
  }

  cancelCompaction({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).cancelCompaction(payload);
  }

  registerTool({ sessionId, ...payload }: SessionAgentPayload<RegisterToolPayload>) {
    return this.sessionApi(sessionId).registerTool(payload);
  }

  unregisterTool({ sessionId, ...payload }: SessionAgentPayload<UnregisterToolPayload>) {
    return this.sessionApi(sessionId).unregisterTool(payload);
  }

  setActiveTools({ sessionId, ...payload }: SessionAgentPayload<SetActiveToolsPayload>) {
    return this.sessionApi(sessionId).setActiveTools(payload);
  }

  stopBackground({ sessionId, ...payload }: SessionAgentPayload<StopBackgroundPayload>) {
    return this.sessionApi(sessionId).stopBackground(payload);
  }

  clearContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).clearContext(payload);
  }

  activateSkill({
    sessionId,
    ...payload
  }: SessionAgentPayload<ActivateSkillPayload>): Promise<SkillActivationResult> {
    return this.sessionApi(sessionId).activateSkill(payload);
  }

  getBackgroundOutput({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundOutputPayload>) {
    return this.sessionApi(sessionId).getBackgroundOutput(payload);
  }

  getContext({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getContext(payload);
  }

  getContextUsage({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getContextUsage(payload);
  }

  getConfig({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getConfig(payload);
  }

  getPermission({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getPermission(payload);
  }

  getPlan({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getPlan(payload);
  }

  getUsage({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getUsage(payload);
  }

  getTools({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).getTools(payload);
  }

  listContextFiles({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).listContextFiles(payload);
  }

  getBackground({ sessionId, ...payload }: SessionAgentPayload<GetBackgroundPayload>) {
    return this.sessionApi(sessionId).getBackground(payload);
  }

  updateSessionMetadata({ sessionId, ...payload }: UpdateSessionMetadataRequest): Promise<void> {
    return this.sessionApi(sessionId).updateSessionMetadata(payload);
  }

  getSessionMetadata({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): SessionMeta {
    return this.sessionApi(sessionId).getSessionMetadata(payload);
  }

  listWorkspaceDirectories({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): readonly WorkspaceDirectory[] {
    return this.sessionApi(sessionId).listWorkspaceDirectories(payload);
  }

  addWorkspaceDirectory({
    sessionId,
    ...payload
  }: SessionScopedPayload<WorkspaceDirectoryPayload>): Promise<WorkspaceDirectory> {
    return this.sessionApi(sessionId).addWorkspaceDirectory(payload);
  }

  removeWorkspaceDirectory({
    sessionId,
    ...payload
  }: SessionScopedPayload<WorkspaceDirectoryPayload>): Promise<void> {
    return this.sessionApi(sessionId).removeWorkspaceDirectory(payload);
  }

  listSkills({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<readonly SkillSummary[]> {
    return this.sessionApi(sessionId).listSkills(payload);
  }

  reloadSkills({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<void> {
    return this.sessionApi(sessionId).reloadSkills(payload);
  }

  listMcpServers({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): readonly McpServerInfo[] {
    return this.sessionApi(sessionId).listMcpServers(payload);
  }

  getMcpStartupMetrics({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<McpStartupMetrics> {
    return this.sessionApi(sessionId).getMcpStartupMetrics(payload);
  }

  reconnectMcpServer({
    sessionId,
    ...payload
  }: SessionScopedPayload<ReconnectMcpServerPayload>): Promise<void> {
    return this.sessionApi(sessionId).reconnectMcpServer(payload);
  }

  generateAgentsMd({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>): Promise<void> {
    return this.sessionApi(sessionId).generateAgentsMd(payload);
  }

  refreshInstructions({
    sessionId,
    ...payload
  }: SessionScopedPayload<EmptyPayload>): Promise<void> {
    return this.sessionApi(sessionId).refreshInstructions(payload);
  }

  listWorkingTreeChanges({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).listWorkingTreeChanges(payload);
  }

  getWorkingTreeDiff({ sessionId, ...payload }: SessionScopedPayload<WorkingTreeDiffPayload>) {
    return this.sessionApi(sessionId).getWorkingTreeDiff(payload);
  }

  listFileCheckpoints({ sessionId, ...payload }: SessionScopedPayload<EmptyPayload>) {
    return this.sessionApi(sessionId).listFileCheckpoints(payload);
  }

  previewFileCheckpoint({ sessionId, ...payload }: SessionScopedPayload<FileCheckpointIdPayload>) {
    return this.sessionApi(sessionId).previewFileCheckpoint(payload);
  }

  restoreFileCheckpoint({ sessionId, ...payload }: SessionScopedPayload<FileCheckpointIdPayload>) {
    return this.sessionApi(sessionId).restoreFileCheckpoint(payload);
  }

  startBtw({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<string> {
    return this.sessionApi(sessionId).startBtw(payload);
  }

  createGoal({
    sessionId,
    ...payload
  }: SessionAgentPayload<CreateGoalPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).createGoal(payload));
  }

  getGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalToolResult> {
    return Promise.resolve(this.sessionApi(sessionId).getGoal(payload));
  }

  pauseGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).pauseGoal(payload));
  }

  resumeGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).resumeGoal(payload));
  }

  cancelGoal({ sessionId, ...payload }: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
    return Promise.resolve(this.sessionApi(sessionId).cancelGoal(payload));
  }

  async installPlugin(payload: InstallPluginPayload): Promise<PluginSummary> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    const record = await this.plugins.install(payload.source, payload.options);
    return this.plugins.summaries().find((s) => s.id === record.id)!;
  }

  async listPlugins(_: EmptyPayload): Promise<readonly PluginSummary[]> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    return this.plugins.summaries();
  }

  async setPluginEnabled({ id, enabled }: SetPluginEnabledPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.setEnabled(id, enabled);
  }

  async setPluginMcpServerEnabled({
    id,
    server,
    enabled,
  }: SetPluginMcpServerEnabledPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.setMcpServerEnabled(id, server, enabled);
  }

  async removePlugin({ id }: RemovePluginPayload): Promise<void> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    await this.plugins.remove(id);
  }

  async reloadPlugins(_: EmptyPayload): Promise<ReloadPluginsResult> {
    try {
      const summary = await this.plugins.reload();
      this.pluginsLoadError = undefined;
      return summary;
    } catch (error) {
      this.pluginsLoadError = error instanceof Error ? error : new Error(String(error));
      throw new PythinkerError(
        ErrorCodes.PLUGIN_LOAD_FAILED,
        `Failed to reload plugins: ${this.pluginsLoadError.message}`,
        { cause: error, details: { pythinkerHomeDir: this.homeDir } },
      );
    }
  }

  async getPluginInfo({ id }: GetPluginInfoPayload): Promise<PluginInfo> {
    await this.pluginsReady;
    this.assertPluginsLoaded();
    const info = this.plugins.info(id);
    if (info === undefined) {
      throw new PythinkerError(ErrorCodes.PLUGIN_NOT_FOUND, `Plugin "${id}" is not installed`, {
        details: { id },
      });
    }
    return info;
  }

  private assertPluginsLoaded(): void {
    if (this.pluginsLoadError === undefined) return;
    throw new PythinkerError(
      ErrorCodes.PLUGIN_LOAD_FAILED,
      `Plugin state failed to load: ${this.pluginsLoadError.message}. ` +
        `Fix the file at ${this.homeDir}/plugins/installed.json and run /plugins reload.`,
      { cause: this.pluginsLoadError, details: { pythinkerHomeDir: this.homeDir } },
    );
  }

  private async resolveRuntime(config: PythinkerConfig): Promise<ToolServices> {
    if (this.runtime !== undefined) {
      if (this.runtime.configStore !== undefined) return this.runtime;
      this.runtime = this.withConfigStore(this.runtime);
      return this.runtime;
    }
    const providers = await createRuntimeConfig({
      config,
      pythinkerRequestHeaders: this.pythinkerRequestHeaders,
    });
    const runtime = this.withConfigStore(providers);
    this.runtime = runtime;
    return runtime;
  }

  private withConfigStore(runtime: ToolServices): ToolServices {
    return {
      ...runtime,
      configStore: {
        get: () => this.getPythinkerConfig({ reload: true }),
        set: (patch) => this.setPythinkerConfig(patch),
      },
    };
  }

  private getKaos(): Promise<Kaos> {
    this.kaos ??= LocalKaos.create().catch((error: unknown) => {
      if (error instanceof KaosShellNotFoundError) {
        throw new PythinkerError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, error.message);
      }
      throw error;
    });
    return this.kaos;
  }

  private resolveSessionSkillConfig(config: PythinkerConfig): SessionSkillConfig {
    const explicitDirs = this.skillDirs.length > 0 ? this.skillDirs : undefined;
    return {
      userHomeDir: this.userHomeDir,
      brandHomeDir: this.homeDir,
      explicitDirs,
      extraDirs: config.extraSkillDirs,
      pluginSkillRoots: this.plugins.pluginSkillRoots(),
      mergeAllAvailableSkills: config.mergeAllAvailableSkills,
    };
  }

  private async loadAgentProfiles(workDir: string): Promise<Record<string, ResolvedAgentProfile>> {
    return (await this.loadAgentProfileCatalog(workDir)).resolvedProfiles;
  }

  private async loadAgentProfileCatalog(workDir: string): Promise<
    AgentProfileCatalog & {
      readonly resolvedProfiles: Record<string, ResolvedAgentProfile>;
    }
  > {
    const pluginResult = await loadPluginAgentProfiles(this.plugins.enabledAgentProfileSources());
    const userResult = await loadAgentProfilesFromDirectories([join(this.homeDir, 'agents')]);
    const projectResult = await loadAgentProfilesFromDirectories([
      join(workDir, '.pythinker-code', 'agents'),
    ]);
    const failures = [...pluginResult.failures, ...userResult.failures, ...projectResult.failures];
    for (const failure of failures) {
      log.warn('agent profile load failed', failure);
    }
    const pluginProfiles = withoutReservedMainAgent(pluginResult.profiles);
    const userProfiles = withoutReservedMainAgent(userResult.profiles);
    const projectProfiles = withoutReservedMainAgent(projectResult.profiles);
    if (pluginProfiles.removed || userProfiles.removed || projectProfiles.removed) {
      log.warn('reserved agent profile ignored', {
        profile: 'agent',
        reason: 'The main agent profile cannot be overridden by a custom subagent profile.',
      });
    }
    const resolvedProfiles = {
      ...pluginProfiles.profiles,
      ...userProfiles.profiles,
      ...projectProfiles.profiles,
    };
    const summaries = new Map<string, AgentProfileSummary>();
    addAgentProfileSummaries(summaries, DEFAULT_AGENT_PROFILES, 'built-in');
    addAgentProfileSummaries(summaries, pluginProfiles.profiles, 'plugin');
    addAgentProfileSummaries(summaries, userProfiles.profiles, 'user');
    addAgentProfileSummaries(summaries, projectProfiles.profiles, 'project');
    return {
      resolvedProfiles,
      profiles: [...summaries.values()].toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
      warnings: failures,
    };
  }

  private async loadSelectedOutputStyle(
    workDir: string,
    config: PythinkerConfig,
  ): Promise<OutputStyleConfig | null> {
    const result = await loadOutputStyles({
      brandHome: this.homeDir,
      workDir,
      pluginSources: this.plugins.enabledOutputStyleSources(),
    });
    for (const failure of result.failures) {
      log.warn('output style load failed', failure);
    }
    return resolveOutputStyle(result.styles, config.outputStyle);
  }

  private resolveProviderManager(sessionId: string): ProviderManager {
    return new ProviderManager({
      config: () => this.config,
      pythinkerRequestHeaders: this.pythinkerRequestHeaders,
      promptCacheKey: sessionId,
    });
  }

  private mergePluginMcpConfig(base: SessionMcpConfig | undefined): SessionMcpConfig | undefined {
    const pluginServers = this.plugins.enabledMcpServers();
    if (Object.keys(pluginServers).length === 0) return base;
    return {
      servers: {
        ...base?.servers,
        ...pluginServers,
      },
    };
  }


  private sessionApi(sessionId: string): SessionAPIImpl {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new PythinkerError(
        ErrorCodes.SESSION_NOT_FOUND,
        `Session "${sessionId}" was not found`,
        {
          details: { sessionId },
        },
      );
    }
    return new SessionAPIImpl(session);
  }

  private reloadProviderManager(): PythinkerConfig {
    return this.reloadRuntimeConfig();
  }

  async close(): Promise<void> {
    await this.configWatcher.close();
    await this.configWatchQueue;
  }

  private enqueueExternalConfigChange(): void {
    this.configWatchQueue = this.configWatchQueue
      .then(() => this.handleExternalConfigChange())
      .catch((error: unknown) => {
        log.warn('external config reload failed', { error });
      });
  }

  private async handleExternalConfigChange(): Promise<void> {
    const contents = await readConfigContents(this.configPath);
    if (contents === this.configWatchContents) return;
    this.configWatchContents = contents;

    const blocked = await this.triggerConfigChangeHooks();
    if (blocked !== undefined) {
      log.warn('external config change blocked', { reason: blocked.reason });
      return;
    }
    this.clearRuntimeCache();
    this.reloadRuntimeConfig();
  }

  private async triggerConfigChangeHooks() {
    const decisions = await Promise.all(
      [...this.sessions.values()].map((session) =>
        session.hookEngine.triggerBlock('ConfigChange', {
          matcherValue: 'user_settings',
          inputData: {
            agentId: 'main',
            source: 'user_settings',
            filePath: this.configPath,
          },
        }),
      ),
    );
    return decisions.find((decision) => decision !== undefined);
  }

  private readConfigForWrite(): PythinkerConfig {
    return readConfigFileForUpdate(this.configPath);
  }

  private reloadRuntimeConfig(): PythinkerConfig {
    const loaded = loadRuntimeConfigSafe(this.configPath);
    if (loaded.fileWarnings.length > 0) {
      // Keep the last good config: adopting a salvaged config mid-run could
      // silently drop providers or models a live session depends on.
      this.configWarnings = [
        ...loaded.fileWarnings,
        ...loaded.envWarnings,
        'config.toml has errors; keeping the previously loaded configuration.',
      ];
      log.warn('config reload degraded; keeping previous config', {
        warnings: loaded.fileWarnings,
      });
      return this.config;
    }
    this.configWarnings = loaded.envWarnings;
    return this.setRuntimeConfig(loaded.config);
  }

  private setRuntimeConfig(config: PythinkerConfig): PythinkerConfig {
    this.config = config;
    this.experimentalFlags.setConfigOverrides(config.experimental);
    return this.config;
  }

  private clearRuntimeCache(): void {
    if (this.runtimeOverride !== undefined) return;
    this.runtime = undefined;
  }

  private async refreshSessionRuntimeConfig(
    session: Session,
    config: PythinkerConfig,
  ): Promise<void> {
    const api = new SessionAPIImpl(session);
    // A session migrated from an external tool carries no model, and any
    // session may reference a model alias that no longer exists in config.toml.
    // Try the session's own model first, then fall back to the configured
    // default, so resume degrades gracefully instead of hard-failing.
    const requested = (await api.getModel({ agentId: 'main' })).trim();
    const fallback = config.defaultModel?.trim() ?? '';
    const candidates = [...new Set([requested, fallback].filter((model) => model.length > 0))];
    for (const model of candidates) {
      try {
        await api.setModel({ agentId: 'main', model });
        await session.flushMetadata();
        return;
      } catch (error) {
        // Skip a candidate only when the alias is genuinely absent from
        // config (a stale or migrated model) — that is the graceful-degrade
        // case. A *configured* alias that fails to resolve (missing provider,
        // no credentials, bad max_context_size) is an actionable config error
        // the user must see; surface it instead of silently swapping models.
        const aliasMissing = config.models?.[model] === undefined;
        if (
          aliasMissing &&
          error instanceof PythinkerError &&
          error.code === ErrorCodes.CONFIG_INVALID
        ) {
          continue;
        }
        throw error;
      }
    }
  }
}

function readConfigContentsSync(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function readConfigContents(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function createRuntimeConfig(input: {
  readonly config: PythinkerConfig;
  readonly pythinkerRequestHeaders?: Record<string, string> | undefined;
}): Promise<ToolServices> {
  const localFetcher = new LocalFetchURLProvider();
  const searchService = input.config.services?.pythoughtsSearch;
  const fetchService = input.config.services?.pythoughtsFetch;

  return {
    urlFetcher:
      fetchService?.baseUrl === undefined
        ? localFetcher
        : new PythoughtsFetchURLProvider({
            baseUrl: fetchService.baseUrl,
            localFallback: localFetcher,
            defaultHeaders: input.pythinkerRequestHeaders,
            ...serviceCredentials(fetchService),
          }),
    webSearcher:
      searchService?.baseUrl === undefined
        ? undefined
        : new PythoughtsWebSearchProvider({
            baseUrl: searchService.baseUrl,
            defaultHeaders: input.pythinkerRequestHeaders,
            ...serviceCredentials(searchService),
          }),
  };
}

function serviceCredentials(service: PythoughtsServiceConfig): {
  readonly apiKey?: string | undefined;
  readonly customHeaders?: Record<string, string> | undefined;
} {
  return {
    apiKey: nonEmptyString(service.apiKey),
    customHeaders: service.customHeaders,
  };
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function requiredWorkDir(operation: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PythinkerError(ErrorCodes.REQUEST_WORK_DIR_REQUIRED, `${operation} requires workDir`);
  }
  return normalizeWorkDir(value);
}

function withoutReservedMainAgent(profiles: Record<string, ResolvedAgentProfile>): {
  readonly profiles: Record<string, ResolvedAgentProfile>;
  readonly removed: boolean;
} {
  if (profiles['agent'] === undefined) return { profiles, removed: false };
  const filtered = { ...profiles };
  delete filtered['agent'];
  return { profiles: filtered, removed: true };
}

function addAgentProfileSummaries(
  target: Map<string, AgentProfileSummary>,
  profiles: Readonly<Record<string, ResolvedAgentProfile>>,
  source: AgentProfileSummary['source'],
): void {
  for (const profile of Object.values(profiles)) {
    target.set(profile.name, {
      name: profile.name,
      description: profile.description,
      source,
      tools: [...profile.tools],
      model: profile.model,
      effort: profile.effort,
      permissionMode: profile.permissionMode,
      background: profile.background,
      maxTurns: profile.maxTurns,
      isolation: profile.isolation,
      memory: profile.memory,
      whenToUse: profile.whenToUse,
      subagents: Object.keys(profile.subagents ?? {}).toSorted(),
    });
  }
}

function createSessionId(): string {
  return `session_${randomUUID()}`;
}

function telemetryErrorReason(error: unknown): string {
  if (error instanceof PythinkerError) return error.code;
  if (error instanceof Error && error.name.length > 0) return error.name;
  return typeof error;
}

function clientTelemetryProperties(client: ClientTelemetryInfo | undefined): TelemetryProperties {
  if (client === undefined) return {};
  const properties: Record<string, string> = {};
  addNonEmpty(properties, 'client_id', client.id);
  addNonEmpty(properties, 'client_name', client.name);
  addNonEmpty(properties, 'client_version', client.version);
  addNonEmpty(properties, 'ui_mode', client.uiMode);
  return properties;
}

function addNonEmpty(target: Record<string, string>, key: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    target[key] = trimmed;
  }
}

async function resumeSessionResult(
  summary: SessionSummary,
  session: Session,
  replayTurnLimit?: number,
): Promise<ResumeSessionResult> {
  const api = new SessionAPIImpl(session);
  const agents: Record<string, ResumedAgentState> = {};
  const agentIds = new Set([...session.agents.keys(), ...Object.keys(session.metadata.agents)]);
  for (const agentId of agentIds) {
    let entry = session.agents.get(agentId);
    if (entry === undefined) {
      entry = await (session as any).resumeAgent(agentId).catch(() => undefined);
    }
    if (!(entry instanceof Agent)) continue;
    const agent = entry;
    const config = await api.getConfig({ agentId });
    const context = await api.getContext({ agentId });
    const permission = await api.getPermission({ agentId });
    const plan = await api.getPlan({ agentId });
    const dynamicWorkflowMode = await api.getDynamicWorkflowMode({ agentId });
    const usage = await api.getUsage({ agentId });
    agents[agentId] = {
      type: agent.type,
      config,
      context,
      replay: limitAgentReplayByTurns(agent.replayBuilder.buildResult(), replayTurnLimit),
      permission,
      plan,
      dynamicWorkflowMode,
      usage,
      tools: await api.getTools({ agentId }),
      toolStore: agent.tools.storeData(),
      background: agent.background.list(false),
    };
  }
  return {
    ...summary,
    sessionMetadata: api.getSessionMetadata({}),
    agents,
  };
}

async function warnIfLogFlushFails(
  exportLog: Logger,
  message: string,
  flush: () => Promise<boolean>,
): Promise<void> {
  try {
    if (await flush()) return;
    exportLog.warn(message);
  } catch (error) {
    exportLog.warn(message, { error });
  }
  try {
    await flush();
  } catch {}
}
