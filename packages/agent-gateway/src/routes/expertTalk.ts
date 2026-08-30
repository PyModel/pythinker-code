import { createHash } from 'node:crypto';

import {
  Error2,
  ErrorCodes,
  ISessionExpertTalkService,
  resumeSessionById,
  type ExpertTalkBindingV1,
  type ExpertTalkRunV1,
  type ExpertTalkStageArtifactV1,
  type ExpertTalkStatusV1,
  type Scope,
  type TokenUsage,
} from '@pymodel/agent-core-v2';

import { okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  expertTalkConfigureSchema,
  expertTalkDisarmSchema,
  expertTalkRunListSchema,
  expertTalkRunParamsSchema,
  expertTalkRunSchema,
  expertTalkSessionParamsSchema,
  expertTalkStatusSchema,
  type ExpertTalkRunWire,
  type ExpertTalkStatusWire,
} from '../protocol/rest-expert-talk';
import { mapError } from '../transport/errors';
import { etagOf, parseIfMatch } from './subagentModelPolicy';

interface ExpertTalkRequest {
  readonly id: string;
  readonly body?: unknown;
  readonly params: unknown;
  readonly headers: Record<string, unknown>;
}

interface ExpertTalkReply {
  header(name: string, value: string): ExpertTalkReply;
  send(payload: unknown): unknown;
}

interface ExpertTalkRouteHost {
  get(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> }, handler: (req: ExpertTalkRequest, reply: ExpertTalkReply) => Promise<void> | void): unknown;
  put(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> }, handler: (req: ExpertTalkRequest, reply: ExpertTalkReply) => Promise<void> | void): unknown;
  post(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> }, handler: (req: ExpertTalkRequest, reply: ExpertTalkReply) => Promise<void> | void): unknown;
  delete(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> }, handler: (req: ExpertTalkRequest, reply: ExpertTalkReply) => Promise<void> | void): unknown;
}

const expertTalkErrors = {
  [ErrorCode.VALIDATION_FAILED]: {},
  [ErrorCode.SESSION_NOT_FOUND]: {},
  [ErrorCode.EXPERT_TALK_RUN_NOT_FOUND]: {},
  [ErrorCode.EXPERT_TALK_FEATURE_DISABLED]: {},
  [ErrorCode.EXPERT_TALK_PAIR_NOT_CONFIGURED]: {},
  [ErrorCode.EXPERT_TALK_PAIR_INVALID]: {},
  [ErrorCode.EXPERT_TALK_PAIR_COLLAPSED]: {},
  [ErrorCode.EXPERT_TALK_ALREADY_ARMED]: {},
  [ErrorCode.EXPERT_TALK_NOT_ARMED]: {},
  [ErrorCode.EXPERT_TALK_BUSY]: {},
  [ErrorCode.EXPERT_TALK_RUN_NOT_RETRYABLE]: {},
  [ErrorCode.EXPERT_TALK_CLIENT_UNSUPPORTED]: {},
  [ErrorCode.EXPERT_TALK_CONTEXT_INSUFFICIENT]: {},
  [ErrorCode.EXPERT_TALK_BUDGET_EXCEEDED]: {},
  [ErrorCode.CONFIG_VERSION_CONFLICT]: {},
};

