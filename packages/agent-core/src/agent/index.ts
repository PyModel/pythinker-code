import { join } from 'pathe';

import { ErrorCodes, PythinkerError, makeErrorPayload } from '#/errors';
import { log } from '#/logging/logger';
import type { Logger } from '#/logging/types';
import type { AgentAPI, AgentEvent, PythinkerConfig, SDKAgentRPC, UsageStatus } from '#/rpc';
import { generate } from '@pythoughts/kosong';

import type { EnabledPluginSessionStart } from '#/plugin';

import type { McpConnectionManager } from '../mcp';
import { FlagResolver, type ExperimentalFlagResolver } from '../flags';
import type {
  OutputStyleConfig,
  PreparedSystemPromptContext,
  ResolvedAgentProfile,
} from '../profile';
import type { ModelProvider } from '../session/provider-manager';
import type { SessionFileCheckpointStore } from '../session/file-checkpoints';
import type { SessionSubagentHost } from '../session/subagent-host';
import { noopTelemetryClient, type TelemetryClient } from '../telemetry';
import type { PromisableMethods } from '../utils/types';
import { BackgroundManager, BackgroundTaskPersistence } from './background';
import {
  FullCompaction,
  MicroCompaction,
  type CompactionStrategy,
  type MicroCompactionConfig,
} from './compaction';
import { CronManager } from './cron';
import { ConfigState } from './config';
import { ContextMemory } from './context';
import { GoalMode } from './goal';
import { HookEngine } from '../session/hooks';
import { InjectionManager } from './injection/manager';
import { PermissionManager, type PermissionManagerOptions } from './permission';
import { PlanMode } from './plan';
import {
  AgentRecords,
  BlobStore,
  FileSystemAgentRecordPersistence,
  type AgentRecord,
  type AgentRecordPersistence,
} from './records';
import { ReplayBuilder, type ReplayBuilderOptions } from './replay';
import { SkillManager } from './skill';
import type { SkillRegistry } from './skill/types';
import { DynamicWorkflowMode } from './dynamic-workflow';
import { ToolManager } from './tool/index';
import { TurnFlow } from './turn';
import { KosongLLM } from './turn/kosong-llm';
import { UsageRecorder } from './usage';
import { LlmRequestLogger, splitGenerateOptions } from './llm-request-logger';
import { resolveCompletionBudget } from '../utils/completion-budget';
import type { Kaos } from '@pythoughts/kaos';
import type { ToolServices } from '../tools/support/services';
import type { SessionTaskGraph } from './task-graph';
import type { SessionTeam } from '../session/team';
import type { LspManager } from '../lsp';
import type { SessionWorktree } from '../session/worktree';

export type { AgentRecord, AgentRecordPersistence } from './records';
export {
  AGENT_WIRE_PROTOCOL_VERSION,
  assertAgentRecord,
  assertAgentWireProtocolVersion,
} from './records';
export type { DynamicWorkflowModeTrigger } from './dynamic-workflow';
export {
  renderSavedWorkflowSkill,
  savedWorkflowSkillDir,
  savedWorkflowSkillName,
  writeSavedWorkflowSkill,
} from './dynamic-workflow/save-as-skill';
export type { SavedWorkflow, SavedWorkflowScope } from './dynamic-workflow/save-as-skill';
export { resolveWorkflowSizeGuideline } from './dynamic-workflow/size-guideline';
export type { BuiltinTool, ToolInfo, ToolSource, UserToolRegistration } from './tool';
export * from './goal';

export type AgentType = 'main' | 'sub' | 'independent';

const CODING_INSTRUCTIONS_HEADING = '# General Guidelines for Coding';
const RESEARCH_INSTRUCTIONS_HEADING = '# General Guidelines for Research and Data Processing';

function withoutBundledCodingInstructions(prompt: string): string {
  const start = prompt.indexOf(CODING_INSTRUCTIONS_HEADING);
  const end = prompt.indexOf(RESEARCH_INSTRUCTIONS_HEADING, start);
  if (start === -1 || end === -1) return prompt;
  return `${prompt.slice(0, start)}${prompt.slice(end)}`.replaceAll(/\n{3,}/gu, '\n\n');
}

