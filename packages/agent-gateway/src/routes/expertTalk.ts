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
  expertTalkRunListQuerySchema,
  expertTalkRunParamsSchema,
  expertTalkRunSchema,
  expertTalkSessionParamsSchema,
  expertTalkStatusSchema,
  type ExpertTalkRunWire,
  type ExpertTalkStatusWire,
} from '../protocol/rest-expert-talk';
import { mapError } from '../transport/errors';
import { etagOf, parseIfMatch } from './subagentModelPolicy';
import type { IConnectionRegistry } from '../transport/ws/connectionRegistry';

interface ExpertTalkRequest {
  readonly id: string;
  readonly body?: unknown;
  readonly params: unknown;
  readonly query?: unknown;
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

export function registerExpertTalkRoutes(
  app: ExpertTalkRouteHost,
  core: Scope,
  connections?: IConnectionRegistry,
): void {
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
      const ownerId = clientId(req.headers);
      if (
        connections !== undefined &&
        !Array.from(connections.values()).some((connection) =>
          connection.hasClientHello &&
          connection.clientId === ownerId &&
          connection.subscriptionSessionIds.includes(req.params.session_id))
      ) {
        throw new Error2(
          ErrorCodes.EXPERT_TALK_CLIENT_UNSUPPORTED,
          'Expert Talk requires a connected client event stream',
        );
      }
      service.arm(ownerId, parseIfMatch(req.headers['if-match']));
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
      querystring: expertTalkRunListQuerySchema,
      success: { data: expertTalkRunListSchema },
      errors: expertTalkErrors,
      description: 'List durable Expert Talk runs for a session',
      tags: ['expert-talk'],
      operationId: 'listExpertTalkRuns',
    },
    async (req, reply) => withService(core, req.params.session_id, req.id, reply, (service) => {
      const page = service.listRuns({ cursor: req.query.cursor, limit: req.query.limit });
      reply.send(okEnvelope({
        runs: page.items.map(projectRun),
        next_cursor: page.nextCursor,
      }, req.id));
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
      peer: projectArtifact(run, 'peer', 'review', artifacts.peerReview),
    },
    fusion: stageOrder(stage) >= stageOrder('fusion')
      ? projectArtifact(run, 'fusion_lead', 'fusion', artifacts.fusion)
      : undefined,
    result: projectResult(run.result),
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

function projectResult(result: ExpertTalkRunV1['result']): ExpertTalkRunWire['result'] {
  if (result === undefined) return undefined;
  const stored = result as {
    readonly version: string;
    readonly answer: string;
    readonly notes?: NonNullable<ExpertTalkRunV1['result']>['notes'];
  };
  if (stored.version !== 'expert_talk_result/v1' || stored.notes === undefined) {
    return { version: stored.version, answer: stored.answer };
  }
  return {
    version: stored.version,
    answer: stored.answer,
    notes: {
      consensus: [...stored.notes.consensus],
      divergence: [...stored.notes.divergence],
      uncertainty: [...stored.notes.uncertainty],
      attribution: stored.notes.attribution.map((entry) => ({ ...entry })),
    },
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
      tools: (artifact.tools ?? progress?.tools)?.map((tool) => ({ ...tool })) ?? [],
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
  if (stage === 'review') {
    return role === 'fusion_lead' ? run.progress?.leadReview : run.progress?.peerReview;
  }
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
    run.artifacts.peerReview,
    run.artifacts.fusion,
  ];
  const executed = artifacts.filter(
    (artifact): artifact is ExpertTalkStageArtifactV1 => artifact !== undefined,
  );
  const usages = artifacts.flatMap((artifact) => artifact?.usage === undefined ? [] : [artifact.usage]);
  const total = usages.length === 0 ? undefined : usages.reduce(addUsage, emptyUsage());
  return {
    complete: run.status === 'COMPLETED' && executed.length === 5 &&
      executed.every((artifact) => artifact.usage !== undefined),
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
): number | undefined {
  const values = artifacts.flatMap((artifact) => artifact?.[key] === undefined
    ? []
    : [artifact[key]]);
  return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
}

function runState(run: ExpertTalkRunV1): ExpertTalkRunWire['state'] {
  switch (run.status) {
    case 'OPENING':
    case 'REVIEWING':
    case 'FUSING': return 'running';
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
    case 'OPENING':
    case 'FAILED_OPENING': return 'opening';
    case 'REVIEWING':
    case 'FAILED_REVIEW': return 'review';
    case 'FUSING':
    case 'FAILED_FUSION': return 'fusion';
    case 'COMPLETED': return 'terminal';
    case 'CANCELLED':
    case 'INTERRUPTED':
      if (run.artifacts.fusion !== undefined) return 'fusion';
      if (run.artifacts.leadReview !== undefined || run.artifacts.peerReview !== undefined) {
        return 'review';
      }
      return 'opening';
  }
}

function stageOrder(stage: ExpertTalkRunWire['stage']): number {
  return ['opening', 'review', 'fusion', 'terminal'].indexOf(stage);
}

function isTerminal(run: ExpertTalkRunV1): boolean {
  return ![
    'OPENING',
    'REVIEWING',
    'FUSING',
  ].includes(run.status);
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