export function registerExpertTalkRoutes(app: ExpertTalkRouteHost, core: Scope): void {
  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/expert-talk',
      params: expertTalkSessionParamsSchema,
      success: { data: expertTalkStatusSchema },
      errors: expertTalkErrors,
      description: 'Get Expert Talk configuration, activation, and current run status',
      tags: ['expert-talk'],
      operationId: 'getExpertTalk',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      sendStatus(reply as ExpertTalkReply, req.id, service.status());
    }),
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as unknown as Parameters<ExpertTalkRouteHost['get']>[2]);

  const configureRoute = defineRoute(
    {
      method: 'PUT',
      path: '/sessions/{session_id}/expert-talk',
      params: expertTalkSessionParamsSchema,
      body: expertTalkConfigureSchema,
      success: { data: expertTalkStatusSchema },
      errors: expertTalkErrors,
      description: 'Configure the ordered Expert Talk model pair',
      tags: ['expert-talk'],
      operationId: 'configureExpertTalk',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      await service.configure(
        {
          fusionLeadModelId: req.body.fusion_lead_model_id,
          peerModelId: req.body.peer_model_id,
        },
        parseIfMatch(req.headers['if-match']),
      );
      sendStatus(reply as ExpertTalkReply, req.id, service.status());
    }),
  );
  app.put(configureRoute.path, configureRoute.options, configureRoute.handler as unknown as Parameters<ExpertTalkRouteHost['put']>[2]);

  const clearRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/sessions/{session_id}/expert-talk',
      params: expertTalkSessionParamsSchema,
      success: { data: expertTalkStatusSchema },
      errors: expertTalkErrors,
      description: 'Clear the Expert Talk model pair',
      tags: ['expert-talk'],
      operationId: 'clearExpertTalk',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      await service.clear(parseIfMatch(req.headers['if-match']));
      sendStatus(reply as ExpertTalkReply, req.id, service.status());
    }),
  );
  app.delete(clearRoute.path, clearRoute.options, clearRoute.handler as unknown as Parameters<ExpertTalkRouteHost['delete']>[2]);

  const armRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk::arm',
      params: expertTalkSessionParamsSchema,
      success: { data: expertTalkStatusSchema },
      errors: expertTalkErrors,
      description: 'Arm Expert Talk for the next accepted prompt from this client',
      tags: ['expert-talk'],
      operationId: 'armExpertTalk',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      service.arm(clientId(req.headers), parseIfMatch(req.headers['if-match']));
      sendStatus(reply as ExpertTalkReply, req.id, service.status());
    }),
  );
  app.post(armRoute.path, armRoute.options, armRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const disarmRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk::disarm',
      params: expertTalkSessionParamsSchema,
      body: expertTalkDisarmSchema,
      success: { data: expertTalkStatusSchema },
      errors: expertTalkErrors,
      description: 'Disarm a pending Expert Talk activation',
      tags: ['expert-talk'],
      operationId: 'disarmExpertTalk',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      service.disarm(clientId(req.headers), req.body.arm_id);
      sendStatus(reply as ExpertTalkReply, req.id, service.status());
    }),
  );
  app.post(disarmRoute.path, disarmRoute.options, disarmRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const listRunsRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/expert-talk/runs',
      params: expertTalkSessionParamsSchema,
      success: { data: expertTalkRunListSchema },
      errors: expertTalkErrors,
      description: 'List durable Expert Talk runs for a session',
      tags: ['expert-talk'],
      operationId: 'listExpertTalkRuns',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      reply.send(okEnvelope({ runs: service.listRuns().map(projectRun) }, req.id));
    }),
  );
  app.get(listRunsRoute.path, listRunsRoute.options, listRunsRoute.handler as unknown as Parameters<ExpertTalkRouteHost['get']>[2]);

  const getRunRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Get one durable Expert Talk run',
      tags: ['expert-talk'],
      operationId: 'getExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      reply.send(okEnvelope(projectRun(service.getRun(req.params.run_id)), req.id));
    }),
  );
  app.get(getRunRoute.path, getRunRoute.options, getRunRoute.handler as unknown as Parameters<ExpertTalkRouteHost['get']>[2]);

  const cancelRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}/cancel',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Cancel an Expert Talk run and its active branches',
      tags: ['expert-talk'],
      operationId: 'cancelExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      reply.send(okEnvelope(projectRun(await service.cancel(req.params.run_id)), req.id));
    }),
  );
  app.post(cancelRoute.path, cancelRoute.options, cancelRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const reviewRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}/review',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Run the Architect review of the Builder opinion',
      tags: ['expert-talk'],
      operationId: 'reviewExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      reply.send(okEnvelope(projectRun(await service.review(req.params.run_id)), req.id));
    }),
  );
  app.post(reviewRoute.path, reviewRoute.options, reviewRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const finishRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}/finish',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Finish Expert Talk with the latest Architect answer',
      tags: ['expert-talk'],
      operationId: 'finishExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      reply.send(okEnvelope(projectRun(await service.finish(req.params.run_id)), req.id));
    }),
  );
  app.post(finishRoute.path, finishRoute.options, finishRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const fusionRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}/fusion',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Run fresh Architect Fusion from the available opinions and review',
      tags: ['expert-talk'],
      operationId: 'fuseExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      reply.send(okEnvelope(projectRun(await service.fuse(req.params.run_id)), req.id));
    }),
  );
  app.post(fusionRoute.path, fusionRoute.options, fusionRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);

  const retryRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/expert-talk/runs/{run_id}/retry',
      params: expertTalkRunParamsSchema,
      success: { data: expertTalkRunSchema },
      errors: expertTalkErrors,
      description: 'Retry a terminal Expert Talk run as a full new exchange',
      tags: ['expert-talk'],
      operationId: 'retryExpertTalkRun',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, async (service) => {
      const started = await service.retry(req.params.run_id);
      reply.send(okEnvelope(projectRun(service.getRun(started.runId)), req.id));
    }),
  );
  app.post(retryRoute.path, retryRoute.options, retryRoute.handler as unknown as Parameters<ExpertTalkRouteHost['post']>[2]);
}