export interface AgentOptions {
  readonly kaos: Kaos;
  readonly config?: PythinkerConfig;
  readonly homedir?: string;
  readonly rpc?: Partial<SDKAgentRPC>;
  readonly persistence?: AgentRecordPersistence;
  readonly type?: AgentType;
  readonly generate?: typeof generate;
  readonly toolServices?: ToolServices;
  readonly compactionStrategy?: CompactionStrategy;
  readonly microCompaction?: Partial<MicroCompactionConfig>;
  readonly modelProvider?: ModelProvider | undefined;
  readonly subagentHost?: SessionSubagentHost | undefined;
  readonly skills?: SkillRegistry;
  readonly mcp?: McpConnectionManager;
  readonly hookEngine?: HookEngine;
  readonly permission?: PermissionManagerOptions | undefined;
  readonly log?: Logger;
  readonly telemetry?: TelemetryClient | undefined;
  readonly pluginSessionStarts?: readonly EnabledPluginSessionStart[];
  readonly experimentalFlags?: ExperimentalFlagResolver;
  readonly replay?: ReplayBuilderOptions;
  readonly taskGraph?: SessionTaskGraph;
  readonly team?: SessionTeam;
  readonly onAfterCompaction?: () => Promise<void>;
  readonly agentId?: string;
  readonly worktree?: SessionWorktree;
  readonly lsp?: LspManager;
  readonly additionalDirs?: readonly string[];
  readonly fileCheckpoints?: SessionFileCheckpointStore;
  readonly onEvent?: (event: AgentEvent) => void;
}

export class Agent {
  readonly type: AgentType;
  private _kaos: Kaos;
  private additionalDirectories: readonly string[];
  private _activeProfile: ResolvedAgentProfile | undefined;

  get kaos(): Kaos {
    return this._kaos;
  }

  readonly pythinkerConfig?: PythinkerConfig;
  readonly homedir?: string;
  readonly rpc?: Partial<SDKAgentRPC>;
  readonly toolServices?: ToolServices;
  readonly pluginSessionStarts: readonly EnabledPluginSessionStart[];
  readonly rawGenerate: typeof generate;
  readonly modelProvider?: ModelProvider;
  readonly subagentHost?: SessionSubagentHost;
  readonly mcp?: McpConnectionManager;
  readonly hooks?: HookEngine;
  readonly log: Logger;
  readonly telemetry: TelemetryClient;
  readonly experimentalFlags: ExperimentalFlagResolver;
  readonly taskGraph?: SessionTaskGraph;
  readonly team?: SessionTeam;
  readonly agentId: string;
  readonly worktree?: SessionWorktree;
  readonly lsp?: LspManager;
  private readonly fileCheckpoints?: SessionFileCheckpointStore;
  private readonly onEvent?: (event: AgentEvent) => void;
  private currentFileCheckpointId?: string;

  readonly llmRequestLogger: LlmRequestLogger;
  readonly blobStore: BlobStore | undefined;
  readonly records: AgentRecords;
  readonly fullCompaction: FullCompaction;
  readonly microCompaction: MicroCompaction;
  readonly context: ContextMemory;
  readonly config: ConfigState;
  readonly turn: TurnFlow;
  readonly injection: InjectionManager;
  readonly permission: PermissionManager;
  readonly planMode: PlanMode;
  readonly dynamicWorkflowMode: DynamicWorkflowMode;
  readonly usage: UsageRecorder;
  readonly skills: SkillManager | null;
  readonly tools: ToolManager;
  readonly background: BackgroundManager;
  readonly cron: CronManager | null;
  readonly goal: GoalMode;
  readonly replayBuilder: ReplayBuilder;

