import { createHash, randomUUID } from 'node:crypto';

import { Disposable } from '#/_base/di/lifecycle';
import { onUnexpectedError } from '#/_base/errors/unexpectedError';
import { Emitter, type Event } from '#/_base/event';
import { userCancellationReason } from '#/_base/utils/abort';
import {
  readRetryAfterMs,
  retryBackoffDelays,
  sleepForRetry,
} from '#/_base/utils/retry';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService, type IAgentScopeHandle } from '#/_base/di/scope';
import { IFlagService } from '#/app/flag/flag';
import { IEventBus } from '#/app/event/eventBus';
import { DEFAULT_AGENT_PROFILE_NAME } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { newMessageId } from '#/agent/contextMemory/messageId';
import type { ContextMessage, PromptFileAttachment } from '#/agent/contextMemory/types';
import type { ContentPart } from '#/kosong/contract/message';
import { IAgentLoopService } from '#/agent/loop/loop';
import {
  AssistantDelta,
  ThinkingDelta,
  ToolCallDelta,
  TurnStarted,
  TurnStepCompleted,
  TurnStepInterrupted,
  TurnStepStarted,
} from '#/agent/loop/turnEvents';
import { TurnEnded, TurnPrompt, turnKey } from '#/agent/loop/turnOps';
import { PromptAccepted } from '#/agent/prompt/promptOps';
import {
  PromptAborted,
  PromptCompleted,
  PromptStarted,
  PromptSubmitted,
} from '#/agent/prompt/promptService';
import { IAgentStateService } from '#/agent/state/agentState';
import { IAgentProfileService } from '#/agent/profile/profile';
import { denyToolExecution } from '#/agent/toolExecutor/beforeToolExecuteEvent';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { IAgentTowerService } from '#/features/tower/tower';
import { agentContextOf } from '#/agent/scopeContext/scopeContext';
import { Error2, ErrorCodes, toPythinkerErrorPayload, unwrapErrorCause } from '#/errors';
import {
  APIEmptyResponseError,
  APITimeoutError,
  isRetryableGenerateError,
} from '#/kosong/contract/errors';
import { extractText } from '#/kosong/contract/message';
import { estimateTokensForContentParts } from '#/kosong/contract/tokens';
import type { TokenUsage } from '#/kosong/contract/usage';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import type { ModelRequester } from '#/kosong/model/modelRequester';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import { runAgentTurn } from '#/session/subagent/runAgentTurn';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionTokenCountingService } from '#/session/tokenCounting/sessionTokenCounting';
import { ISessionUsageService } from '#/session/usage/sessionUsage';
import { ISessionStateService } from '#/session/state/sessionState';
import { defineState } from '#/state/state';
import { IEventDispatcher } from '#/state/eventDispatcher';

import {
  EXPERT_TALK_VERSION,
  EXPERT_TALK_SCHEMA_VERSION,
  type ExpertTalkArmV1,
  type ExpertTalkBindingV1,
  type ExpertTalkChangedEvent,
  type ExpertTalkConfigV1,
  type ExpertTalkFailureReason,
  type ExpertTalkListRunsOptions,
  type ExpertTalkPairV1,
  type ExpertTalkRunPageV1,
  type ExpertTalkRunStatus,
  type ExpertTalkRunProgressV1,
  type ExpertTalkRunV1,
  type ExpertTalkStageProgressV1,
  type ExpertTalkStageArtifactV1,
  type ExpertTalkStartInput,
  type ExpertTalkStartResult,
  type ExpertTalkStatusV1,
  ISessionExpertTalkService,
} from './expertTalk';
import { EXPERT_TALK_FLAG_ID } from './flag';
import {
  assertContextAdmission,
  assertDistinctBindings,
  assertEligibleBinding,
  assertStageContext,
  admissionTokens,
  bindingFor,
  canonicalModelId,
  canonicalThinkingEffort,
  estimateInputTokens,
  EXPERT_TALK_FUSION_MAX_REQUESTS,
  EXPERT_TALK_FUSION_OUTPUT_TOKENS,
  EXPERT_TALK_FUSION_TOOL_RESULT_TOKENS,
  EXPERT_TALK_OPENING_MAX_REQUESTS,
  EXPERT_TALK_OPENING_OUTPUT_TOKENS,
  EXPERT_TALK_OPENING_TOOL_RESULT_TOKENS,
  EXPERT_TALK_PROVIDER_ATTEMPTS_PER_REQUEST,
  EXPERT_TALK_REVIEW_MAX_REQUESTS,
  EXPERT_TALK_REVIEW_OUTPUT_TOKENS,
  EXPERT_TALK_REVIEW_TOOL_RESULT_TOKENS,
  parseFusionResult,
  resourceVersion,
} from './expertTalkPure';
import {
  fusionPrompt,
  fusionRepairPrompt,
  openingPrompt,
  reviewPrompt,
} from './expertTalkPrompts';
import { EXPERT_TALK_PROFILE, EXPERT_TALK_TOOLS } from './profile';

type ExpertTalkPersistentRun = Omit<ExpertTalkRunV1, 'progress'>;

interface ExpertTalkPersistentState {
  readonly pair?: ExpertTalkPairV1;
  readonly runs: readonly ExpertTalkPersistentRun[];
  readonly inputs?: Readonly<Record<string, ExpertTalkInputSnapshot>>;
}

interface ExpertTalkInputSnapshot {
  readonly conversation: string;
  readonly content: readonly ContentPart[];
  readonly attachments?: readonly PromptFileAttachment[];
}

interface AcceptedRun {
  readonly run: ExpertTalkRunV1;
  readonly input: ExpertTalkInputSnapshot;
  readonly opensTranscript: boolean;
  readonly requesters: readonly [ModelRequester, ModelRequester];
}

interface Participant {
  readonly context: ReturnType<IAgentLifecycleService['get']> & object;
  readonly handle: IAgentScopeHandle;
}

interface StageLimits {
  readonly maxRequests: number;
  readonly maxToolCalls: number;
  readonly maxToolResultTokens: number;
  readonly maxOutputTokens: number;
  readonly acceptBudgetExhaustedOutput?: (text: string) => boolean;
  readonly validateOutput?: (text: string) => unknown;
  readonly repairPrompt?: (invalidOutput: string) => string;
}

type ExpertTalkProgressKey = Exclude<keyof ExpertTalkRunProgressV1, 'revision'>;

const EXPERT_TALK_STATE_KEY = 'state.json';
const OPENING_LIMITS: StageLimits = {
  maxRequests: EXPERT_TALK_OPENING_MAX_REQUESTS,
  maxToolCalls: 8,
  maxToolResultTokens: EXPERT_TALK_OPENING_TOOL_RESULT_TOKENS,
  maxOutputTokens: EXPERT_TALK_OPENING_OUTPUT_TOKENS,
  acceptBudgetExhaustedOutput: hasOpeningSections,
};
const REVIEW_LIMITS: StageLimits = {
  maxRequests: EXPERT_TALK_REVIEW_MAX_REQUESTS,
  maxToolCalls: 4,
  maxToolResultTokens: EXPERT_TALK_REVIEW_TOOL_RESULT_TOKENS,
  maxOutputTokens: EXPERT_TALK_REVIEW_OUTPUT_TOKENS,
  acceptBudgetExhaustedOutput: hasReviewSections,
};
const FUSION_LIMITS: StageLimits = {
  maxRequests: EXPERT_TALK_FUSION_MAX_REQUESTS,
  maxToolCalls: 4,
  maxToolResultTokens: EXPERT_TALK_FUSION_TOOL_RESULT_TOKENS,
  maxOutputTokens: EXPERT_TALK_FUSION_OUTPUT_TOKENS,
  validateOutput: parseFusionResult,
  repairPrompt: fusionRepairPrompt,
};
const CLEANUP_TIMEOUT_MS = 5_000;
const MAX_PERSISTED_RUNS = 100;
const TERMINAL_STATUSES = new Set<ExpertTalkRunStatus>([
  'COMPLETED',
  'CANCELLED',
  'FAILED_OPENING',
  'FAILED_REVIEW',
  'FAILED_FUSION',
  'INTERRUPTED',
]);

export const expertTalkStateKey = defineState<ExpertTalkPersistentState>(
  'expertTalk.state',
  () => ({ runs: [] }),
);

export class SessionExpertTalkService extends Disposable implements ISessionExpertTalkService {
  declare readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<ExpertTalkChangedEvent>;

  private readonly changeEmitter = this._register(new Emitter<ExpertTalkChangedEvent>());
  private readonly scope: string;
  private armValue: ExpertTalkArmV1 | undefined;
  private armOwnerId: string | undefined;
  private activeAbort: AbortController | undefined;
  private activeExecution: Promise<void> | undefined;
  private disposing = false;
  private updateQueue: Promise<unknown> = Promise.resolve();
  private runUpdateQueue: Promise<unknown> = Promise.resolve();
  private persistenceQueue: Promise<unknown> = Promise.resolve();
  private readonly transcriptTurns = new Map<string, number>();
  private readonly acceptedRuns = new Map<string, AcceptedRun>();
  private readonly completionClaims = new Set<string>();
  private readonly progressByRun = new Map<string, ExpertTalkRunProgressV1>();
  private readonly progressEmitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sessionId: string;

