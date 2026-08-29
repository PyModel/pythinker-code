import {
  IAgentTaskService,
  ISessionIndex,
  getLiveSessionById,
  type AgentTaskInfo,
  type Scope,
  type SubagentBindingProvenance,
} from '@pymodel/agent-core-v2';
import { ErrorCode } from '../protocol/error-codes';
import {
  cancelTaskResultSchema,
  detachTaskResultSchema,
  getTaskQuerySchema,
  getTaskResponseSchema,
  listTasksQuerySchema,
  listTasksResponseSchema,
  type ListTasksQuery,
} from '../protocol/rest-task';
import type { SubagentRoutingWire, Task, TaskKind, TaskStatus } from '../protocol/task';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { requestLog } from '../lib/requestLog';
import { defineRoute } from '../middleware/defineRoute';
import { ensureMainAgent } from '../transport/mainAgent';
import { parseActionSuffix } from './action-suffix';

const DEFAULT_TASK_OUTPUT_PREVIEW_BYTES = 32 * 1024;

interface TasksRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; query: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void,
  ): unknown;
}

const sessionIdParamSchema = z.object({
  session_id: z.string().min(1),
});

const sessionAndTaskIdParamSchema = z.object({
  session_id: z.string().min(1),
  task_id: z.string().min(1),
});

const detailsSchema = z.array(z.object({ path: z.string(), message: z.string() }));

export function registerTasksRoutes(app: TasksRouteHost, core: Scope): void {
  const listRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/tasks',
      params: sessionIdParamSchema,
      querystring: listTasksQuerySchema,
      success: { data: listTasksResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: { detailsSchema },
        [ErrorCode.SESSION_NOT_FOUND]: {},
      },
      description: 'List tasks for a session',
      tags: ['tasks'],
    },
    async (req, reply) => {
      const { session_id } = req.params;
      const resolved = await resolveSessionTasks(core, session_id);
      if (resolved.kind === 'not_found') {
        reply.send(sessionNotFound(session_id, req.id));
        return;
      }

      const query = req.query as ListTasksQuery;
      const infos = (resolved.tasks?.list(false) ?? []).filter(
        (info) => query.status === undefined || mapStatus(info.status) === query.status,
      );
      const items = await Promise.all(
        infos.map(async (info) => {
          const output =
            query.with_output === true &&
            resolved.tasks !== undefined &&
            (query.output_status !== 'running' || mapStatus(info.status) === 'running')
              ? await readTaskOutput(
                  resolved.tasks,
                  info.taskId,
                  query.output_bytes ?? DEFAULT_TASK_OUTPUT_PREVIEW_BYTES,
                )
              : undefined;
          return toWireTask(session_id, info, output);
        }),
      );
      reply.send(okEnvelope({ items }, req.id));
    },
  );
  app.get(listRoute.path, listRoute.options, listRoute.handler as Parameters<TasksRouteHost['get']>[2]);

  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/sessions/{session_id}/tasks/{task_id}',
      params: sessionAndTaskIdParamSchema,
      querystring: getTaskQuerySchema,
      success: { data: getTaskResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: { detailsSchema },
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.TASK_NOT_FOUND]: {},
      },
      description: 'Get a task by ID',
      tags: ['tasks'],
    },
    async (req, reply) => {
      const { session_id, task_id } = req.params;
      const resolved = await resolveSessionTasks(core, session_id);
      if (resolved.kind === 'not_found') {
        reply.send(sessionNotFound(session_id, req.id));
        return;
      }

      const found = resolved.tasks?.getTask(task_id);
      if (found === undefined) {
        reply.send(taskNotFound(session_id, task_id, req.id));
        return;
      }

      const query = req.query as { with_output?: boolean; output_bytes?: number };
      const output =
        query.with_output === true && resolved.tasks !== undefined
          ? await readTaskOutput(
              resolved.tasks,
              task_id,
              query.output_bytes ?? DEFAULT_TASK_OUTPUT_PREVIEW_BYTES,
            )
          : undefined;

      reply.send(okEnvelope(toWireTask(session_id, found, output), req.id));
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as Parameters<TasksRouteHost['get']>[2]);

  const taskActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/sessions/{session_id}/tasks/{tail}',
      success: { data: z.union([cancelTaskResultSchema, detachTaskResultSchema]) },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: { detailsSchema },
        [ErrorCode.SESSION_NOT_FOUND]: {},
        [ErrorCode.TASK_NOT_FOUND]: {},
        [ErrorCode.TASK_ALREADY_FINISHED]: {
          dataSchema: z.object({ cancelled: z.literal(false) }),
          detailsSchema: z.object({ current_status: z.string() }),
        },
      },
      description: 'Run a task action',
      tags: ['tasks'],
      operationId: 'runTaskAction',
    },
    async (req, reply) => {
      const { session_id, tail } = req.params as {
        session_id: string;
        tail: string;
      };
      const parsed = parseActionSuffix({
        tail,
        allowedActions: ['cancel', 'detach'] as const,
        resourceLabel: 'task',
      });
      if (parsed.kind === 'invalid') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.reason, req.id));
        return;
      }
      if (parsed.kind === 'bare') {
        reply.send(
          errEnvelope(ErrorCode.VALIDATION_FAILED, `unsupported action: ${tail}`, req.id),
        );
        return;
      }
      const task_id = parsed.id;
      if (!session_id || !task_id) {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, 'invalid path params', req.id));
        return;
      }

      const resolved = await resolveSessionTasks(core, session_id);
      if (resolved.kind === 'not_found') {
        reply.send(sessionNotFound(session_id, req.id));
        return;
      }

      const found = resolved.tasks?.getTask(task_id);
      if (found === undefined) {
        reply.send(taskNotFound(session_id, task_id, req.id));
        return;
      }

      if (parsed.action === 'cancel') {
        const wireStatus = toWireTask(session_id, found).status;
        if (isTerminalStatus(wireStatus)) {
          reply.send(taskAlreadyFinished(session_id, task_id, wireStatus, req.id));
          return;
        }

        await resolved.tasks?.stopByUser(task_id);
        requestLog(req)?.info({ session_id, task_id }, 'task cancelled');
        reply.send(okEnvelope({ cancelled: true as const }, req.id));
        return;
      }

      const detached = found.status === 'running' && found.detached === false;
      const info = resolved.tasks?.detach(task_id) ?? found;
      if (detached) {
        requestLog(req)?.info({ session_id, task_id }, 'task detached');
      }
      reply.send(okEnvelope({ detached, status: mapStatus(info.status) }, req.id));
    },
  );
  app.post(taskActionRoute.path, taskActionRoute.options, taskActionRoute.handler as Parameters<TasksRouteHost['post']>[2]);
}