async function withService(
  core: Scope,
  sessionId: string,
  requestId: string,
  reply: { send(payload: unknown): unknown },
  use: (service: ISessionExpertTalkService) => void | Promise<void>,
): Promise<void> {
  try {
    const session = await resumeSessionById(core.accessor, sessionId);
    if (session === undefined) {
      throw new Error2(ErrorCodes.SESSION_NOT_FOUND, `session ${sessionId} does not exist`);
    }
    const service = session.accessor.get(ISessionExpertTalkService);
    await service.ready;
    await use(service);
  } catch (error) {
    reply.send(mapError(error, requestId));
  }
}

function clientId(headers: Record<string, unknown>): string {
  const value = headers['x-pythinker-client-id'];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new Error2(
    ErrorCodes.EXPERT_TALK_CLIENT_UNSUPPORTED,
    'Expert Talk requires a stable client identity',
  );
}

function sendStatus(reply: ExpertTalkReply, requestId: string, status: ExpertTalkStatusV1): void {
  reply
    .header('etag', etagOf(status.config.resourceVersion))
    .send(okEnvelope(projectExpertTalkStatus(status), requestId));
}

export function projectExpertTalkStatus(status: ExpertTalkStatusV1): ExpertTalkStatusWire {
  const pair = status.config.pair;
  const arm = status.arm;
  return {
    schema_version: 1,
    feature: status.enabled ? 'enabled' : 'disabled',
    resource_version: status.config.resourceVersion,
    config: pair === undefined
      ? null
      : {
          fusion_lead_model_id: pair.fusionLeadModelId,
          peer_model_id: pair.peerModelId,
        },
    activation: arm === undefined
      ? { state: 'idle' }
      : { state: 'armed', arm_id: arm.armId, armed_at: arm.armedAt },
    active_run_id: status.activeRun?.runId,
    latest_run_id: status.latestRun?.runId,
    pair_validation: status.pairValidation,
  };
}