  constructor(
    @ISessionStateService private readonly states: ISessionStateService,
    @ISessionContext sessionContext: ISessionContext,
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IFlagService private readonly flags: IFlagService,
    @IModelCatalog private readonly models: IModelCatalog,
    @IAgentLifecycleService private readonly agents: IAgentLifecycleService,
  ) {
    super();
    this.states.contributeState(expertTalkStateKey);
    this.scope = sessionContext.scope('expert-talk');
    this.sessionId = sessionContext.sessionId;
    this.onDidChange = this.changeEmitter.event;
    this.ready = this.load();
  }

  private get data(): ExpertTalkPersistentState {
    return this.states.get(expertTalkStateKey);
  }

  private set data(value: ExpertTalkPersistentState) {
    this.states.set(expertTalkStateKey, value);
  }

  status(): ExpertTalkStatusV1 {
    const feature = this.flags.explain(EXPERT_TALK_FLAG_ID);
    const runs = this.data.runs;
    return {
      version: EXPERT_TALK_VERSION,
      enabled: feature?.enabled ?? this.flags.enabled(EXPERT_TALK_FLAG_ID),
      featureSource: feature?.source ?? 'default',
      config: this.configSnapshot(),
      pairValidation: this.pairValidation(),
      arm: this.armValue,
      activeRun: this.withProgress(runs.find((run) => !TERMINAL_STATUSES.has(run.status))),
      latestRun: this.withProgress(runs.at(-1)),
    };
  }