  constructor(options: AgentOptions) {
    this.type = options.type ?? 'main';
    this._kaos = options.kaos;
    this.additionalDirectories = [...(options.additionalDirs ?? [])];
    this.pythinkerConfig = options.config;
    this.homedir = options.homedir;
    this.rpc = options.rpc;
    this.toolServices = options.toolServices;
    this.pluginSessionStarts = options.pluginSessionStarts ?? [];
    this.rawGenerate = options.generate ?? generate;
    this.modelProvider = options.modelProvider;
    this.subagentHost = options.subagentHost;
    this.mcp = options.mcp;
    this.hooks = options.hookEngine;
    this.log = options.log ?? log;
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.experimentalFlags = options.experimentalFlags ?? new FlagResolver();
    this.taskGraph = options.taskGraph;
    this.team = options.team;
    this.agentId = options.agentId ?? options.type ?? 'main';
    this.worktree = options.worktree;
    this.lsp = options.lsp;
    this.fileCheckpoints = options.fileCheckpoints;
    this.onEvent = options.onEvent;

    this.llmRequestLogger = new LlmRequestLogger(this.log);
    this.blobStore = options.homedir
      ? new BlobStore({ blobsDir: join(options.homedir, 'blobs') })
      : undefined;
    this.records = new AgentRecords(
      this,
      options.persistence ??
        (options.homedir
          ? new FileSystemAgentRecordPersistence(join(options.homedir, 'wire.jsonl'), {
              onError: (error) => {
                this.emitRecordsWriteError(error);
              },
              blobStore: this.blobStore,
            })
          : undefined),
    );
    this.fullCompaction = new FullCompaction(
      this,
      options.compactionStrategy,
      options.onAfterCompaction,
    );
    this.microCompaction = new MicroCompaction(this, options.microCompaction);
    this.context = new ContextMemory(this);
    this.config = new ConfigState(this);
    this.turn = new TurnFlow(this);
    this.injection = new InjectionManager(this);
    this.permission = new PermissionManager(this, options.permission);
    this.planMode = new PlanMode(this);
    this.dynamicWorkflowMode = new DynamicWorkflowMode(this);
    this.usage = new UsageRecorder(this);
    this.skills = options.skills ? new SkillManager(this, options.skills) : null;
    this.tools = new ToolManager(this);
    this.background = new BackgroundManager(
      this,
      this.homedir === undefined ? undefined : new BackgroundTaskPersistence(this.homedir),
    );
    this.cron = this.type === 'sub' ? null : new CronManager(this);
    this.goal = new GoalMode(this);
    this.replayBuilder = new ReplayBuilder(this, options.replay);
  }

  setKaos(kaos: Kaos) {
    this._kaos = kaos;
  }

  get fileCheckpointId(): string | undefined {
    return this.currentFileCheckpointId;
  }

  setFileCheckpointId(checkpointId: string | undefined): void {
    this.currentFileCheckpointId = checkpointId;
  }

  async captureFileBeforeWrite(path: string): Promise<void> {
    const checkpointId = this.currentFileCheckpointId;
    if (this.fileCheckpoints === undefined || checkpointId === undefined) return;
    try {
      await this.fileCheckpoints.capture(checkpointId, path);
    } catch (error) {
      this.log.warn('file checkpoint capture failed', {
        checkpointId,
        path,
        error,
      });
    }
  }

  get additionalDirs(): readonly string[] {
    return this.additionalDirectories;
  }

  setAdditionalDirs(directories: readonly string[]): void {
    this.additionalDirectories = [...directories];
    if (this.config.hasProvider) {
      this.tools.initializeBuiltinTools();
    }
  }

  get generate(): typeof generate {
    return async (provider, systemPrompt, tools, history, callbacks, options) => {
      const { requestLogFields, generateOptions } = splitGenerateOptions(options);
      const modelAlias = this.config.modelAlias;
      const run = (requestOptions: Parameters<typeof generate>[5]) => {
        this.llmRequestLogger.logRequest({
          provider,
          modelAlias,
          systemPrompt,
          tools,
          messages: history,
          fields: requestLogFields,
        });
        return this.rawGenerate(provider, systemPrompt, tools, history, callbacks, requestOptions);
      };
      if (generateOptions?.auth !== undefined) {
        return run(generateOptions);
      }
      const withAuth =
        modelAlias === undefined
          ? undefined
          : this.modelProvider?.resolveAuth?.(modelAlias, { log: this.log });
      if (withAuth === undefined) {
        return run(generateOptions);
      }
      return withAuth((auth) => {
        return run({ ...generateOptions, auth });
      });
    };
  }