function projectRun(run: ExpertTalkRunV1): ExpertTalkRunWire {
  const stage = runStage(run);
  const artifacts = run.artifacts;
  return {
    schema_version: 1,
    run_id: run.runId,
    session_id: run.sessionId,
    turn_id: run.turnId,
    prompt_id: run.promptId,
    retry_of: run.retryOf,
    state: runState(run),
    stage,
    created_at: run.createdAt,
    started_at: run.startedAt,
    ended_at: run.completedAt,
    updated_at: run.updatedAt,
    bindings: {
      fusion_lead: projectBinding(run.bindings[0]),
      peer: projectBinding(run.bindings[1]),
    },
    opening: {
      lead: projectArtifact(run, 'fusion_lead', 'opening', artifacts.leadOpening),
      peer: projectArtifact(run, 'peer', 'opening', artifacts.peerOpening),
    },
    review: {
      lead: projectArtifact(run, 'fusion_lead', 'review', artifacts.leadReview),
    },
    fusion: stageOrder(stage) >= stageOrder('fusion')
      ? projectArtifact(run, 'fusion_lead', 'fusion', artifacts.fusion)
      : undefined,
    result: run.result === undefined ? undefined : {
      version: run.result.version,
      answer: run.result.answer,
      notes: {
        consensus: [...run.result.notes.consensus],
        divergence: [...run.result.notes.divergence],
        uncertainty: [...run.result.notes.uncertainty],
        attribution: run.result.notes.attribution.map((entry) => ({ ...entry })),
      },
    },
    usage: projectUsage(run),
    error: run.error === undefined ? undefined : {
      reason: run.error.reason,
      message: run.error.message,
      stage: run.error.stage,
      role: run.error.role,
      retryable: run.error.retryable,
      action: run.error.action,
    },
    orphaned_participant_ids: run.orphanedParticipantIds === undefined
      ? undefined
      : [...run.orphanedParticipantIds],
    progress_revision: run.progress?.revision,
    revision: run.revision,
  };
}

function projectBinding(binding: ExpertTalkBindingV1) {
  return {
    role: binding.role,
    requested_model_id: binding.requestedModelId,
    effective_model_id: binding.effectiveModelId,
    protocol: binding.protocol,
    provider: binding.provider,
    wire_model: binding.wireModel,
    target_fingerprint: binding.targetFingerprint,
    capabilities: binding.capabilities,
    max_context_size: binding.maxContextSize,
    max_input_size: binding.maxInputSize,
    max_output_size: binding.maxOutputSize,
    routing_environment_revision: binding.routingEnvironmentRevision,
    route_decision_fingerprint: binding.routeDecisionFingerprint,
  };
}

function projectArtifact(
  run: ExpertTalkRunV1,
  role: 'fusion_lead' | 'peer',
  stage: 'opening' | 'review' | 'fusion',
  artifact: ExpertTalkStageArtifactV1 | undefined,
) {
  const progress = stageProgress(run, role, stage);
  if (artifact !== undefined) {
    return {
      role,
      stage,
      state: artifact.status,
      text: artifact.text,
      thinking: progress?.thinking,
      tools: progress?.tools.map((tool) => ({ ...tool })) ?? [],
      digest: artifact.digest ?? (artifact.text === undefined ? undefined : digest(artifact.text)),
      partial: artifact.partial ?? false,
      started_at: artifact.startedAt,
      ended_at: artifact.endedAt,
      usage: artifact.usage === undefined ? undefined : projectTokenUsage(artifact.usage),
      request_count: artifact.requestCount,
      provider_attempt_count: artifact.providerAttemptCount,
      tool_call_count: artifact.toolCallCount,
      tool_result_tokens: artifact.toolResultTokens,
      error: artifact.error,
      error_reason: artifact.errorReason,
    };
  }
  return {
    role,
    stage,
    state: inferredArtifactState(run, stage),
    text: progress?.text,
    thinking: progress?.thinking,
    tools: progress?.tools.map((tool) => ({ ...tool })) ?? [],
    partial: progress !== undefined,
    started_at: progress?.startedAt,
  };
}

function stageProgress(
  run: ExpertTalkRunV1,
  role: 'fusion_lead' | 'peer',
  stage: 'opening' | 'review' | 'fusion',
) {
  if (stage === 'opening') {
    return role === 'fusion_lead' ? run.progress?.leadOpening : run.progress?.peerOpening;
  }
  if (stage === 'review') return run.progress?.leadReview;
  return run.progress?.fusion;
}

function inferredArtifactState(run: ExpertTalkRunV1, stage: 'opening' | 'review' | 'fusion') {
  const current = runStage(run);
  if (run.status === 'CANCELLED' && current === stage) return 'cancelled' as const;
  if (run.status === 'INTERRUPTED' && stageOrder(current) <= stageOrder(stage)) return 'cancelled' as const;
  if (run.status.startsWith('FAILED_') && current === stage) return 'failed' as const;
  if (stageOrder(current) < stageOrder(stage)) return 'pending' as const;
  if (!isTerminal(run) && current === stage) return 'running' as const;
  return 'unavailable' as const;
}

