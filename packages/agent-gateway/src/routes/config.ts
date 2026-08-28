import {
  ConfigChanged,
  IConfigRegistry,
  IConfigService,
  IEventService,
  type Scope,
} from '@pymodel/agent-core-v2';

import { errEnvelope, okEnvelope } from '../envelope';
import { requestLog } from '../lib/requestLog';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import { configResponseSchema, patchConfigRequestSchema } from '../protocol/rest-config';
import type { ConfigResponse, LegacySecondaryModelRequest } from '../protocol/rest-config';

const SECONDARY_MODEL_DOMAIN = 'secondaryModel';

type ProviderResponse = ConfigResponse['providers'][string];

interface ConfigRouteHost {
  get(
    path: string,
    options: { schema?: Record<string, unknown> },
    handler: (
      req: { id: string },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): unknown;
  post(
    path: string,
    options: { schema?: Record<string, unknown> },
    handler: (
      req: { id: string; body: unknown },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): unknown;
}

export function registerConfigRoutes(app: ConfigRouteHost, core: Scope): void {
  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/config',
      success: { data: configResponseSchema },
      description: 'Get the global Pythinker configuration (secrets redacted)',
      tags: ['config'],
    },
    async (req, reply) => {
      const config = core.accessor.get(IConfigService);
      await config.ready;
      reply.send(okEnvelope(toConfigResponse(config.getAll()), req.id));
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as Parameters<ConfigRouteHost['get']>[2]);

  const setRoute = defineRoute(
    {
      method: 'POST',
      path: '/config',
      body: patchConfigRequestSchema,
      success: { data: configResponseSchema },
      errors: {
        [ErrorCode.VALIDATION_FAILED]: {},
      },
      description: 'Update the global Pythinker configuration (merge semantics)',
      tags: ['config'],
    },
    async (req, reply) => {
      try {
        const config = core.accessor.get(IConfigService);
        const registry = core.accessor.get(IConfigRegistry);
        await config.ready;
        const { secondary_model: secondaryModel, ...ordinary } = req.body;
        const converted = convertKeysSnakeToCamel(ordinary);
        const camelPatch: Record<string, unknown> = isPlainObject(converted) ? converted : {};
        if (camelPatch['yolo'] === true) {
          camelPatch['defaultPermissionMode'] = 'yolo';
        }
        delete camelPatch['yolo'];
        const staged: Record<string, unknown> = {};
        for (const domain of Object.keys(camelPatch)) {
          const base = config.inspect(domain).userValue;
          staged[domain] = registry.merge(domain, base, camelPatch[domain]);
        }
        if (secondaryModel !== undefined) {
          staged[SECONDARY_MODEL_DOMAIN] =
            secondaryModel === null ? null : toSecondaryModelReplacement(secondaryModel);
        }
        await config.replaceSections(staged);
        const response = toConfigResponse(config.getAll());
        const changedFields = Object.keys(req.body as Record<string, unknown>);
        core.accessor.get(IEventService).publish(
          new ConfigChanged({ payload: { changedFields, config: response } }),
        );
        requestLog(req)?.info({ changedFields }, 'config updated');
        reply.send(okEnvelope(response, req.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        requestLog(req)?.error({ err: error }, 'config update failed');
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, message, req.id));
      }
    },
  );
  app.post(setRoute.path, setRoute.options, setRoute.handler as Parameters<ConfigRouteHost['post']>[2]);
}

function toSecondaryModelReplacement(legacy: LegacySecondaryModelRequest): Record<string, unknown> {
  const replacement: Record<string, unknown> = {};
  const defaultModel = legacy.default_model ?? legacy.defaultModel;
  const defaultEffort = legacy.default_effort ?? legacy.defaultEffort;
  if (defaultModel !== undefined) replacement['defaultModel'] = defaultModel;
  if (legacy.model !== undefined) replacement['model'] = legacy.model;
  if (defaultEffort !== undefined) replacement['defaultEffort'] = defaultEffort;
  if (legacy.models !== undefined) replacement['models'] = legacy.models;
  if (legacy.force === true) replacement['force'] = true;
  return replacement;
}

function toConfigResponse(resolved: Record<string, unknown>): ConfigResponse {
  const wire: Record<string, unknown> = {};
  for (const [domain, value] of Object.entries(resolved)) {
    wire[camelToSnake(domain)] = domain === 'providers' ? toProviderResponses(value) : value;
  }
  const defaultPermissionMode = resolved['defaultPermissionMode'];
  if (typeof defaultPermissionMode === 'string') {
    wire['yolo'] = defaultPermissionMode === 'yolo';
  }
  if (wire['providers'] === undefined) {
    wire['providers'] = {};
  }
  return wire as ConfigResponse;
}

interface ProviderLike {
  readonly type?: unknown;
  readonly baseUrl?: unknown;
  readonly defaultModel?: unknown;
  readonly apiKey?: unknown;
  readonly oauth?: unknown;
}

function toProviderResponses(value: unknown): Record<string, ProviderResponse> {
  const result: Record<string, ProviderResponse> = {};
  if (!isPlainObject(value)) return result;
  for (const [id, raw] of Object.entries(value)) {
    const provider = raw as ProviderLike;
    result[id] = {
      type: typeof provider.type === 'string' ? provider.type : '',
      base_url: nonEmpty(provider.baseUrl),
      default_model: nonEmpty(provider.defaultModel),
      has_api_key: hasProviderCredential(provider),
    };
  }
  return result;
}

function hasProviderCredential(provider: ProviderLike): boolean {
  if (nonEmpty(provider.apiKey) !== undefined) return true;
  if (provider.oauth !== undefined) return true;
  return false;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAP_VALUED_CONFIG_KEYS = new Set(['providers', 'models', 'experimental', 'raw']);

function convertKeysSnakeToCamel(obj: unknown, preserveKeys = false): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => convertKeysSnakeToCamel(item));
  }
  if (isPlainObject(obj)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[preserveKeys ? key : snakeToCamel(key)] = convertKeysSnakeToCamel(
        value,
        !preserveKeys && MAP_VALUED_CONFIG_KEYS.has(key),
      );
    }
    return result;
  }
  return obj;
}

function snakeToCamel(str: string): string {
  return str.replaceAll(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function camelToSnake(str: string): string {
  return str.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