  get llm(): KosongLLM {
    // All provider-level request config (thinking, sampling params, thinking.keep)
    // is applied in ConfigState.provider so compaction shares it. See get provider().
    const provider = this.config.provider;
    const loopControl = this.pythinkerConfig?.loopControl;
    const completionBudgetConfig = resolveCompletionBudget({
      maxOutputSize: this.config.maxOutputSize,
      reservedContextSize: loopControl?.reservedContextSize,
    });
    return new KosongLLM({
      provider,
      systemPrompt: this.config.systemPrompt,
      capability: this.config.modelCapabilities,
      generate: this.generate,
      completionBudgetConfig,
      usedContextTokens: () => this.context.tokenCount,
    });
  }

  useProfile(
    profile: ResolvedAgentProfile,
    context?: PreparedSystemPromptContext,
    outputStyle?: Pick<OutputStyleConfig, 'name' | 'prompt' | 'keepCodingInstructions'>,
  ): void {
    this._activeProfile = profile;
    this.config.update({
      profileName: profile.name,
      systemPrompt: this.renderSystemPrompt(profile, context, outputStyle),
      maxStepsPerTurn: profile.maxTurns,
    });
    this.tools.setActiveTools(
      context?.agentMemoryPrompt === undefined
        ? profile.tools
        : [...new Set([...profile.tools, 'Read', 'Write', 'Edit'])],
    );
  }

  /** The profile whose render produced the current system prompt, if any. */
  get activeProfile(): ResolvedAgentProfile | undefined {
    return this._activeProfile;
  }

  /**
   * Renders the system prompt again and swaps it in, leaving the active tool
   * set and the turn limit as they are.
   *
   * The skill listing is baked into the prompt when the profile is applied, so
   * a skill discovered later — a saved workflow, an edited `SKILL.md` — stays
   * invisible to the model until the prompt is rebuilt. Re-applying the whole
   * profile would rebuild it, but it would also reset the tools of an agent
   * that is already running.
   *
   * Pass the profile the prompt was built from — `activeProfile` — so a main
   * agent running a non-default profile is not re-rendered as the default one.
   */
  refreshSystemPrompt(
    profile: ResolvedAgentProfile,
    context?: PreparedSystemPromptContext,
    outputStyle?: Pick<OutputStyleConfig, 'name' | 'prompt' | 'keepCodingInstructions'>,
  ): void {
    this._activeProfile = profile;
    this.config.update({
      systemPrompt: this.renderSystemPrompt(profile, context, outputStyle),
    });
  }

  private renderSystemPrompt(
    profile: ResolvedAgentProfile,
    context?: PreparedSystemPromptContext,
    outputStyle?: Pick<OutputStyleConfig, 'name' | 'prompt' | 'keepCodingInstructions'>,
  ): string {
    let profilePrompt = profile.systemPrompt({
      osEnv: this.kaos.osEnv,
      cwd: this.config.cwd,
      skills: this.skills?.registry,
      cwdListing: context?.cwdListing,
      gitContext: context?.gitContext,
      agentsMd: context?.agentsMd,
      additionalDirsInfo: this.additionalDirs
        .map((directory) => `- ${JSON.stringify(directory)}`)
        .join('\n'),
    });
    if (outputStyle !== undefined && outputStyle.keepCodingInstructions !== true) {
      profilePrompt = withoutBundledCodingInstructions(profilePrompt);
    }
    return [
      profilePrompt,
      context?.agentMemoryPrompt,
      outputStyle === undefined
        ? undefined
        : `# Output Style: ${outputStyle.name}\n${outputStyle.prompt}`,
    ]
      .filter((block): block is string => block !== undefined)
      .join('\n\n');
  }

