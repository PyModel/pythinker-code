import { z } from 'zod';

import {
  codexLoginStartSchema,
  codexLoginStatusSchema,
  codexLoginSubmitCodeRequestSchema,
  ErrorCode,
} from '@pymodel/protocol';
import {
  CodexLoginInvalidCodeError,
  CodexLoginNotFoundError,
  ICodexLoginService,
  type IInstantiationService,
} from '@pymodel/agent-core';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { parseActionSuffix } from './action-suffix';

interface CodexLoginRouteHost {
  get(
    path: string,
    options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined,
    handler: (
      req: { id: string; params: unknown },
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

const loginIdParamSchema = z.object({
  login_id: z.string().min(1),
});

const loginActionTailParamSchema = z.object({
  tail: z.string().min(1),
});

export function registerCodexLoginRoutes(
  app: CodexLoginRouteHost,
  ix: IInstantiationService,
): void {
  const startRoute = defineRoute(
    {
      method: 'POST',
      path: '/auth/codex:start',
      success: { data: codexLoginStartSchema },
      description: 'Begin an OpenAI Codex OAuth login and return the authorize URL',
      tags: ['auth'],
      operationId: 'startCodexLogin',
    },
    async (req, reply) => {
      const start = await ix.invokeFunction((a) => a.get(ICodexLoginService).start());
      reply.send(okEnvelope(start, req.id));
    },
  );
  app.post(
    startRoute.path,
    startRoute.options,
    startRoute.handler as Parameters<CodexLoginRouteHost['post']>[2],
  );

  const statusRoute = defineRoute(
    {
      method: 'GET',
      path: '/auth/codex/{login_id}',
      params: loginIdParamSchema,
      success: { data: codexLoginStatusSchema },
      errors: {
        [ErrorCode.CODEX_LOGIN_NOT_FOUND]: {},
      },
      description: 'Poll the state of an OpenAI Codex login',
      tags: ['auth'],
      operationId: 'getCodexLoginStatus',
    },
    async (req, reply) => {
      try {
        const status = ix.invokeFunction((a) =>
          a.get(ICodexLoginService).status(req.params.login_id),
        );
        reply.send(okEnvelope(status, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.get(
    statusRoute.path,
    statusRoute.options,
    statusRoute.handler as Parameters<CodexLoginRouteHost['get']>[2],
  );

  const actionRoute = defineRoute(
    {
      method: 'POST',
      path: '/auth/codex/{tail}',
      params: loginActionTailParamSchema,
      body: codexLoginSubmitCodeRequestSchema.partial(),
      success: { data: codexLoginStatusSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
        [ErrorCode.CODEX_LOGIN_NOT_FOUND]: {},
      },
      description: 'Submit a pasted redirect URL, or cancel an OpenAI Codex login',
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
            parsed.kind === 'invalid' ? parsed.reason : `unsupported action: ${req.params.tail}`;
          reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, message, req.id));
          return;
        }

        if (parsed.action === 'cancel') {
          const status = ix.invokeFunction((a) =>
            a.get(ICodexLoginService).cancel(parsed.id),
          );
          reply.send(okEnvelope(status, req.id));
          return;
        }

        const redirectUrl = req.body.redirect_url;
        if (redirectUrl === undefined || redirectUrl.length === 0) {
          reply.send(
            errEnvelope(ErrorCode.VALIDATION_FAILED, 'redirect_url is required', req.id),
          );
          return;
        }
        const status = await ix.invokeFunction((a) =>
          a.get(ICodexLoginService).submitCode(parsed.id, redirectUrl),
        );
        reply.send(okEnvelope(status, req.id));
      } catch (error) {
        sendMappedError(reply, req.id, error);
      }
    },
  );
  app.post(
    actionRoute.path,
    actionRoute.options,
    actionRoute.handler as Parameters<CodexLoginRouteHost['post']>[2],
  );
}

function sendMappedError(
  reply: { send(payload: unknown): unknown },
  requestId: string,
  err: unknown,
): void {
  if (err instanceof CodexLoginNotFoundError) {
    reply.send(errEnvelope(ErrorCode.CODEX_LOGIN_NOT_FOUND, err.message, requestId));
    return;
  }
  if (err instanceof CodexLoginInvalidCodeError) {
    reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, err.message, requestId));
    return;
  }
  throw err;
}