  configure(pair: ExpertTalkPairV1, expectedVersion?: string): Promise<ExpertTalkConfigV1> {
    return this.enqueue(async () => {
      await this.ready;
      this.assertEnabled();
      this.assertVersion(expectedVersion);
      this.assertNoActiveRun();
      const [lead, peer] = await Promise.all([
        this.resolveConfiguredModel(pair.fusionLeadModelId),
        this.resolveConfiguredModel(pair.peerModelId),
      ]);
      const canonical: ExpertTalkPairV1 = {
        fusionLeadModelId: canonicalModelId(lead),
        peerModelId: canonicalModelId(peer),
        fusionLeadThinkingEffort: canonicalThinkingEffort(
          pair.fusionLeadThinkingEffort,
          lead,
        ),
        peerThinkingEffort: canonicalThinkingEffort(pair.peerThinkingEffort, peer),
      };
      if (canonical.fusionLeadModelId === canonical.peerModelId) {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_PAIR_INVALID,
          'Fusion Lead and Peer Expert must be different configured models',
        );
      }
      assertEligibleBinding(bindingFor('fusion_lead', canonical.fusionLeadModelId, lead), []);
      assertEligibleBinding(bindingFor('peer', canonical.peerModelId, peer), []);
      this.data = { ...this.data, pair: canonical };
      this.armValue = undefined;
      this.armOwnerId = undefined;
      await this.persist();
      this.emitChange();
      return this.configSnapshot();
    });
  }

  clear(expectedVersion?: string): Promise<ExpertTalkConfigV1> {
    return this.enqueue(async () => {
      await this.ready;
      this.assertEnabled();
      this.assertVersion(expectedVersion);
      this.assertNoActiveRun();
      this.armValue = undefined;
      this.armOwnerId = undefined;
      this.data = { runs: this.data.runs, inputs: this.data.inputs };
      await this.persist();
      this.emitChange();
      return this.configSnapshot();
    });
  }

  arm(clientId: string, expectedVersion?: string): ExpertTalkArmV1 {
    this.assertEnabled();
    this.assertVersion(expectedVersion);
    if (this.data.pair === undefined) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_PAIR_NOT_CONFIGURED,
        'Configure a Discussion pair before arming it',
      );
    }
    if (this.armValue !== undefined) {
      throw new Error2(ErrorCodes.EXPERT_TALK_ALREADY_ARMED, 'Discussion is already armed');
    }
    if (this.activeRun() !== undefined) {
      throw new Error2(ErrorCodes.EXPERT_TALK_BUSY, 'A Discussion run is already active');
    }
    this.assertNoOtherController();
    this.armValue = { armId: randomUUID(), armedAt: new Date().toISOString() };
    this.armOwnerId = clientId;
    this.emitChange();
    return this.armValue;
  }

  disarm(clientId: string, armId?: string): void {
    this.assertEnabled();
    const arm = this.armValue;
    if (
      arm === undefined ||
      this.armOwnerId !== clientId ||
      (armId !== undefined && arm.armId !== armId)
    ) {
      throw new Error2(ErrorCodes.EXPERT_TALK_NOT_ARMED, 'Discussion is not armed');
    }
    this.armValue = undefined;
    this.armOwnerId = undefined;
    this.emitChange();
  }

  start(input: ExpertTalkStartInput): Promise<ExpertTalkStartResult> {
    return this.enqueue(() => this.accept(input, undefined, true));
  }

  listRuns(options: ExpertTalkListRunsOptions = {}): ExpertTalkRunPageV1 {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, 'Discussion run limit must be from 1 to 100');
    }
    const runs = this.data.runs.toReversed();
    const start = options.cursor === undefined
      ? 0
      : runs.findIndex((run) => run.runId === options.cursor) + 1;
    if (options.cursor !== undefined && start === 0) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, 'Discussion run cursor is invalid');
    }
    const items = runs.slice(start, start + limit).map((run) => this.withProgress(run)!);
    return {
      items,
      nextCursor: start + limit < runs.length ? items.at(-1)?.runId : undefined,
    };
  }

  hasPromptId(promptId: string): boolean {
    return this.data.runs.some((run) => run.promptId === promptId);
  }

  getRun(runId: string): ExpertTalkRunV1 {
    const run = this.data.runs.find((candidate) => candidate.runId === runId);
    if (run !== undefined) return this.withProgress(run)!;
    throw new Error2(
      ErrorCodes.EXPERT_TALK_RUN_NOT_FOUND,
      `Discussion run "${runId}" was not found`,
      { details: { runId } },
    );
  }

  cancel(runId: string): Promise<ExpertTalkRunV1> {
    return this.enqueue(async () => {
      await this.ready;
      const run = this.getRun(runId);
      if (TERMINAL_STATUSES.has(run.status)) return run;
      if (this.completionClaims.has(runId)) {
        await this.activeExecution;
        return this.getRun(runId);
      }
      this.activeAbort?.abort(userCancellationReason());
      const failure = runError('CANCELLED', 'Discussion was cancelled', stageOf(run.status));
      const cancelled = await this.updateRun(runId, {
        status: 'CANCELLED',
        error: failure,
        completedAt: new Date().toISOString(),
      }, run.status);
      if (!cancelled) return this.getRun(runId);
      await this.activeExecution;
      const accepted = this.acceptedRuns.get(runId);
      if (accepted?.opensTranscript === true) {
        await this.failTranscript(this.getRun(runId), 'CANCELLED', failure).catch(onUnexpectedError);
      }
      this.acceptedRuns.delete(runId);
      return this.getRun(runId);
    });
  }

  retry(runId: string): Promise<ExpertTalkStartResult> {
    return this.enqueue(async () => {
      const source = this.getRun(runId);
      if (!TERMINAL_STATUSES.has(source.status) || source.status === 'COMPLETED') {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_RUN_NOT_RETRYABLE,
          `Discussion run "${runId}" cannot be retried`,
          { details: { runId, status: source.status } },
        );
      }
      return this.accept(
        {
          armId: '',
          clientId: '',
          prompt: source.prompt,
          modalities: source.modalities,
          content: this.contentFor(source),
          attachments: this.attachmentsFor(source),
        },
        runId,
        false,
      );
    });
  }

  prepareControllerActivation(): void {
    if (this.activeRun() !== undefined) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_BUSY,
        'Cancel the active Discussion run before changing turn controllers',
      );
    }
    if (this.armValue === undefined) return;
    this.armValue = undefined;
    this.armOwnerId = undefined;
    this.emitChange();
  }

  releaseClient(clientId: string): void {
    if (this.armOwnerId !== clientId) return;
    this.armValue = undefined;
    this.armOwnerId = undefined;
    this.emitChange();
  }

  private async accept(
    input: ExpertTalkStartInput,
    retryOf: string | undefined,
    requireArm: boolean,
  ): Promise<ExpertTalkStartResult> {
    await this.ready;
    this.assertEnabled();
    if (this.activeRun() !== undefined) {
      throw new Error2(ErrorCodes.EXPERT_TALK_BUSY, 'A Discussion run is already active');
    }
    this.assertNoOtherController();
    const arm = this.armValue;
    if (
      requireArm &&
      (arm === undefined || arm.armId !== input.armId || this.armOwnerId !== input.clientId)
    ) {
      throw new Error2(ErrorCodes.EXPERT_TALK_NOT_ARMED, 'The Discussion arm is missing or stale');
    }
    const prompt = input.prompt.trim();
    if (prompt.length === 0) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, 'Discussion prompt must not be empty');
    }
    const source = retryOf === undefined ? undefined : this.getRun(retryOf);
    const sourceInput = retryOf === undefined ? undefined : this.data.inputs?.[retryOf];
    const accepted = await this.preflight(
      prompt,
      input.modalities ?? [],
      input.promptId,
      retryOf,
      input.content ?? [{ type: 'text', text: prompt }],
      input.attachments,
      source,
      sourceInput,
    );
    this.clearProgress();
    const previousArm = this.armValue;
    const previousArmOwner = this.armOwnerId;
    const previousData = this.data;
    if (requireArm) this.armValue = undefined;
    if (requireArm) this.armOwnerId = undefined;
    const retained = retainRunHistory(
      [...this.data.runs, accepted.run],
      { ...this.data.inputs, [accepted.run.runId]: accepted.input },
    );
    this.data = {
      ...this.data,
      ...retained,
    };
    try {
      await this.persist();
    } catch (error) {
      this.data = previousData;
      this.armValue = previousArm;
      this.armOwnerId = previousArmOwner;
      await this.persist().catch(() => undefined);
      throw error;
    }
    try {
      if (accepted.opensTranscript) {
        await this.openTranscript(accepted);
      } else {
        this.transcriptTurns.set(accepted.run.runId, accepted.run.turnId);
      }
    } catch (error) {
      const failure = runError(
        'INTERRUPTED',
        'Discussion could not open its accepted transcript turn',
        'opening',
      );
      await this.updateRun(accepted.run.runId, {
        status: 'INTERRUPTED',
        error: failure,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
    const controller = new AbortController();
    this.activeAbort = controller;
    this.acceptedRuns.set(accepted.run.runId, accepted);
    this.emitChange();
    const execution = this.executeRun(accepted, controller).catch(onUnexpectedError);
    this.activeExecution = execution;
    void execution.finally(() => {
      if (this.activeAbort === controller) this.activeAbort = undefined;
      if (this.activeExecution === execution) this.activeExecution = undefined;
    });
    return {
      runId: accepted.run.runId,
      promptId: accepted.run.promptId,
      status: accepted.run.status,
      createdAt: accepted.run.createdAt,
    };
  }

  private async preflight(
    prompt: string,
    modalities: readonly ('image' | 'audio' | 'video')[],
    promptId: string | undefined,
    retryOf: string | undefined,
    content: readonly ContentPart[],
    attachments: readonly PromptFileAttachment[] | undefined,
    source: ExpertTalkRunV1 | undefined,
    sourceInput: ExpertTalkInputSnapshot | undefined,
  ): Promise<AcceptedRun> {
    const pair = this.data.pair;
    if (pair === undefined) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_PAIR_NOT_CONFIGURED,
        'Configure a Discussion pair before starting a run',
      );
    }
    const main = this.requireMain();
    const mainProfile = main.accessor.get(IAgentProfileService);
    if (mainProfile.data().modelAlias === undefined) {
      await mainProfile.bind({
        profile: mainProfile.data().profileName ?? DEFAULT_AGENT_PROFILE_NAME,
      });
    }
    const loop = main.accessor.get(IAgentLoopService);
    if (loop.status().state !== 'idle' || loop.hasPendingRequests()) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_BUSY,
        'Discussion requires an idle main conversation',
      );
    }
    const resolve = (
      role: 'fusion_lead' | 'peer',
      requestedModelId: string,
      thinkingEffort: string | undefined,
    ) => {
      let requester: ModelRequester;
      try {
        requester = this.models.getRequester(requestedModelId);
      } catch (error) {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_PAIR_INVALID,
          `Discussion model "${requestedModelId}" is unavailable: ${errorMessage(error)}`,
          { cause: error, details: { modelId: requestedModelId } },
        );
      }
      const resolvedThinkingEffort = canonicalThinkingEffort(
        thinkingEffort,
        requester.model,
      );
      return {
        binding: bindingFor(role, requestedModelId, requester.model, {
          thinkingEffort: resolvedThinkingEffort,
        }),
        requester,
      };
    };
    const leadResolution = resolve(
      'fusion_lead',
      pair.fusionLeadModelId,
      pair.fusionLeadThinkingEffort,
    );
    const peerResolution = resolve('peer', pair.peerModelId, pair.peerThinkingEffort);
    const lead = leadResolution.binding;
    const peer = peerResolution.binding;
    assertEligibleBinding(lead, modalities);
    assertEligibleBinding(peer, modalities);
    assertDistinctBindings(lead, peer);
    const conversation = sourceInput?.conversation ?? projectConversation(
      main.accessor.get(IAgentContextMemoryService).get(),
    );
    const acceptedContent = sourceInput?.content ?? content;
    const acceptedAttachments = sourceInput?.attachments ?? attachments;
    const mediaTokens = estimateTokensForContentParts(
      acceptedContent.filter((part) => part.type !== 'text'),
    );
    assertContextAdmission(
      lead,
      peer,
      estimateInputTokens(`${conversation}\n${prompt}`, mediaTokens),
    );
    const acceptedPromptId = source?.promptId ?? promptId ?? newMessageId();
    if (
      source === undefined &&
      this.data.runs.some((candidate) => candidate.promptId === acceptedPromptId)
    ) {
      throw new Error2(
        ErrorCodes.PROMPT_ID_CONFLICT,
        `Prompt id "${acceptedPromptId}" already exists`,
      );
    }
    const now = new Date().toISOString();
    const turnId = source?.turnId ?? main.accessor.get(IAgentStateService).get(turnKey).nextTurnId;
    return {
      input: {
        conversation,
        content: acceptedContent,
        attachments: acceptedAttachments,
      },
      opensTranscript: source === undefined,
      requesters: [leadResolution.requester, peerResolution.requester],
      run: {
        schemaVersion: EXPERT_TALK_SCHEMA_VERSION,
        version: EXPERT_TALK_VERSION,
        runId: randomUUID(),
        sessionId: this.sessionId,
        turnId,
        promptId: acceptedPromptId,
        status: 'OPENING',
        prompt,
        modalities: [...new Set(modalities)],
        createdAt: now,
        startedAt: now,
        updatedAt: now,
        retryOf,
        bindings: [lead, peer],
        artifacts: {},
        revision: 1,
      },
    };
  }

  private async executeRun(accepted: AcceptedRun, controller: AbortController): Promise<void> {
    const wholeSignal = controller.signal;
    const participants: Participant[] = [];
    try {
      const lead = await this.createParticipant(
        accepted.run,
        'lead',
        accepted.run.bindings[0],
        accepted.requesters[0],
      );
      participants.push(lead);
      wholeSignal.throwIfAborted();
      const peer = await this.createParticipant(
        accepted.run,
        'peer',
        accepted.run.bindings[1],
        accepted.requesters[1],
      );
      participants.push(peer);
      const leadOpeningPrompt = openingPrompt({
        role: 'Fusion Lead',
        leadModel: accepted.run.bindings[0].effectiveModelId,
        peerModel: accepted.run.bindings[1].effectiveModelId,
        conversation: accepted.input.conversation,
        request: accepted.run.prompt,
      });
      const peerOpeningPrompt = openingPrompt({
        role: 'Peer Expert',
        leadModel: accepted.run.bindings[0].effectiveModelId,
        peerModel: accepted.run.bindings[1].effectiveModelId,
        conversation: accepted.input.conversation,
        request: accepted.run.prompt,
      });
      const openingResults = await Promise.allSettled([
        this.runStage(
          lead.handle,
          accepted.run.bindings[0],
          'lead opening',
          leadOpeningPrompt,
          OPENING_LIMITS,
          wholeSignal,
          `${accepted.run.runId}-lead-opening`,
          { runId: accepted.run.runId, key: 'leadOpening' },
          accepted.input.content,
        ),
        this.runStage(
          peer.handle,
          accepted.run.bindings[1],
          'peer opening',
          peerOpeningPrompt,
          OPENING_LIMITS,
          wholeSignal,
          `${accepted.run.runId}-peer-opening`,
          { runId: accepted.run.runId, key: 'peerOpening' },
          accepted.input.content,
        ),
      ]);
      const leadOpening = settledArtifact(openingResults[0]);
      const peerOpening = settledArtifact(openingResults[1]);
      await this.updateRun(accepted.run.runId, {
        artifacts: {
          leadOpening,
          peerOpening,
        },
      });
      if (leadOpening.status !== 'completed' || peerOpening.status !== 'completed') {
        throw new StageFailure(
          'FAILED_OPENING',
          'OPENING_FAILED',
          'A Discussion opening failed',
        );
      }
      wholeSignal.throwIfAborted();
      await this.updateRun(accepted.run.runId, { status: 'REVIEWING' });
      const run = this.getRun(accepted.run.runId);
      const reviewResults = await Promise.allSettled([
        this.runStage(
          lead.handle,
          run.bindings[0],
          'Fusion Lead review of Peer Expert',
          reviewPrompt({
            request: run.prompt,
            ownRole: 'Fusion Lead',
            ownModel: run.bindings[0].effectiveModelId,
            ownOpening: leadOpening.text!,
            peerRole: 'Peer Expert',
            peerModel: run.bindings[1].effectiveModelId,
            peerOpening: peerOpening.text!,
          }),
          REVIEW_LIMITS,
          wholeSignal,
          `${run.runId}-lead-review`,
          { runId: run.runId, key: 'leadReview' },
        ),
        this.runStage(
          peer.handle,
          run.bindings[1],
          'Peer Expert review of Fusion Lead',
          reviewPrompt({
            request: run.prompt,
            ownRole: 'Peer Expert',
            ownModel: run.bindings[1].effectiveModelId,
            ownOpening: peerOpening.text!,
            peerRole: 'Fusion Lead',
            peerModel: run.bindings[0].effectiveModelId,
            peerOpening: leadOpening.text!,
          }),
          REVIEW_LIMITS,
          wholeSignal,
          `${run.runId}-peer-review`,
          { runId: run.runId, key: 'peerReview' },
        ),
      ]);
      const leadReview = settledArtifact(reviewResults[0]);
      const peerReview = settledArtifact(reviewResults[1]);
      await this.updateRun(run.runId, {
        artifacts: { ...this.getRun(run.runId).artifacts, leadReview, peerReview },
      });
      if (leadReview.status !== 'completed' && peerReview.status !== 'completed') {
        throw new StageFailure('FAILED_REVIEW', 'REVIEW_FAILED', 'Both Discussion reviews failed');
      }
      wholeSignal.throwIfAborted();
      await this.updateRun(run.runId, { status: 'FUSING' });
      const fusion = await this.createParticipant(
        run,
        'fusion',
        run.bindings[0],
        accepted.requesters[0],
      );
      participants.push(fusion);
      let fusionArtifact: ExpertTalkStageArtifactV1;
      try {
        fusionArtifact = await this.runStage(
          fusion.handle,
          run.bindings[0],
          'fusion',
          fusionPrompt({
            request: run.prompt,
            leadModel: run.bindings[0].effectiveModelId,
            peerModel: run.bindings[1].effectiveModelId,
            leadOpening: leadOpening.text!,
            peerOpening: peerOpening.text!,
            leadReview: leadReview.status === 'completed' ? leadReview.text : undefined,
            peerReview: peerReview.status === 'completed' ? peerReview.text : undefined,
          }),
          FUSION_LIMITS,
          wholeSignal,
          `${run.runId}-fusion`,
          { runId: run.runId, key: 'fusion' },
          accepted.input.content,
        );
      } catch (error) {
        const reason = stageErrorReason(error) ?? 'FUSION_FAILED';
        await this.updateRun(run.runId, {
          artifacts: { ...this.getRun(run.runId).artifacts, fusion: failedArtifact(error) },
        });
        throw new StageFailure('FAILED_FUSION', reason, failureMessage(reason));
      }
      await this.updateRun(run.runId, {
        artifacts: { ...this.getRun(run.runId).artifacts, fusion: fusionArtifact },
      });
      let result;
      try {
        result = parseFusionResult(fusionArtifact.text!);
      } catch {
        throw new StageFailure(
          'FAILED_FUSION',
          'FUSION_RESULT_INVALID',
          'Fusion returned an invalid typed result',
        );
      }
      wholeSignal.throwIfAborted();
      const stored = await this.updateRun(
        run.runId,
        { result },
        'FUSING',
      );
      if (!stored) return;
      wholeSignal.throwIfAborted();
      this.completionClaims.add(run.runId);
      try {
        await this.completeTranscript(this.getRun(run.runId)).catch(onUnexpectedError);
        const completed = await this.updateRun(
          run.runId,
          { status: 'COMPLETED', completedAt: new Date().toISOString() },
          'FUSING',
        );
        if (completed) this.acceptedRuns.delete(run.runId);
      } finally {
        this.completionClaims.delete(run.runId);
      }
    } catch (error) {
      if (!this.disposing) {
        try {
          if (!TERMINAL_STATUSES.has(this.getRun(accepted.run.runId).status)) {
            await this.failAcceptedRun(accepted, error, wholeSignal);
          }
        } catch (failureError) {
          if (!this.disposing) onUnexpectedError(failureError);
        }
      }
    } finally {
      if (!this.disposing) await this.cleanupParticipants(accepted.run.runId, participants);
    }
  }

  private async failAcceptedRun(
    accepted: AcceptedRun,
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.disposing) return;
    const current = this.getRun(accepted.run.runId);
    const status = terminalStatus(error, current.status, signal);
    const failure = runFailure(error, status, current, signal);
    const completedAt = new Date().toISOString();
    try {
      const failed = await this.updateRun(
        accepted.run.runId,
        { status, error: failure, completedAt },
        current.status,
      );
      if (!failed) return;
      if (accepted.opensTranscript) {
        await this.failTranscript(this.getRun(accepted.run.runId), status, failure)
          .catch(onUnexpectedError);
      }
    } finally {
      this.acceptedRuns.delete(accepted.run.runId);
    }
  }

  private async cleanupParticipants(runId: string, participants: readonly Participant[]): Promise<void> {
    const cleanup = await Promise.all(
      participants.map(async (participant) => ({
        agentId: participant.context.agentId,
        removed: await this.cleanupParticipant(participant.context),
      })),
    );
    const newlyOrphanedIds = cleanup
      .filter((entry) => !entry.removed)
      .map((entry) => entry.agentId);
    if (newlyOrphanedIds.length > 0 && !this.disposing) {
      const current = this.getRun(runId);
      const orphanedParticipantIds = [
        ...new Set([...(current.orphanedParticipantIds ?? []), ...newlyOrphanedIds]),
      ];
      await this.updateRun(runId, { orphanedParticipantIds }).catch(onUnexpectedError);
    }
  }

  private async createParticipant(
    run: ExpertTalkRunV1,
    role: 'lead' | 'peer' | 'fusion',
    binding: ExpertTalkBindingV1,
    modelRequester: ModelRequester,
  ): Promise<Participant> {
    const agentId = `expert-talk-${run.runId.slice(0, 8)}-${role}-${randomUUID().slice(0, 8)}`;
    let context: ReturnType<IAgentLifecycleService['get']> & object;
    try {
      context = await this.agents.create({
        agentId,
        binding: {
          profile: EXPERT_TALK_PROFILE,
          model: binding.effectiveModelId,
          thinking: binding.thinkingEffort,
          strictThinking: binding.thinkingEffort !== undefined,
        },
        modelRequester,
        labels: {
          expertTalkRunId: run.runId,
          expertTalkRole: role,
          hidden: 'true',
        },
      });
    } catch (error) {
      const partial = this.agents.get(agentId);
      if (partial !== undefined) {
        const removed = await this.cleanupParticipant(partial);
        if (!removed && !this.disposing) {
          const current = this.getRun(run.runId);
          const orphanedParticipantIds = [
            ...new Set([...(current.orphanedParticipantIds ?? []), agentId]),
          ];
          await this.updateRun(run.runId, { orphanedParticipantIds }).catch(onUnexpectedError);
        }
      }
      throw error;
    }
    const handle = this.agents.handleOf(agentId);
    if (handle === undefined) {
      const removed = await this.cleanupParticipant(context);
      if (!removed && !this.disposing) {
        const current = this.getRun(run.runId);
        const orphanedParticipantIds = [
          ...new Set([...(current.orphanedParticipantIds ?? []), agentId]),
        ];
        await this.updateRun(run.runId, { orphanedParticipantIds }).catch(onUnexpectedError);
      }
      throw new Error2(ErrorCodes.INTERNAL, `Discussion participant "${agentId}" was not created`);
    }
    return { context, handle };
  }

  private async runStage(
    handle: IAgentScopeHandle,
    binding: ExpertTalkBindingV1,
    stage: string,
    prompt: string,
    limits: StageLimits,
    parentSignal: AbortSignal,
    budgetId: string,
    progressTarget: { readonly runId: string; readonly key: ExpertTalkProgressKey },
    userContent?: readonly ContentPart[],
  ): Promise<ExpertTalkStageArtifactV1> {
    const loop = handle.accessor.get(IAgentLoopService);
    const tools = handle.accessor.get(IAgentToolExecutorService);
    const profile = handle.accessor.get(IAgentProfileService);
    const usageService = handle.accessor.get(ISessionUsageService);
    const agentContext = agentContextOf(handle);
    const usageBefore = usageService.status(agentContext).total;
    const content = userContent === undefined
      ? [{ type: 'text' as const, text: prompt }]
      : [{ type: 'text' as const, text: prompt }, ...userContent.filter((part) => part.type !== 'text')];
    this.assertStageAdmission(handle, binding, stage, content, limits.maxOutputTokens);
    const startedAt = new Date().toISOString();
    this.setProgress(progressTarget.runId, progressTarget.key, {
      tools: [],
      startedAt,
    });
    const events = handle.accessor.get(IEventBus);
    const assistantProgress = events.subscribe(AssistantDelta, (event) => {
      this.updateProgress(progressTarget.runId, progressTarget.key, (current) => ({
        ...current,
        text: `${current.text ?? ''}${event.delta}`,
      }));
    });
    const thinkingProgress = events.subscribe(ThinkingDelta, (event) => {
      this.updateProgress(progressTarget.runId, progressTarget.key, (current) => ({
        ...current,
        thinking: `${current.thinking ?? ''}${event.delta}`,
      }));
    });
    const toolProgress = events.subscribe(ToolCallDelta, (event) => {
      this.updateProgress(progressTarget.runId, progressTarget.key, (current) => {
        const existing = current.tools.find((tool) => tool.id === event.toolCallId);
        return {
          ...current,
          tools: existing === undefined
            ? [...current.tools, { id: event.toolCallId, name: event.name }]
            : current.tools.map((tool) => tool.id === event.toolCallId
                ? { ...tool, name: event.name ?? tool.name }
                : tool),
        };
      });
    });
    let requestCount = 0;
    let providerAttemptCount = 0;
    let toolCallCount = 0;
    let toolResultTokens = 0;
    let forbiddenToolName: string | undefined;
    let retryPending = false;
    let lastProviderTimeout: APITimeoutError | undefined;
    let suspendedToolNames: readonly string[] | undefined;
    const retriesByDriver = new Map<string, number>();
    const maxProviderAttempts = limits.maxRequests * EXPERT_TALK_PROVIDER_ATTEMPTS_PER_REQUEST;
    const synthesisRequestStart = Math.max(1, limits.maxRequests - 1);
    const requestBudget = loop.hooks.onWillBeginStep.register(
      budgetId,
      async (_context, next) => {
        if (retryPending) {
          retryPending = false;
        } else {
          if (requestCount >= limits.maxRequests) {
            if (lastProviderTimeout !== undefined) throw lastProviderTimeout;
            throw new Error2(
              ErrorCodes.EXPERT_TALK_BUDGET_EXCEEDED,
              `Discussion stage exceeded ${String(limits.maxRequests)} model requests`,
            );
          }
          requestCount += 1;
          if (requestCount === synthesisRequestStart) {
            suspendedToolNames = profile.getActiveToolNames();
            if (suspendedToolNames === undefined) {
              throw new Error2(
                ErrorCodes.INTERNAL,
                'Discussion participant tool policy is not explicit',
              );
            }
            for (const name of suspendedToolNames) profile.removeActiveTool(name);
          }
        }
        providerAttemptCount += 1;
        this.assertStageAdmission(handle, binding, stage, undefined, limits.maxOutputTokens);
        await next();
      },
    );
    const retryBudget = loop.registerLoopErrorHandler(
      {
        id: `${budgetId}-provider-retry`,
        match: (context) => isRetryableGenerateError(unwrapErrorCause(context.error)),
        handle: async (context) => {
          const error = unwrapErrorCause(context.error);
          lastProviderTimeout = error instanceof APITimeoutError ? error : undefined;
          const driver = context.failedDriver;
          if (driver === undefined) return false;
          const retryCount = retriesByDriver.get(driver.id) ?? 0;
          const standardRetryAvailable = retryCount === 0;
          const finalEmptyRetryAvailable = error instanceof APIEmptyResponseError
            && requestCount >= synthesisRequestStart
            && providerAttemptCount < maxProviderAttempts;
          if (!standardRetryAvailable && !finalEmptyRetryAvailable) return false;
          retriesByDriver.set(driver.id, retryCount + 1);
          retryPending = true;
          const delayMs = readRetryAfterMs(error) ?? retryBackoffDelays(2)[0] ?? 0;
          await sleepForRetry(delayMs, context.signal);
          context.retry(driver, { at: 'head' });
          return true;
        },
      },
      { before: 'step-retry' },
    );
    const toolBudget = tools.onBeforeExecuteTool((event) => {
      toolCallCount += 1;
      if (toolCallCount <= limits.maxToolCalls) return;
      event.veto(
        denyToolExecution(
          `Discussion stage exceeded ${String(limits.maxToolCalls)} read-only tool calls`,
        ),
      );
    });
    const toolResultBudget = tools.hooks.onDidExecuteTool.register(
      `${budgetId}-tool-results`,
      async (context, next) => {
        if (!EXPERT_TALK_TOOLS.some((name) => name === context.toolCall.name)) {
          forbiddenToolName = context.toolCall.name;
          context.result = {
            output: `Tool "${context.toolCall.name}" is not allowed in Discussion.`,
            isError: true,
          };
          context.stopTurn = true;
          await next();
          return;
        }
        const tokens = estimateToolResultTokens(context.result.output);
        if (toolResultTokens + tokens <= limits.maxToolResultTokens) {
          toolResultTokens += tokens;
        } else {
          const remaining = Math.max(0, limits.maxToolResultTokens - toolResultTokens);
          context.result = {
            output: `Discussion tool result exceeded the remaining ${String(remaining)} token budget. Request a narrower read.`,
            isError: true,
          };
          toolResultTokens += estimateToolResultTokens(context.result.output);
        }
        await next();
      },
    );
    const signal = parentSignal;
    try {
      const request = async (
        requestPrompt: string,
        requestContent: readonly ContentPart[],
      ): Promise<string> => {
        const result = await runAgentTurn(
          handle,
          {
            kind: 'prompt',
            prompt: requestPrompt,
            content: requestContent,
          },
          { signal, maxOutputSize: limits.maxOutputTokens, infiniteRetry: false },
        );
        const completion = await result.completion;
        signal.throwIfAborted();
        if (forbiddenToolName !== undefined) {
          throw new Error(`Tool "${forbiddenToolName}" is not allowed in Discussion`);
        }
        const text = completion.summary.trim();
        if (text.length === 0) throw new Error('Discussion stage returned an empty answer');
        if (/<[｜|]?\s*(?:DSML[｜|]?)?(?:tool_calls|invoke)\b/i.test(text)) {
          throw new Error('Discussion stage output contains unparsed tool call markup');
        }
        return text;
      };
      let text = await request(prompt, content);
      if (limits.validateOutput !== undefined) {
        try {
          limits.validateOutput(text);
        } catch {
          if (limits.repairPrompt === undefined || requestCount >= limits.maxRequests) {
            throw new StageFailure(
              'FAILED_FUSION',
              'FUSION_RESULT_INVALID',
              'Fusion returned an invalid typed result',
            );
          }
          const repairPrompt = limits.repairPrompt(text);
          text = await request(repairPrompt, [{ type: 'text', text: repairPrompt }]);
          try {
            limits.validateOutput(text);
          } catch {
            throw new StageFailure(
              'FAILED_FUSION',
              'FUSION_RESULT_INVALID',
              'Fusion returned an invalid typed result after repair',
            );
          }
        }
      }
      const visibleOutputTokens = handle.accessor
        .get(ISessionTokenCountingService)
        .estimateText(text);
      const usage = usageDelta(usageService.status(agentContext).total, usageBefore);
      if (visibleOutputTokens > limits.maxOutputTokens) {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_BUDGET_EXCEEDED,
          `Discussion stage exceeded ${String(limits.maxOutputTokens)} output tokens`,
          { details: { outputTokens: visibleOutputTokens, limit: limits.maxOutputTokens } },
        );
      }
      const tools = this.progressByRun.get(progressTarget.runId)?.[progressTarget.key]?.tools;
      return {
        status: 'completed',
        text,
        digest: digestText(text),
        tools,
        startedAt,
        endedAt: new Date().toISOString(),
        usage,
        requestCount,
        providerAttemptCount,
        toolCallCount,
        toolResultTokens,
      };
    } catch (error) {
      const partialText = latestAssistantText(
        handle.accessor.get(IAgentContextMemoryService).get(),
      ).trim();
      const usage = usageDelta(usageService.status(agentContext).total, usageBefore);
      const errorReason = stageErrorReason(error);
      const visibleOutputTokens = handle.accessor
        .get(ISessionTokenCountingService)
        .estimateText(partialText);
      const tools = this.progressByRun.get(progressTarget.runId)?.[progressTarget.key]?.tools;
      if (
        errorReason === 'STAGE_REQUEST_BUDGET_EXCEEDED'
        && partialText.length > 0
        && limits.acceptBudgetExhaustedOutput?.(partialText) === true
        && visibleOutputTokens <= limits.maxOutputTokens
      ) {
        return {
          status: 'completed',
          text: partialText,
          digest: digestText(partialText),
          tools,
          partial: true,
          startedAt,
          endedAt: new Date().toISOString(),
          usage,
          requestCount,
          providerAttemptCount,
          toolCallCount,
          toolResultTokens,
        };
      }
      const safeError = safeStageError(error);
      throw new StageExecutionError(
        safeError,
        {
          status: 'failed',
          text: partialText.length === 0 ? undefined : partialText,
          digest: partialText.length === 0 ? undefined : digestText(partialText),
          tools,
          error: safeError,
          errorReason,
          partial: partialText.length > 0,
          startedAt,
          endedAt: new Date().toISOString(),
          usage,
          requestCount,
          providerAttemptCount,
          toolCallCount,
          toolResultTokens,
        },
        error,
      );
    } finally {
      assistantProgress.dispose();
      thinkingProgress.dispose();
      toolProgress.dispose();
      requestBudget.dispose();
      retryBudget.dispose();
      toolBudget.dispose();
      toolResultBudget.dispose();
      for (const name of suspendedToolNames ?? []) profile.addActiveTool(name);
    }
  }

  private assertStageAdmission(
    handle: IAgentScopeHandle,
    binding: ExpertTalkBindingV1,
    stage: string,
    content: readonly ContentPart[] | undefined,
    outputTokens: number,
  ): void {
    const tokenCounting = handle.accessor.get(ISessionTokenCountingService);
    const profile = handle.accessor.get(IAgentProfileService);
    const tools = handle.accessor.get(IAgentToolRegistryService).list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {},
      deferred: tool.disclosure === 'deferred' ? true as const : undefined,
    }));
    const memory = handle.accessor.get(IAgentContextMemoryService).get();
    const messages = content === undefined
      ? memory
      : [...memory, { role: 'user' as const, content: [...content], toolCalls: [] }];
    const estimate = admissionTokens(
      tokenCounting.estimateText(profile.getSystemPrompt()) +
      tokenCounting.estimateTools(tools) +
      tokenCounting.estimateMessages(messages),
    );
    assertStageContext(binding, estimate, outputTokens, stage);
  }

  private async cleanupParticipant(
    context: NonNullable<ReturnType<IAgentLifecycleService['get']>>,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (removed: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(removed);
      };
      const timer = setTimeout(() => finish(false), CLEANUP_TIMEOUT_MS);
      void this.agents.remove(context).then(
        () => finish(true),
        () => finish(false),
      );
    });
  }

  private async openTranscript(accepted: AcceptedRun): Promise<void> {
    const { run } = accepted;
    const main = this.requireMain();
    const dispatcher = main.accessor.get(IEventDispatcher);
    const memory = main.accessor.get(IAgentContextMemoryService);
    const turnId = run.turnId;
    const content = [...accepted.input.content];
    const now = new Date().toISOString();
    await dispatcher.dispatch(
      new PromptAccepted({ agentId: MAIN_AGENT_ID, promptId: run.promptId, content }),
    );
    await dispatcher.dispatch(
      new TurnPrompt({
        agentId: MAIN_AGENT_ID,
        input: content,
        origin: { kind: 'user', attachments: accepted.input.attachments },
      }),
    );
    memory.append({
      id: run.promptId,
      role: 'user',
      content,
      toolCalls: [],
      origin: { kind: 'user', attachments: accepted.input.attachments },
    });
    void dispatcher.dispatch(
      new PromptSubmitted({
        agentId: MAIN_AGENT_ID,
        promptId: run.promptId,
        userMessageId: run.promptId,
        status: 'running',
        content,
        createdAt: now,
      }),
    ).catch(onUnexpectedError);
    void dispatcher.dispatch(
      new PromptStarted({ agentId: MAIN_AGENT_ID, promptId: run.promptId }),
    ).catch(onUnexpectedError);
    void dispatcher.dispatch(
      new TurnStarted({
        agentId: MAIN_AGENT_ID,
        turnId,
        origin: { kind: 'user' },
        prompt: run.prompt,
      }),
    ).catch(onUnexpectedError);
    void dispatcher.dispatch(
      new TurnStepStarted({ agentId: MAIN_AGENT_ID, turnId, step: 1 }),
    ).catch(onUnexpectedError);
    this.transcriptTurns.set(run.runId, turnId);
  }

  private async completeTranscript(run: ExpertTalkRunV1): Promise<void> {
    const result = run.result;
    if (result === undefined) return;
    try {
      const main = this.requireMain();
      const dispatcher = main.accessor.get(IEventDispatcher);
      const memory = main.accessor.get(IAgentContextMemoryService);
      const turnId = this.transcriptTurns.get(run.runId) ?? run.turnId;
      memory.append({
        role: 'assistant',
        content: [{ type: 'text', text: result.answer }],
        toolCalls: [],
        origin: { kind: 'system_trigger', name: 'expert_talk' },
      });
      void dispatcher.dispatch(
        new AssistantDelta({ agentId: MAIN_AGENT_ID, turnId, delta: result.answer }),
      ).catch(onUnexpectedError);
      void dispatcher.dispatch(
        new TurnStepCompleted({ agentId: MAIN_AGENT_ID, turnId, step: 1 }),
      ).catch(onUnexpectedError);
      await dispatcher.dispatch(
        new TurnEnded({ agentId: MAIN_AGENT_ID, turnId, reason: 'completed' }),
      );
      void dispatcher.dispatch(
        new PromptCompleted({
          agentId: MAIN_AGENT_ID,
          promptId: run.promptId,
          finishedAt: new Date().toISOString(),
          reason: 'completed',
        }),
      ).catch(onUnexpectedError);
    } finally {
      this.transcriptTurns.delete(run.runId);
    }
  }

  private async failTranscript(
    run: ExpertTalkRunV1,
    status: ExpertTalkRunStatus,
    error: NonNullable<ExpertTalkRunV1['error']>,
  ): Promise<void> {
    try {
      const main = this.requireMain();
      const dispatcher = main.accessor.get(IEventDispatcher);
      const turnId = this.transcriptTurns.get(run.runId) ?? run.turnId;
      const cancelled = status === 'CANCELLED';
      void dispatcher.dispatch(
        new TurnStepInterrupted({
          agentId: MAIN_AGENT_ID,
          turnId,
          step: 1,
          reason: cancelled ? 'user_cancelled' : 'error',
          message: error.message,
        }),
      ).catch(onUnexpectedError);
      await dispatcher.dispatch(
        new TurnEnded({
          agentId: MAIN_AGENT_ID,
          turnId,
          reason: cancelled ? 'cancelled' : 'failed',
          error: cancelled
            ? undefined
            : toPythinkerErrorPayload(new Error2(ErrorCodes.INTERNAL, error.message)),
        }),
      );
      if (cancelled) {
        void dispatcher.dispatch(
          new PromptAborted({
            agentId: MAIN_AGENT_ID,
            promptId: run.promptId,
            abortedAt: new Date().toISOString(),
          }),
        ).catch(onUnexpectedError);
      } else {
        void dispatcher.dispatch(
          new PromptCompleted({
            agentId: MAIN_AGENT_ID,
            promptId: run.promptId,
            finishedAt: new Date().toISOString(),
            reason: 'failed',
          }),
        ).catch(onUnexpectedError);
      }
    } finally {
      this.transcriptTurns.delete(run.runId);
    }
  }

  private async updateRun(
    runId: string,
    patch: Partial<Omit<ExpertTalkPersistentRun, 'runId' | 'version'>>,
    expectedStatus?: ExpertTalkRunStatus,
  ): Promise<boolean> {
    const work = async (): Promise<boolean> => {
      const current = this.data.runs.find((run) => run.runId === runId);
      if (current === undefined) {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_RUN_NOT_FOUND,
          `Discussion run "${runId}" was not found`,
          { details: { runId } },
        );
      }
      if (expectedStatus !== undefined && current.status !== expectedStatus) return false;
      if (TERMINAL_STATUSES.has(current.status)) {
        const keys = Object.keys(patch);
        if (keys.length !== 1 || keys[0] !== 'orphanedParticipantIds') return false;
      }
      const nextRun: ExpertTalkPersistentRun = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
        revision: current.revision + 1,
      };
      const previousData = this.data;
      const nextData: ExpertTalkPersistentState = {
        ...previousData,
        runs: previousData.runs.map((run) => run.runId === runId ? nextRun : run),
      };
      this.data = nextData;
      try {
        await this.persist(nextData);
      } catch (error) {
        if (this.data === nextData) this.data = previousData;
        throw error;
      }
      this.emitChange();
      return true;
    };
    const update = this.runUpdateQueue.then(work, work);
    this.runUpdateQueue = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  private activeRun(): ExpertTalkRunV1 | undefined {
    return this.data.runs.find((run) => !TERMINAL_STATUSES.has(run.status));
  }

  private withProgress(run: ExpertTalkRunV1 | undefined): ExpertTalkRunV1 | undefined {
    if (run === undefined) return undefined;
    const progress = this.progressByRun.get(run.runId);
    return progress === undefined ? run : { ...run, progress };
  }

  private setProgress(
    runId: string,
    key: ExpertTalkProgressKey,
    progress: ExpertTalkStageProgressV1,
  ): void {
    const current = this.progressByRun.get(runId);
    this.progressByRun.set(runId, {
      ...current,
      revision: (current?.revision ?? 0) + 1,
      [key]: progress,
    });
    this.scheduleProgressEmit(runId);
  }

  private updateProgress(
    runId: string,
    key: ExpertTalkProgressKey,
    update: (progress: ExpertTalkStageProgressV1) => ExpertTalkStageProgressV1,
  ): void {
    const current = this.progressByRun.get(runId)?.[key];
    if (current === undefined) return;
    this.setProgress(runId, key, update(current));
  }

  private scheduleProgressEmit(runId: string): void {
    if (this.progressEmitTimers.has(runId)) return;
    this.progressEmitTimers.set(runId, setTimeout(() => {
      this.progressEmitTimers.delete(runId);
      if (this.data.runs.some((run) => run.runId === runId)) this.emitChange();
    }, 100));
  }

  private clearProgress(): void {
    this.progressByRun.clear();
    for (const timer of this.progressEmitTimers.values()) clearTimeout(timer);
    this.progressEmitTimers.clear();
  }

  override dispose(): void {
    this.disposing = true;
    this.activeAbort?.abort(userCancellationReason());
    this.clearProgress();
    super.dispose();
  }

  private configSnapshot(): ExpertTalkConfigV1 {
    return {
      version: EXPERT_TALK_VERSION,
      resourceVersion: resourceVersion(this.data.pair, this.armValue?.armId),
      pair: this.data.pair,
    };
  }

  private pairValidation() {
    const pair = this.data.pair;
    if (pair === undefined) return { state: 'unknown' as const, reason: 'Pair not configured' };
    try {
      const resolve = (requested: string) => this.models.get(requested);
      const leadModel = resolve(pair.fusionLeadModelId);
      const peerModel = resolve(pair.peerModelId);
      canonicalThinkingEffort(pair.fusionLeadThinkingEffort, leadModel);
      canonicalThinkingEffort(pair.peerThinkingEffort, peerModel);
      const lead = bindingFor('fusion_lead', pair.fusionLeadModelId, leadModel);
      const peer = bindingFor('peer', pair.peerModelId, peerModel);
      assertEligibleBinding(lead, []);
      assertEligibleBinding(peer, []);
      assertDistinctBindings(lead, peer);
      return { state: 'valid' as const };
    } catch (error) {
      if (error instanceof Error2 && error.code === ErrorCodes.EXPERT_TALK_PAIR_COLLAPSED) {
        return { state: 'collapsed' as const, reason: error.message };
      }
      if (error instanceof Error2 && error.code === ErrorCodes.EXPERT_TALK_PAIR_INVALID) {
        return { state: 'ineligible' as const, reason: error.message };
      }
      const message = errorMessage(error);
      return {
        state: /not configured|not found|does not exist/i.test(message) ? 'stale' as const : 'unknown' as const,
        reason: message,
      };
    }
  }

  private assertEnabled(): void {
    if (this.flags.enabled(EXPERT_TALK_FLAG_ID)) return;
    throw new Error2(
      ErrorCodes.EXPERT_TALK_FEATURE_DISABLED,
      'Discussion is disabled by the experimental feature flag',
    );
  }

  private assertNoOtherController(): void {
    const main = this.agents.handleOf(MAIN_AGENT_ID);
    if (main === undefined) return;
    if (
      !main.accessor.get(IAgentDynamicWorkflowService).isActive &&
      !main.accessor.get(IAgentTowerService).isActive
    ) {
      return;
    }
    throw new Error2(
      ErrorCodes.EXPERT_TALK_BUSY,
      'Disable Dynamic Workflow or Tower before arming Discussion',
    );
  }

  private assertVersion(expectedVersion: string | undefined): void {
    if (expectedVersion === undefined) return;
    const currentVersion = resourceVersion(this.data.pair, this.armValue?.armId);
    if (expectedVersion === currentVersion) return;
    throw new Error2(
      ErrorCodes.EXPERT_TALK_CONFIG_VERSION_CONFLICT,
      'Discussion configuration changed since it was read',
      { details: { expectedVersion, currentVersion } },
    );
  }

  private async resolveConfiguredModel(input: string): Promise<Model> {
    const models = await this.models.listModels();
    const exact = models.find((item) => item.model === input);
    if (exact !== undefined) return this.models.get(exact.model);
    const matches = this.models.findByName(input);
    if (matches.length === 1) return this.models.get(matches[0]!);
    if (matches.length === 0) {
      throw new Error2(
        ErrorCodes.EXPERT_TALK_PAIR_INVALID,
        `Model "${input}" is not configured`,
        { details: { model: input } },
      );
    }
    throw new Error2(
      ErrorCodes.EXPERT_TALK_PAIR_INVALID,
      `Model name "${input}" is ambiguous`,
      { details: { model: input, matches } },
    );
  }

  private assertNoActiveRun(): void {
    if (this.activeRun() === undefined) return;
    throw new Error2(
      ErrorCodes.EXPERT_TALK_BUSY,
      'Discussion configuration cannot change while a run is active',
    );
  }

  private requireMain(): IAgentScopeHandle {
    const main = this.agents.handleOf(MAIN_AGENT_ID);
    if (main !== undefined) return main;
    throw new Error2(ErrorCodes.AGENT_NOT_FOUND, 'The main agent is not available');
  }

  private contentFor(run: ExpertTalkRunV1): readonly ContentPart[] {
    const message = this.requireMain()
      .accessor.get(IAgentContextMemoryService)
      .get()
      .find((candidate) => candidate.id === run.promptId && candidate.role === 'user');
    return message?.content ?? [{ type: 'text', text: run.prompt }];
  }

  private attachmentsFor(run: ExpertTalkRunV1): readonly PromptFileAttachment[] | undefined {
    const message = this.requireMain()
      .accessor.get(IAgentContextMemoryService)
      .get()
      .find((candidate) => candidate.id === run.promptId && candidate.role === 'user');
    return message?.origin?.kind === 'user' ? message.origin.attachments : undefined;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.updateQueue.then(work, work);
    this.updateQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async load(): Promise<void> {
    const stored = await this.store.get<ExpertTalkPersistentState>(this.scope, EXPERT_TALK_STATE_KEY);
    if (stored === undefined) return;
    const storedRuns = stored.runs ?? [];
    const forked = storedRuns.some((run) => run.sessionId !== this.sessionId);
    const sourceRuns = forked ? [] : storedRuns;
    const interruptedRunIds = new Set(
      sourceRuns.filter((run) => !TERMINAL_STATUSES.has(run.status)).map((run) => run.runId),
    );
    const interruptedAt = new Date().toISOString();
    const runs = sourceRuns.map((run) =>
      TERMINAL_STATUSES.has(run.status)
        ? run
        : {
            ...run,
            status: 'INTERRUPTED' as const,
            error: runError(
              'INTERRUPTED',
              'Discussion was interrupted by process shutdown',
              stageOf(run.status),
            ),
            updatedAt: interruptedAt,
            completedAt: interruptedAt,
            revision: run.revision + 1,
          },
    );
    const orphans = this.agents.list({ prefix: 'expert-talk-' });
    const orphanIds = orphans.map((agent) => agent.agentId);
    const recoveredRuns = runs.map((run) => {
      const prefix = `expert-talk-${run.runId.slice(0, 8)}-`;
      const matching = orphanIds.filter((agentId) => agentId.startsWith(prefix));
      return matching.length === 0
        ? run
        : {
            ...run,
            orphanedParticipantIds: [
              ...new Set([...(run.orphanedParticipantIds ?? []), ...matching]),
            ],
          };
    });
    const sourceInputs = forked ? {} : stored.inputs ?? {};
    const retained = retainRunHistory(recoveredRuns, sourceInputs);
    this.data = {
      pair: stored.pair,
      ...retained,
    };
    await Promise.allSettled(orphans.map((agent) => this.agents.remove(agent)));
    const recoveredInterruptedRuns = retained.runs.filter((run) =>
      interruptedRunIds.has(run.runId));
    if (recoveredInterruptedRuns.length > 0) {
      if (this.agents.handleOf(MAIN_AGENT_ID) === undefined) {
        await this.agents.create({ agentId: MAIN_AGENT_ID });
      }
      for (const run of recoveredInterruptedRuns) {
        await this.failTranscript(
          run,
          'INTERRUPTED',
          run.error ?? runError('INTERRUPTED', 'Discussion was interrupted', stageOf(run.status)),
        ).catch(onUnexpectedError);
      }
    }
    const historyPruned = retained.runs.length !== recoveredRuns.length
      || Object.keys(retained.inputs ?? {}).length !== Object.keys(sourceInputs).length;
    if (
      forked
      || recoveredRuns.some((run, index) => run !== sourceRuns[index])
      || orphans.length > 0
      || historyPruned
    ) {
      await this.persist();
    }
  }

  private persist(data: ExpertTalkPersistentState = this.data): Promise<void> {
    const write = this.persistenceQueue.then(
      () => this.store.set(this.scope, EXPERT_TALK_STATE_KEY, data),
      () => this.store.set(this.scope, EXPERT_TALK_STATE_KEY, data),
    );
    this.persistenceQueue = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  private emitChange(): void {
    this.changeEmitter.fire({ status: this.status() });
  }
}

function retainRunHistory(
  runs: readonly ExpertTalkPersistentRun[],
  inputs: Readonly<Record<string, ExpertTalkInputSnapshot>>,
): Pick<ExpertTalkPersistentState, 'runs' | 'inputs'> {
  const retainedRuns = runs.slice(-MAX_PERSISTED_RUNS);
  const retainedInputs: Record<string, ExpertTalkInputSnapshot> = {};
  for (const run of retainedRuns) {
    const input = inputs[run.runId];
    if (input !== undefined) retainedInputs[run.runId] = input;
  }
  return { runs: retainedRuns, inputs: retainedInputs };
}

class StageFailure extends Error {
  constructor(
    readonly status: Extract<
      ExpertTalkRunStatus,
      'FAILED_OPENING' | 'FAILED_REVIEW' | 'FAILED_FUSION'
    >,
    readonly reason: ExpertTalkFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'StageFailure';
  }
}

class StageExecutionError extends Error {
  constructor(
    message: string,
    readonly artifact: ExpertTalkStageArtifactV1,
    readonly source: unknown,
  ) {
    super(message);
    this.name = 'StageExecutionError';
  }
}

function settledArtifact(
  result: PromiseSettledResult<ExpertTalkStageArtifactV1>,
): ExpertTalkStageArtifactV1 {
  return result.status === 'fulfilled'
    ? result.value
    : failedArtifact(result.reason);
}

function failedArtifact(error: unknown): ExpertTalkStageArtifactV1 {
  return error instanceof StageExecutionError
    ? error.artifact
    : {
        status: 'failed',
        error: safeStageError(error),
        errorReason: stageErrorReason(error),
      };
}

function terminalStatus(
  error: unknown,
  current: ExpertTalkRunStatus,
  signal: AbortSignal,
): ExpertTalkRunStatus {
  if (signal.aborted) {
    return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? stageFailureStatus(current)
      : 'CANCELLED';
  }
  if (error instanceof StageFailure) return error.status;
  return stageFailureStatus(current);
}

function stageFailureStatus(status: ExpertTalkRunStatus): ExpertTalkRunStatus {
  switch (status) {
    case 'OPENING':
      return 'FAILED_OPENING';
    case 'REVIEWING':
      return 'FAILED_REVIEW';
    case 'FUSING':
      return 'FAILED_FUSION';
    default:
      return status;
  }
}

function projectConversation(messages: readonly ContextMessage[]): string {
  if (messages.length === 0) return '[no prior conversation]';
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${extractText(message)}`)
    .join('\n\n');
}

function latestAssistantText(messages: readonly ContextMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'assistant') return extractText(message);
  }
  return '';
}

function hasOpeningSections(text: string): boolean {
  return hasMarkdownSections(text, [
    'position',
    'case',
    'decision criteria',
    'risks and uncertainty',
    'recommended answer',
  ]);
}

function hasReviewSections(text: string): boolean {
  return hasMarkdownSections(text, [
    'agreement',
    'rejection and missing points',
    'revised position',
  ]);
}

function hasMarkdownSections(text: string, sections: readonly string[]): boolean {
  const headings = new Set(text
    .split('\n')
    .map((line) => line.trim().replace(/^#{1,6}\s+/, '').toLowerCase()));
  return sections.every((section) => headings.has(section));
}

function usageDelta(
  after: TokenUsage | undefined,
  before: TokenUsage | undefined,
): TokenUsage | undefined {
  if (after === undefined) return undefined;
  return {
    inputOther: Math.max(0, after.inputOther - (before?.inputOther ?? 0)),
    output: Math.max(0, after.output - (before?.output ?? 0)),
    inputCacheRead: Math.max(0, after.inputCacheRead - (before?.inputCacheRead ?? 0)),
    inputCacheCreation: Math.max(
      0,
      after.inputCacheCreation - (before?.inputCacheCreation ?? 0),
    ),
  };
}

function estimateToolResultTokens(output: string | readonly ContentPart[]): number {
  return typeof output === 'string'
    ? Math.ceil(Buffer.byteLength(output, 'utf8') / 4)
    : estimateTokensForContentParts(output);
}

function runFailure(
  error: unknown,
  status: ExpertTalkRunStatus,
  run: ExpertTalkRunV1,
  signal: AbortSignal,
): NonNullable<ExpertTalkRunV1['error']> {
  const stage = stageOf(run.status);
  if (status === 'CANCELLED') {
    return runError('CANCELLED', 'Discussion was cancelled', stage);
  }
  if (status === 'INTERRUPTED') {
    return runError('INTERRUPTED', 'Discussion was interrupted', stage);
  }
  const failed = stageArtifacts(run)
    .find((entry) => entry.artifact?.errorReason !== undefined);
  const reason = signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
    ? 'STAGE_TIMEOUT'
    : error instanceof StageFailure
      ? error.reason
      : failed?.artifact?.errorReason ?? failureReasonForStatus(status);
  return runError(reason, failureMessage(reason), stage, failed?.role);
}

function runError(
  reason: ExpertTalkFailureReason,
  message: string,
  stage: NonNullable<ExpertTalkRunV1['error']>['stage'],
  role?: 'fusion_lead' | 'peer',
): NonNullable<ExpertTalkRunV1['error']> {
  return {
    reason,
    message,
    stage,
    role,
    retryable: true,
    action: reason === 'CANCELLED'
      ? 'Retry the whole exchange when ready.'
      : 'Inspect the exchange, repair the cause, then retry the whole exchange.',
  };
}

function stageArtifacts(run: ExpertTalkRunV1) {
  switch (stageOf(run.status)) {
    case 'opening':
      return [
        { role: 'fusion_lead' as const, artifact: run.artifacts.leadOpening },
        { role: 'peer' as const, artifact: run.artifacts.peerOpening },
      ];
    case 'review':
      return [
        { role: 'fusion_lead' as const, artifact: run.artifacts.leadReview },
        { role: 'peer' as const, artifact: run.artifacts.peerReview },
      ];
    case 'fusion':
      return [{ role: 'fusion_lead' as const, artifact: run.artifacts.fusion }];
    case 'terminal':
      return [];
  }
}

function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function stageOf(
  status: ExpertTalkRunStatus,
): NonNullable<ExpertTalkRunV1['error']>['stage'] {
  switch (status) {
    case 'OPENING':
    case 'FAILED_OPENING':
      return 'opening';
    case 'REVIEWING':
    case 'FAILED_REVIEW':
      return 'review';
    case 'FUSING':
    case 'FAILED_FUSION':
      return 'fusion';
    case 'COMPLETED':
    case 'CANCELLED':
    case 'INTERRUPTED':
      return 'terminal';
  }
}

function stageErrorReason(error: unknown): ExpertTalkFailureReason | undefined {
  const source = error instanceof StageExecutionError ? error.source : error;
  if (source instanceof StageFailure) return source.reason;
  const unwrapped = unwrapErrorCause(source);
  if (
    unwrapped instanceof APITimeoutError
    || (unwrapped instanceof DOMException && unwrapped.name === 'TimeoutError')
  ) {
    return 'STAGE_TIMEOUT';
  }
  const message = errorMessage(unwrapped);
  if (/provider stream stalled|timed out|timeout/i.test(message)) return 'STAGE_TIMEOUT';
  if (/tool-result.+budget/i.test(message)) return 'TOOL_RESULT_BUDGET_EXCEEDED';
  if (/tool.+not allowed|tool.+denied/i.test(message)) return 'TOOL_NOT_ALLOWED';
  if (/model requests|output tokens|budget/i.test(message)) {
    return 'STAGE_REQUEST_BUDGET_EXCEEDED';
  }
  return undefined;
}

function safeStageError(error: unknown): string {
  switch (stageErrorReason(error)) {
    case 'TOOL_NOT_ALLOWED': return 'Discussion attempted a tool that is not allowed.';
    case 'TOOL_RESULT_BUDGET_EXCEEDED': return 'Discussion exceeded the tool-result budget.';
    case 'STAGE_REQUEST_BUDGET_EXCEEDED': return 'Discussion exceeded the stage request budget.';
    case 'STAGE_TIMEOUT': return 'Discussion stage timed out.';
    default: return 'Discussion provider request failed.';
  }
}

function failureReasonForStatus(status: ExpertTalkRunStatus): ExpertTalkFailureReason {
  switch (status) {
    case 'FAILED_OPENING': return 'OPENING_FAILED';
    case 'FAILED_REVIEW': return 'REVIEW_FAILED';
    case 'FAILED_FUSION': return 'FUSION_FAILED';
    case 'CANCELLED': return 'CANCELLED';
    case 'INTERRUPTED': return 'INTERRUPTED';
    default: return 'FUSION_FAILED';
  }
}

function failureMessage(reason: ExpertTalkFailureReason): string {
  switch (reason) {
    case 'TOOL_NOT_ALLOWED': return 'Discussion attempted a tool that is not allowed.';
    case 'TOOL_RESULT_BUDGET_EXCEEDED': return 'Discussion exceeded the tool-result budget.';
    case 'STAGE_REQUEST_BUDGET_EXCEEDED': return 'Discussion exceeded the stage request budget.';
    case 'STAGE_TIMEOUT': return 'Discussion stage timed out.';
    case 'OPENING_FAILED': return 'A Discussion opening failed.';
    case 'REVIEW_FAILED': return 'Both Discussion reviews failed.';
    case 'FUSION_FAILED': return 'Discussion fusion failed.';
    case 'FUSION_RESULT_INVALID': return 'Discussion fusion returned an invalid result.';
    case 'CANCELLED': return 'Discussion was cancelled.';
    case 'INTERRUPTED': return 'Discussion was interrupted.';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

registerScopedService(
  LifecycleScope.Session,
  ISessionExpertTalkService,
  SessionExpertTalkService,
  ScopeActivation.OnScopeCreated,
  'expertTalk',
);