  async resume(): Promise<void> {
    await this.records.replay();
    try {
      this.replayBuilder.postRestoring = true;
      this.goal.normalizeAfterReplay();
      await this.background.loadFromDisk();
      await this.background.reconcile();
      await this.cron?.loadFromDisk();
      this.context.finishResume();
      this.turn.finishResume();
    } finally {
      this.replayBuilder.postRestoring = false;
    }
  }

  get rpcMethods(): PromisableMethods<AgentAPI> {
    return {
      prompt: (payload) => {
        this.turn.prompt(payload.input, undefined, payload.outputSchema);
      },
      steer: (payload) => {
        this.telemetry.track('input_steer', { parts: payload.input.length });
        this.turn.steer(payload.input);
      },
      cancel: (payload) => {
        if (this.turn.hasActiveTurn) {
          this.telemetry.track('cancel', { from: 'streaming' });
        }
        this.turn.cancel(payload.turnId);
      },
      undoHistory: (payload) => {
        this.context.undo(payload.count);
      },
      setThinking: (payload) => {
        const wasEnabled = this.config.thinkingLevel !== 'off';
        this.config.update({ thinkingLevel: payload.level });
        const enabled = this.config.thinkingLevel !== 'off';
        if (enabled !== wasEnabled) {
          this.telemetry.track('thinking_toggle', { enabled });
        }
      },
      setFastMode: (payload) => {
        // Enabling is gated on current-provider support, but the preference
        // may stay on across model switches; unsupported models ignore it.
        if (payload.enabled && !this.config.fastModeSupported) {
          throw new PythinkerError(
            ErrorCodes.REQUEST_INVALID,
            'Fast mode is unavailable for the current model and provider.',
          );
        }
        if (this.config.fastMode === payload.enabled) return;
        this.config.update({ fastMode: payload.enabled });
        this.telemetry.track('fast_mode_toggle', { enabled: payload.enabled });
      },
      setPermission: (payload) => {
        const wasYolo = this.permission.mode === 'yolo';
        const wasAuto = this.permission.mode === 'auto';
        this.permission.setMode(payload.mode);
        const enabled = this.permission.mode === 'yolo';
        if (enabled !== wasYolo) {
          this.telemetry.track('yolo_toggle', { enabled });
        }
        const afkEnabled = this.permission.mode === 'auto';
        if (afkEnabled !== wasAuto) {
          this.telemetry.track('afk_toggle', { enabled: afkEnabled });
        }
      },
      setModel: (payload) => {
        // Validate the alias resolves before recording it so resume / runtime
        // callers fail fast on missing aliases instead of deferring to the
        // next prompt.
        const resolved = this.modelProvider?.resolveProviderConfig(payload.model);
        if (this.config.modelAlias !== payload.model) {
          this.config.update({ modelAlias: payload.model });
          this.telemetry.track('model_switch', { model: payload.model });
        }
        return {
          model: payload.model,
          providerName: resolved?.providerName,
        };
      },
      getModel: () => {
        return this.config.modelAlias ?? '';
      },
      enterPlan: async () => {
        await this.planMode.enter();
      },
      cancelPlan: (payload) => {
        this.planMode.cancel(payload.id);
      },
      clearPlan: () => this.planMode.clear(),
      enterDynamicWorkflow: (payload) => {
        this.dynamicWorkflowMode.enter(payload.trigger);
      },
      exitDynamicWorkflow: () => {
        this.dynamicWorkflowMode.exit();
      },
      getDynamicWorkflowMode: () => {
        return this.dynamicWorkflowMode.isActive;
      },
      beginCompaction: (payload) => {
        const hasPrompt = payload.promptFromEnd !== undefined;
        const hasDirection = payload.direction !== undefined;
        if (hasPrompt !== hasDirection) {
          throw new PythinkerError(
            ErrorCodes.REQUEST_INVALID,
            'Selected compaction requires both promptFromEnd and direction.',
          );
        }
        this.fullCompaction.begin({
          source: 'manual',
          instruction: payload.instruction,
          selection:
            payload.promptFromEnd === undefined || payload.direction === undefined
              ? undefined
              : {
                  promptFromEnd: payload.promptFromEnd,
                  direction: payload.direction,
                },
        });
      },
      cancelCompaction: () => {
        if (this.fullCompaction.isCompacting) {
          this.telemetry.track('cancel', { from: 'compacting' });
        }
        this.fullCompaction.cancel();
      },
      registerTool: (payload) => {
        this.tools.registerUserTool(payload);
      },
      unregisterTool: (payload) => {
        this.tools.unregisterUserTool(payload.name);
      },
      setActiveTools: (payload) => {
        this.tools.setActiveTools(payload.names);
      },
      stopBackground: (payload) => {
        void this.background.stop(payload.taskId, payload.reason);
      },
      clearContext: () => {
        this.context.clear();
      },
      activateSkill: (payload) => {
        if (this.skills === null) {
          throw new PythinkerError(ErrorCodes.SKILL_NOT_FOUND, `Skill "${payload.name}" was not found`);
        }
        return this.skills.activate(payload);
      },
      startBtw: () => this.subagentHost!.startBtw(),
      createGoal: (payload) => this.goal.createGoal(payload),
      getGoal: () => this.goal.getGoal(),
      pauseGoal: () => this.goal.pauseGoal(),
      resumeGoal: () => this.goal.resumeGoal(),
      cancelGoal: () => this.goal.cancelGoal(),
      getBackgroundOutput: (payload) => this.background.readOutput(payload.taskId, payload.tail),
      getContext: () => this.context.data(),
      getContextUsage: () => this.context.usageReport(),
      getConfig: () => this.config.data(),
      getPermission: () => this.permission.data(),
      getPlan: () => this.planMode.data(),
      getUsage: () => this.usage.data(),
      getTools: () => this.tools.data(),
      listContextFiles: () => this.tools.contextFiles(),
      getBackground: (payload) => this.background.list(payload.activeOnly ?? false, payload.limit),
    };
  }

