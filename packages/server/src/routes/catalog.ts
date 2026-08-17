/**
 * `/plugins*` + `/agent-profiles` REST routes.
 *
 * 3 endpoints:
 *
 *   GET  /plugins                          -                     data: {plugins: Plugin[]}
 *   POST /plugins/{plugin_id}:set-enabled  body: {enabled}       data: {id, enabled}
 *   GET  /agent-profiles                   query: {work_dir}     data: {profiles: AgentProfile[]}
 *
 * Both collections are global rather than session-scoped — plugins are loaded
 * once per daemon, and subagent profiles are resolved from a working directory
 * passed as a query parameter.
 *
 * **Action suffix**: the POST endpoint uses the shared `parseActionSuffix`
 * helper; `:set-enabled` is the only action and there is no bare form.
 *
 * **Anti-corruption**: route resolves `ICatalogService` via the accessor; no
 * SDK imports.
 */

import {
  ErrorCode,
  listAgentProfilesResponseSchema,
  listPluginsResponseSchema,
  setPluginEnabledRequestSchema,
  setPluginEnabledResultSchema,
} from '@pymodel/protocol';
import { ICatalogService, type IInstantiationService } from '@pymodel/agent-core';
import { z } from 'zod';

import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { parseActionSuffix } from './action-suffix';

interface CatalogRouteHost {
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

const listAgentProfilesQuerySchema = z.object({
  work_dir: z.string().min(1),
});

export function registerCatalogRoutes(
  app: CatalogRouteHost,
  ix: IInstantiationService,
): void {
  // GET /plugins --------------------------------------------------------
  const listPluginsRoute = defineRoute(
    {
      method: 'GET',
      path: '/plugins',
      success: { data: listPluginsResponseSchema },
      description: 'List installed plugins',
      tags: ['catalog'],
    },
    async (req, reply) => {
      const plugins = await ix.invokeFunction((a) => a.get(ICatalogService).listPlugins());
      reply.send(okEnvelope({ plugins }, req.id));
    },
  );
  app.get(
    listPluginsRoute.path,
    listPluginsRoute.options,
    listPluginsRoute.handler as Parameters<CatalogRouteHost['get']>[2],
  );

  // POST /plugins/{plugin_id}:set-enabled -------------------------------
  const setPluginEnabledRoute = defineRoute(
    {
      method: 'POST',
      path: '/plugins/{tail}',
      body: setPluginEnabledRequestSchema,
      success: { data: setPluginEnabledResultSchema },
      description: 'Enable or disable a plugin by ID',
      tags: ['catalog'],
      operationId: 'setPluginEnabled',
    },
    async (req, reply) => {
      const { tail } = req.params as { tail: string };
      const parsed = parseActionSuffix({
        tail,
        allowedActions: ['set-enabled'] as const,
        resourceLabel: 'plugin',
      });
      if (parsed.kind === 'invalid' || parsed.kind === 'bare') {
        reply.send(
          errEnvelope(
            ErrorCode.VALIDATION_FAILED,
            parsed.kind === 'invalid' ? parsed.reason : `unsupported action: ${tail}`,
            req.id,
          ),
        );
        return;
      }
      const { enabled } = req.body as { enabled: boolean };
      await ix.invokeFunction((a) => a.get(ICatalogService).setPluginEnabled(parsed.id, enabled));
      reply.send(okEnvelope({ id: parsed.id, enabled }, req.id));
    },
  );
  app.post(
    setPluginEnabledRoute.path,
    setPluginEnabledRoute.options,
    setPluginEnabledRoute.handler as Parameters<CatalogRouteHost['post']>[2],
  );

  // GET /agent-profiles -------------------------------------------------
  const listAgentProfilesRoute = defineRoute(
    {
      method: 'GET',
      path: '/agent-profiles',
      querystring: listAgentProfilesQuerySchema,
      success: { data: listAgentProfilesResponseSchema },
      description: 'List subagent profiles resolvable from a working directory',
      tags: ['catalog'],
    },
    async (req, reply) => {
      const { work_dir: workDir } = req.query as { work_dir: string };
      const profiles = await ix.invokeFunction((a) =>
        a.get(ICatalogService).listAgentProfiles(workDir),
      );
      reply.send(okEnvelope({ profiles }, req.id));
    },
  );
  app.get(
    listAgentProfilesRoute.path,
    listAgentProfilesRoute.options,
    listAgentProfilesRoute.handler as Parameters<CatalogRouteHost['get']>[2],
  );
}
