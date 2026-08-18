import {
  CodexLoginErrors,
  ICodexLoginService,
  isError2,
  type Scope,
} from '@pymodel/agent-core-v2';
import {
  codexLoginActionTailParamSchema,
  codexLoginIdParamSchema,
  codexLoginStartSchema,
  codexLoginStatusSchema,
  codexLoginSubmitCodeRequestSchema,
} from '@pymodel/agent-core-v2/app/codexLogin/codexLoginProtocol';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import { parseActionSuffix } from './action-suffix';

interface RouteHost {
  get(
    path: string,
    options: { preHandler?: unknown[]; schema?: Record<string, unknown> },
    handler: (req: { id: string; params: unknown }, reply: { send(payload: unknown): void }) => unknown,
  ): unknown;
  post(
    path: string,
    options: { preHandler?: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; params: unknown; body: unknown },
      reply: { send(payload: unknown): void },
    ) => unknown,
  ): unknown;
}

export function registerCodexLoginRoutes(app: RouteHost, core: Scope): void {
  const startRoute = defineRoute(
    {
      method: 'POST',
      path: '/auth/codex::start',
      success: { data: codexLoginStartSchema },
      description: 'Begin an OpenAI Codex OAuth login',
      tags: ['auth'],
      operationId: 'startCodexLogin',
    },
    async (req, reply) => {
      const result = await core.accessor.get(ICodexLoginService).start();
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(
    startRoute.path,
    startRoute.options,
    startRoute.handler as Parameters<RouteHost['post']>[2],
  );

  const statusRoute = defineRoute(
    {
      method: 'GET',
      path: '/auth/codex/{login_id}',
      params: codexLoginIdParamSchema,
      success: { data: codexLoginStatusSchema },
      errors: { [ErrorCode.CODEX_LOGIN_NOT_FOUND]: {} },
      description: 'Poll an OpenAI Codex OAuth login',
      tags: ['auth'],
      operationId: 'getCodexLoginStatus',
    },
    (req, reply) => {
      try {
        const result = core.accessor.get(ICodexLoginService).status(req.params.login_id);
        reply.send(okEnvelope(result, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    statusRoute.path,
    statusRoute.options,
    statusRoute.handler as Parameters<RouteHost['get']>[2],
  );

  const actionRoute = defineRoute(
    {
      method: 'POST',
      path: '/auth/codex/{tail}',
      params: codexLoginActionTailParamSchema,
      body: codexLoginSubmitCodeRequestSchema.partial(),
      success: { data: codexLoginStatusSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.CODEX_LOGIN_NOT_FOUND]: {},
      },
      description: 'Submit or cancel an OpenAI Codex OAuth login',
      tags: ['auth'],
      operationId: 'actOnCodexLogin',
    },
    async (req, reply) => {
      try {
        const parsed = parseActionSuffix({
          tail: req.params.tail,
          allowedActions: ['submit_code', 'cancel'] as const,
          resourceLabel: 'codex login',
        });
        if (parsed.kind !== 'action') {
          const message =
            parsed.kind === 'invalid'
              ? parsed.reason
              : `unsupported action: ${req.params.tail}`;
          reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, message, req.id));
          return;
        }
        if (parsed.action === 'cancel') {
          const result = core.accessor.get(ICodexLoginService).cancel(parsed.id);
          reply.send(okEnvelope(result, req.id));
          return;
        }
        if (req.body.redirect_url === undefined) {
          reply.send(
            errEnvelope(ErrorCode.VALIDATION_FAILED, 'redirect_url is required', req.id),
          );
          return;
        }
        const result = await core.accessor
          .get(ICodexLoginService)
          .submitCode(parsed.id, req.body.redirect_url);
        reply.send(okEnvelope(result, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    actionRoute.path,
    actionRoute.options,
    actionRoute.handler as Parameters<RouteHost['post']>[2],
  );
}

function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  error: unknown,
): void {
  if (isError2(error)) {
    if (error.code === CodexLoginErrors.codes.CODEX_LOGIN_NOT_FOUND) {
      reply.send(
        errEnvelope(ErrorCode.CODEX_LOGIN_NOT_FOUND, error.message, requestId),
      );
      return;
    }
    if (error.code === CodexLoginErrors.codes.CODEX_LOGIN_INVALID_CODE) {
      reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, error.message, requestId));
      return;
    }
  }
  throw error;
}