  emitEvent(event: AgentEvent): void {
    if (this.records.restoring) return;
    try {
      this.onEvent?.(event);
    } catch (error) {
      this.log.warn('agent event observer failed', { error });
    }
    void this.rpc?.emitEvent?.(event);
  }

  emitStatusUpdated(): void {
    if (this.records.restoring) return;
    if (!this.config.hasModel) return;

    const contextTokens = this.context.tokenCount;
    const maxContextTokens = this.config.modelCapabilities.max_context_tokens;
    const contextUsage =
      maxContextTokens !== undefined && maxContextTokens > 0
        ? contextTokens / maxContextTokens
        : undefined;
    const usage: UsageStatus | undefined = this.usage.status();
    const model = this.config.model;

    this.emitEvent({
      type: 'agent.status.updated',
      model,
      contextTokens,
      maxContextTokens,
      contextUsage,
      planMode: this.planMode.isActive,
      dynamicWorkflowMode: this.dynamicWorkflowMode.isActive,
      // Keep the volatile status payload sparse; a model-bearing event with
      // either field absent means off/unsupported to event consumers.
      fastMode: this.config.fastMode || undefined,
      fastModeSupported: this.config.fastModeSupported || undefined,
      permission: this.permission.mode,
      usage,
      modelCostRates: this.config.modelCapabilities.cost,
    });
  }

  private emitRecordsWriteError(error: unknown, record?: AgentRecord | undefined): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error('wire record persist failed', {
      agentHomedir: this.homedir,
      recordType: record?.type,
      error,
    });
    this.emitEvent({
      type: 'error',
      ...makeErrorPayload(
        ErrorCodes.RECORDS_WRITE_FAILED,
        `Failed to write agent records: ${message}`,
        {
          details: { recordType: record?.type },
        },
      ),
    });
  }
}