function projectUsage(run: ExpertTalkRunV1) {
  const artifacts = [
    run.artifacts.leadOpening,
    run.artifacts.peerOpening,
    run.artifacts.leadReview,
    run.artifacts.fusion,
  ];
  const executed = artifacts.filter(
    (artifact): artifact is ExpertTalkStageArtifactV1 => artifact !== undefined,
  );
  const usages = artifacts.flatMap((artifact) => artifact?.usage === undefined ? [] : [artifact.usage]);
  const total = usages.length === 0 ? undefined : usages.reduce(addUsage, emptyUsage());
  return {
    complete: run.status === 'COMPLETED' && executed.every((artifact) => artifact.usage !== undefined),
    total: total === undefined ? undefined : projectTokenUsage(total),
    request_count: sum(artifacts, 'requestCount'),
    provider_attempt_count: sum(artifacts, 'providerAttemptCount'),
    tool_call_count: sum(artifacts, 'toolCallCount'),
    tool_result_tokens: sum(artifacts, 'toolResultTokens'),
  };
}

function projectTokenUsage(usage: TokenUsage) {
  return {
    input_other: usage.inputOther,
    output: usage.output,
    input_cache_read: usage.inputCacheRead,
    input_cache_creation: usage.inputCacheCreation,
  };
}

function emptyUsage(): TokenUsage {
  return { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputOther: left.inputOther + right.inputOther,
    output: left.output + right.output,
    inputCacheRead: left.inputCacheRead + right.inputCacheRead,
    inputCacheCreation: left.inputCacheCreation + right.inputCacheCreation,
  };
}

function sum(
  artifacts: readonly (ExpertTalkStageArtifactV1 | undefined)[],
  key: 'requestCount' | 'providerAttemptCount' | 'toolCallCount' | 'toolResultTokens',
): number {
  return artifacts.reduce((total, artifact) => total + (artifact?.[key] ?? 0), 0);
}

function runState(run: ExpertTalkRunV1): ExpertTalkRunWire['state'] {
  switch (run.status) {
    case 'PREPARING': return 'preparing';
    case 'OPENING':
    case 'REVIEWING':
    case 'FUSING': return 'running';
    case 'OPINIONS_READY':
    case 'REVIEW_READY': return 'waiting';
    case 'COMPLETED': return 'completed';
    case 'CANCELLED': return 'cancelled';
    case 'INTERRUPTED': return 'interrupted';
    case 'FAILED_OPENING':
    case 'FAILED_REVIEW':
    case 'FAILED_FUSION': return 'failed';
  }
}

function runStage(run: ExpertTalkRunV1): ExpertTalkRunWire['stage'] {
  switch (run.status) {
    case 'PREPARING': return 'preparing';
    case 'OPENING':
    case 'OPINIONS_READY':
    case 'FAILED_OPENING': return 'opening';
    case 'REVIEWING':
    case 'REVIEW_READY':
    case 'FAILED_REVIEW': return 'review';
    case 'FUSING':
    case 'FAILED_FUSION': return 'fusion';
    case 'COMPLETED': return 'terminal';
    case 'CANCELLED':
    case 'INTERRUPTED':
      if (run.artifacts.fusion !== undefined) return 'fusion';
      if (run.artifacts.leadReview !== undefined) return 'review';
      return 'opening';
  }
}

function stageOrder(stage: ExpertTalkRunWire['stage']): number {
  return ['preparing', 'opening', 'review', 'fusion', 'terminal'].indexOf(stage);
}

function isTerminal(run: ExpertTalkRunV1): boolean {
  return ![
    'PREPARING',
    'OPENING',
    'OPINIONS_READY',
    'REVIEWING',
    'REVIEW_READY',
    'FUSING',
  ].includes(run.status);
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