type ResolvedTasks =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'resolved'; readonly tasks: IAgentTaskService | undefined };

async function resolveSessionTasks(core: Scope, sid: string): Promise<ResolvedTasks> {
  const summary = await core.accessor.get(ISessionIndex).get(sid);
  if (summary === undefined) return { kind: 'not_found' };

  const session = getLiveSessionById(core.accessor, sid);
  if (session === undefined) return { kind: 'resolved', tasks: undefined };
  const agent = await ensureMainAgent(session);
  const tasks = agent.accessor.get(IAgentTaskService);
  return { kind: 'resolved', tasks };
}

function mapKind(k: AgentTaskInfo['kind']): TaskKind {
  switch (k) {
    case 'process':
      return 'bash';
    case 'agent':
      return 'subagent';
    case 'question':
      return 'tool';
  }
}

function mapStatus(s: AgentTaskInfo['status']): TaskStatus {
  switch (s) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'timed_out':
      return 'failed';
    case 'killed':
      return 'cancelled';
    case 'lost':
      return 'failed';
  }
}

const TERMINAL_WIRE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_WIRE_STATUSES.has(status);
}

async function readTaskOutput(
  tasks: IAgentTaskService,
  taskId: string,
  tailBytes: number,
): Promise<{ preview: string; bytes: number } | undefined> {
  try {
    const output = await tasks.getOutputSnapshot(taskId, tailBytes);
    if (output.preview.length === 0) return undefined;
    return { preview: output.preview, bytes: output.previewBytes };
  } catch {
    return undefined;
  }
}

function toWireTask(
  sessionId: string,
  info: AgentTaskInfo,
  output?: { preview: string; bytes: number },
): Task {
  const status = mapStatus(info.status);
  const createdIso = new Date(info.startedAt).toISOString();
  const base: Task = {
    id: info.taskId,
    session_id: sessionId,
    kind: mapKind(info.kind),
    description: info.description,
    status,
    created_at: createdIso,
    started_at: createdIso,
    run_in_background: info.detached ?? true,
  };
  if (info.endedAt !== null && info.endedAt !== undefined) {
    base.completed_at = new Date(info.endedAt).toISOString();
  }
  if (info.kind === 'process' && 'command' in info && typeof info.command === 'string') {
    base.command = info.command;
  }
  if (info.kind === 'agent' && info.model !== undefined) {
    base.model = info.model;
  }
  if (info.kind === 'agent' && info.thinkingEffort !== undefined) {
    base.thinking_effort = info.thinkingEffort;
  }
  if (info.kind === 'agent' && info.routing !== undefined) {
    base.routing = toRoutingWire(info.routing);
  }
  if (info.kind === 'agent' && info.currentRoutingEnvironmentRevision !== undefined) {
    base.current_routing_env_revision = info.currentRoutingEnvironmentRevision;
  }
  if (info.kind === 'agent' && info.agentId !== undefined) {
    base.agent_id = info.agentId;
  }
  if (info.kind === 'agent' && info.subagentType !== undefined) {
    base.subagent_type = info.subagentType;
  }
  if (
    (info.kind === 'agent' || info.kind === 'process') &&
    info.parentToolCallId !== undefined
  ) {
    base.parent_tool_call_id = info.parentToolCallId;
  }
  if (output !== undefined) {
    base.output_preview = output.preview;
    base.output_bytes = output.bytes;
  }
  return base;
}

export function toRoutingWire(routing: SubagentBindingProvenance): SubagentRoutingWire {
  return {
    operation: routing.operation,
    profile_source: routing.profileSource,
    model_source: routing.modelSource,
    policy_mode: routing.policyMode,
    policy_source: routing.policySource,
    feature_source: routing.featureSource,
    routing_env_revision: routing.resolvedFromRoutingEnvironmentRevision,
    route_decision: routing.routeDecisionFingerprint,
  };
}

function sessionNotFound(sid: string, requestId: string): unknown {
  return errEnvelope(ErrorCode.SESSION_NOT_FOUND, `session ${sid} does not exist`, requestId);
}

function taskNotFound(sid: string, tid: string, requestId: string): unknown {
  return errEnvelope(
    ErrorCode.TASK_NOT_FOUND,
    `task ${tid} does not exist in session ${sid}`,
    requestId,
  );
}

function taskAlreadyFinished(
  sid: string,
  tid: string,
  currentStatus: TaskStatus,
  requestId: string,
): unknown {
  return {
    code: ErrorCode.TASK_ALREADY_FINISHED,
    msg: `task ${tid} already finished (status: ${currentStatus})`,
    data: { cancelled: false },
    request_id: requestId,
    details: { current_status: currentStatus },
  };
}
