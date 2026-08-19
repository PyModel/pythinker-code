import { IOAuthService, type Scope } from '@pymodel/agent-core-v2';
import { PYTHINKER_CODE_PROVIDER_NAME } from '@pymodel/pythinker-code-oauth';
import {
  oauthFlowSnapshotSchema,
  oauthFlowStartSchema,
  oauthLoginCancelResponseSchema,
  oauthLogoutResponseSchema,
} from '@pymodel/agent-core-v2/app/auth/oauthProtocol';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { requestLog } from '../lib/requestLog';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import {
  oauthLoginQuerySchema,
  oauthLoginStartRequestSchema,
  oauthLogoutRequestSchema,
} from '../protocol/rest-oauth';

interface RouteHost {
  get(
    path: string,
    options: { preHandler?: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; query: unknown },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { preHandler?: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): unknown;
  delete(
    path: string,
    options: { preHandler?: unknown[]; schema?: Record<string, unknown> },
    handler: (
      req: { id: string; query: unknown },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): unknown;
}

const oauthFlowSnapshotOrNullSchema = z.union([
  oauthFlowSnapshotSchema,
  z.null(),
]);

export function registerOAuthRoutes(app: RouteHost, core: Scope): void {
  const loginStartRoute = defineRoute(
    {
      method: 'POST',
      path: '/oauth/login',
      body: oauthLoginStartRequestSchema,
      success: { data: oauthFlowStartSchema },
      description: 'Start an OAuth device-code flow',
      tags: ['auth'],
    },
    async (req, reply) => {
      const provider = req.body.provider;
      if (provider === undefined || provider === PYTHINKER_CODE_PROVIDER_NAME) {
        reply.send(
          errEnvelope(
            ErrorCode.PROVIDER_OAUTH_MANAGED,
            'Managed account sign-in is not available in this distribution.',
            req.id,
          ),
        );
        return;
      }
      const result = await core.accessor.get(IOAuthService).startLogin(provider);
      requestLog(req)?.info({ provider, action: 'login' }, 'oauth login started');
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(
    loginStartRoute.path,
    loginStartRoute.options,
    loginStartRoute.handler as Parameters<RouteHost['post']>[2],
  );

  const loginPollRoute = defineRoute(
    {
      method: 'GET',
      path: '/oauth/login',
      querystring: oauthLoginQuerySchema,
      success: { data: oauthFlowSnapshotOrNullSchema },
      description: 'Poll the current OAuth device-code flow',
      tags: ['auth'],
    },
    async (req, reply) => {
      const snapshot = core.accessor.get(IOAuthService).getFlow(req.query.provider);
      reply.send(okEnvelope(snapshot ?? null, req.id));
    },
  );
  app.get(
    loginPollRoute.path,
    loginPollRoute.options,
    loginPollRoute.handler as Parameters<RouteHost['get']>[2],
  );

  const loginCancelRoute = defineRoute(
    {
      method: 'DELETE',
      path: '/oauth/login',
      querystring: oauthLoginQuerySchema,
      success: { data: oauthLoginCancelResponseSchema },
      description: 'Cancel the current OAuth device-code flow',
      tags: ['auth'],
    },
    async (req, reply) => {
      const result = await core.accessor.get(IOAuthService).cancelLogin(req.query.provider);
      requestLog(req)?.info(
        { provider: req.query.provider, action: 'cancel_login' },
        'oauth login cancelled',
      );
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.delete(
    loginCancelRoute.path,
    loginCancelRoute.options,
    loginCancelRoute.handler as Parameters<RouteHost['delete']>[2],
  );

  const logoutRoute = defineRoute(
    {
      method: 'POST',
      path: '/oauth/logout',
      body: oauthLogoutRequestSchema,
      success: { data: oauthLogoutResponseSchema },
      description: 'Logout the managed OAuth provider',
      tags: ['auth'],
    },
    async (req, reply) => {
      const result = await core.accessor.get(IOAuthService).logout(req.body.provider);
      requestLog(req)?.info({ provider: req.body.provider, action: 'logout' }, 'oauth logout');
      reply.send(okEnvelope(result, req.id));
    },
  );
  app.post(
    logoutRoute.path,
    logoutRoute.options,
    logoutRoute.handler as Parameters<RouteHost['post']>[2],
  );

}
