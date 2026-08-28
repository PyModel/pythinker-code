import {
  ConfigChanged,
  ErrorCodes,
  IConfigService,
  IEventService,
  isError2,
  ISubagentModelPolicyService,
  type CanonicalSubagentModelPolicy,
  type EffectiveSubagentModelPolicy,
  type Scope,
} from '@pymodel/agent-core-v2';
import { errEnvelope, okEnvelope } from '../envelope';
import { requestLog } from '../lib/requestLog';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  subagentModelPolicyRequestSchema,
  subagentModelPolicyResponseSchema,
  type SubagentModelPolicyRequest,
  type SubagentModelPolicyResponse,
  type SubagentModelPolicyWire,
} from '../protocol/rest-config';

interface PolicyRequest {
  readonly id: string;
  readonly body?: unknown;
  readonly headers: Record<string, unknown>;
}

interface PolicyReply {
  header(name: string, value: string): PolicyReply;
  code(status: number): PolicyReply;
  send(payload: unknown): unknown;
}

interface PolicyRouteHost {
  get(path: string, options: { schema?: Record<string, unknown> }, handler: (req: PolicyRequest, reply: PolicyReply) => Promise<void> | void): unknown;
  put(path: string, options: { schema?: Record<string, unknown> }, handler: (req: PolicyRequest, reply: PolicyReply) => Promise<void> | void): unknown;
  delete(path: string, options: { schema?: Record<string, unknown> }, handler: (req: PolicyRequest, reply: PolicyReply) => Promise<void> | void): unknown;
}

export const SUBAGENT_MODEL_POLICY_PATH = '/config/subagent-model-policy';

export function toWirePolicy(policy: CanonicalSubagentModelPolicy): SubagentModelPolicyWire {
  switch (policy.mode) {
    case 'inherit':
      return { mode: 'inherit' };
    case 'default':
      return { mode: 'default', default_model: policy.defaultModel, default_effort: policy.defaultEffort };
    case 'pool':
      return {
        mode: 'pool',
        default_model: policy.defaultModel,
        models: policy.models,
        default_effort: policy.defaultEffort,
      };
    case 'force':
      return { mode: 'force', default_model: policy.defaultModel, default_effort: policy.defaultEffort };
  }
}

export function fromWirePolicy(wire: SubagentModelPolicyRequest): Record<string, unknown> {
  switch (wire.mode) {
    case 'inherit':
      return { mode: 'inherit' };
    case 'default':
      return { mode: 'default', defaultModel: wire.default_model, defaultEffort: wire.default_effort };
    case 'pool':
      return {
        mode: 'pool',
        defaultModel: wire.default_model,
        models: wire.models,
        defaultEffort: wire.default_effort,
      };
    case 'force':
      return { mode: 'force', defaultModel: wire.default_model, defaultEffort: wire.default_effort };
  }
}

export function etagOf(resourceVersion: string): string {
  return `"${resourceVersion}"`;
}

export function parseIfMatch(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed === '*') return undefined;
  const first = trimmed.split(',')[0]?.trim() ?? '';
  const strong = first.startsWith('W/') ? first.slice(2) : first;
  return strong.startsWith('"') && strong.endsWith('"') ? strong.slice(1, -1) : strong;
}

function toResponse(
  policy: CanonicalSubagentModelPolicy,
  resourceVersion: string,
  effective: EffectiveSubagentModelPolicy,
): SubagentModelPolicyResponse {
  return {
    policy: toWirePolicy(policy),
    resource_version: resourceVersion,
    effective: {
      configured_policy: toWirePolicy(effective.configuredPolicy),
      effective_policy: toWirePolicy(effective.effectivePolicy),
      policy_source: effective.policySource,
      feature: { enabled: effective.feature.enabled, source: effective.feature.source },
    },
  };
}

export function registerSubagentModelPolicyRoutes(app: PolicyRouteHost, core: Scope): void {
  const policyService = (): ISubagentModelPolicyService =>
    core.accessor.get(ISubagentModelPolicyService);

  const respond = (reply: PolicyReply, requestId: string): void => {
    const service = policyService();
    const snapshot = service.get();
    reply
      .header('etag', etagOf(snapshot.resourceVersion))
      .send(okEnvelope(toResponse(snapshot.policy, snapshot.resourceVersion, service.getEffective()), requestId));
  };

  const fail = (req: PolicyRequest, reply: PolicyReply, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (isError2(error) && error.code === ErrorCodes.CONFIG_VERSION_CONFLICT) {
      requestLog(req)?.info({ err: error }, 'subagent model policy version conflict');
      reply.code(412).send(errEnvelope(ErrorCode.CONFIG_VERSION_CONFLICT, message, req.id));
      return;
    }
    requestLog(req)?.error({ err: error }, 'subagent model policy update failed');
    reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, message, req.id));
  };

  const publish = (changedFields: string[]): void => {
    core.accessor.get(IEventService).publish(
      new ConfigChanged({
        payload: { changedFields, config: core.accessor.get(IConfigService).getAll() },
      }),
    );
  };

  const getRoute = defineRoute(
    {
      method: 'GET',
      path: SUBAGENT_MODEL_POLICY_PATH,
      success: { data: subagentModelPolicyResponseSchema },
      description: 'Get the configured and effective subagent model routing policy',
      tags: ['config'],
    },
    async (req, reply) => {
      await core.accessor.get(IConfigService).ready;
      respond(reply as unknown as PolicyReply, req.id);
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as unknown as Parameters<PolicyRouteHost['get']>[2]);

  const putRoute = defineRoute(
    {
      method: 'PUT',
      path: SUBAGENT_MODEL_POLICY_PATH,
      body: subagentModelPolicyRequestSchema,
      success: { data: subagentModelPolicyResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.CONFIG_VERSION_CONFLICT]: {},
      },
      description: 'Replace the subagent model routing policy (If-Match with the ETag from GET)',
      tags: ['config'],
    },
    async (req, reply) => {
      const typedReply = reply as unknown as PolicyReply;
      try {
        await core.accessor.get(IConfigService).ready;
        const expectedVersion = parseIfMatch(req.headers['if-match']);
        await policyService().set(fromWirePolicy(req.body), expectedVersion);
        publish(['secondary_model']);
        requestLog(req)?.info({ changedFields: ['secondary_model'] }, 'subagent model policy updated');
        respond(typedReply, req.id);
      } catch (error) {
        fail(req as PolicyRequest, typedReply, error);
      }
    },
  );
  app.put(putRoute.path, putRoute.options, putRoute.handler as unknown as Parameters<PolicyRouteHost['put']>[2]);

  const deleteRoute = defineRoute(
    {
      method: 'DELETE',
      path: SUBAGENT_MODEL_POLICY_PATH,
      success: { data: subagentModelPolicyResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.CONFIG_VERSION_CONFLICT]: {},
      },
      description: 'Remove the subagent model routing policy so subagents inherit the caller model',
      tags: ['config'],
    },
    async (req, reply) => {
      const typedReply = reply as unknown as PolicyReply;
      try {
        await core.accessor.get(IConfigService).ready;
        const expectedVersion = parseIfMatch(req.headers['if-match']);
        await policyService().clear(expectedVersion);
        publish(['secondary_model']);
        requestLog(req)?.info({ changedFields: ['secondary_model'] }, 'subagent model policy cleared');
        respond(typedReply, req.id);
      } catch (error) {
        fail(req as PolicyRequest, typedReply, error);
      }
    },
  );
  app.delete(deleteRoute.path, deleteRoute.options, deleteRoute.handler as unknown as Parameters<PolicyRouteHost['delete']>[2]);
}
