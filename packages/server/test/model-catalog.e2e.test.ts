import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IModelCatalogService,
  InstantiationService,
  ServiceCollection,
  type IModelCatalogService as ModelCatalogServiceShape,
} from '@pymodel/agent-core';

import { IRestGateway, startServer, type RunningServer, type ServerStartOptions } from '../src';
import { registerModelCatalogRoutes } from '../src/routes/modelCatalog';

let tmpDir: string;
let lockPath: string;
let bridgeHome: string;
let server: RunningServer | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-server-model-catalog-test-'));
  lockPath = join(tmpDir, 'lock');
  bridgeHome = mkdtempSync(join(tmpdir(), 'pythinker-server-model-catalog-home-'));
});

afterEach(async () => {
  try {
    await server?.close();
  } catch {
    // ignore
  }
  server = undefined;
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(bridgeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function bootDaemon(
  serviceOverrides?: ServerStartOptions['serviceOverrides'],
): Promise<RunningServer> {
  server = await startServer({
    host: '127.0.0.1',
    port: 0,
    lockPath,
    logger: pino({ level: 'silent' }),
    coreProcessOptions: { homeDir: bridgeHome },
    serviceOverrides,
  });
  return server;
}

function appOf(r: RunningServer): {
  inject: (req: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
} {
  return r.services.invokeFunction((a) => {
    const gw = a.get(IRestGateway);
    return gw.app as unknown as {
      inject: (req: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
    };
  });
}

function envelopeOf<T>(body: unknown): {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
} {
  return body as {
    code: number;
    msg: string;
    data: T | null;
    request_id: string;
  };
}

function seedConfig(toml: string): void {
  writeFileSync(join(bridgeHome, 'config.toml'), toml, 'utf-8');
}

function seedCatalogConfig(): void {
  seedConfig(
    [
      'default_model = "k2"',
      '',
      '[providers.pythinker]',
      'type = "pythinker"',
      'api_key = "sk-test"',
      'base_url = "https://api.example.test/v1"',
      '',
      '[providers.openai]',
      'type = "openai"',
      '',
      '[models.k2]',
      'provider = "pythinker"',
      'model = "pythinker-k2"',
      'max_context_size = 131072',
      'display_name = "Pythinker K2"',
      'capabilities = ["thinking"]',
      '',
      '[models.turbo]',
      'provider = "pythinker"',
      'model = "pythinker-turbo"',
      'max_context_size = 32768',
      'display_name = "Pythinker Turbo"',
      '',
      '[models.gpt4o]',
      'provider = "openai"',
      'model = "gpt-4o"',
      'max_context_size = 128000',
      '',
    ].join('\n'),
  );
}

describe('model/provider catalog routes', () => {
  it('registers DELETE /providers/{provider_id} and removes through the service', async () => {
    type RouteHost = Parameters<typeof registerModelCatalogRoutes>[0];
    type DeleteHandler = Parameters<RouteHost['delete']>[2];
    let deleteHandler: DeleteHandler = () => {
      throw new Error('delete route was not registered');
    };
    const app: RouteHost = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn((path, _options, handler) => {
        expect(path).toBe('/providers/:provider_id');
        deleteHandler = handler;
      }),
    };
    const removeProvider = vi.fn(async () => undefined);
    const service = {
      _serviceBrand: undefined,
      listModels: async () => [],
      listProviders: async () => [],
      getProvider: async () => { throw new Error('not used'); },
      removeProvider,
      setDefaultModel: async () => { throw new Error('not used'); },
    } satisfies ModelCatalogServiceShape;
    const ix = new InstantiationService(
      new ServiceCollection([IModelCatalogService, service]),
    );
    registerModelCatalogRoutes(app, ix);
    const send = vi.fn();

    await deleteHandler(
      { id: 'req_delete', params: { provider_id: 'openai' } },
      { send },
    );

    expect(removeProvider).toHaveBeenCalledWith('openai');
    expect(send).toHaveBeenCalledWith({
      code: 0,
      msg: 'success',
      data: { deleted: true },
      request_id: 'req_delete',
    });
    ix.dispose();
  });

  it('lists configured models as selectable aliases', async () => {
    seedCatalogConfig();
    const r = await bootDaemon();
    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/models' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<{ items: unknown[] }>(res.json());
    expect(env.code).toBe(0);
    expect(env.data?.items).toEqual([
      {
        provider: 'pythinker',
        model: 'k2',
        display_name: 'Pythinker K2',
        max_context_size: 131072,
        capabilities: ['thinking'],
      },
      {
        provider: 'pythinker',
        model: 'turbo',
        display_name: 'Pythinker Turbo',
        max_context_size: 32768,
      },
      {
        provider: 'openai',
        model: 'gpt4o',
        display_name: 'gpt-4o',
        max_context_size: 128000,
        // Declares no capabilities in config, so they are derived from the
        // model itself. `k2` above keeps the list its config states, and
        // `turbo` omits the field because the pythinker wire reports unknown.
        capabilities: ['image_in', 'tool_use'],
      },
    ]);
  });

  it('lists providers and returns a single provider by id', async () => {
    seedCatalogConfig();
    const r = await bootDaemon();

    const list = await appOf(r).inject({ method: 'GET', url: '/api/v1/providers' });
    const listEnv = envelopeOf<{ items: unknown[] }>(list.json());
    expect(listEnv.code).toBe(0);
    expect(listEnv.data?.items).toEqual([
      {
        id: 'pythinker',
        type: 'pythinker',
        base_url: 'https://api.example.test/v1',
        default_model: 'k2',
        has_api_key: true,
        status: 'connected',
        models: ['k2', 'turbo'],
      },
      {
        id: 'openai',
        type: 'openai',
        has_api_key: false,
        status: 'unconfigured',
        models: ['gpt4o'],
      },
    ]);

    const single = await appOf(r).inject({
      method: 'GET',
      url: '/api/v1/providers/pythinker',
    });
    const singleEnv = envelopeOf<unknown>(single.json());
    expect(singleEnv.code).toBe(0);
    expect(singleEnv.data).toEqual({
      id: 'pythinker',
      type: 'pythinker',
      base_url: 'https://api.example.test/v1',
      default_model: 'k2',
      has_api_key: true,
      status: 'connected',
      models: ['k2', 'turbo'],
    });
  });

  it('sets the global default model and updates /auth', async () => {
    seedCatalogConfig();
    const r = await bootDaemon();

    const setDefault = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/models/turbo:set_default',
      payload: {},
    });
    const setEnv = envelopeOf<unknown>(setDefault.json());
    expect(setEnv.code).toBe(0);
    expect(setEnv.data).toEqual({
      default_model: 'turbo',
      model: {
        provider: 'pythinker',
        model: 'turbo',
        display_name: 'Pythinker Turbo',
        max_context_size: 32768,
      },
    });

    const auth = await appOf(r).inject({ method: 'GET', url: '/api/v1/auth' });
    const authEnv = envelopeOf<{ default_model: string | null }>(auth.json());
    expect(authEnv.code).toBe(0);
    expect(authEnv.data?.default_model).toBe('turbo');
  });

  it('deletes a provider and its model aliases', async () => {
    seedCatalogConfig();
    const r = await bootDaemon();

    const removed = await appOf(r).inject({
      method: 'DELETE',
      url: '/api/v1/providers/pythinker',
    });
    expect(removed.statusCode).toBe(200);
    expect(envelopeOf<{ deleted: true }>(removed.json()).data).toEqual({ deleted: true });

    const provider = await appOf(r).inject({
      method: 'GET',
      url: '/api/v1/providers/pythinker',
    });
    expect(envelopeOf<unknown>(provider.json()).code).toBe(40412);

    const models = await appOf(r).inject({ method: 'GET', url: '/api/v1/models' });
    expect(envelopeOf<{ items: Array<{ provider: string }> }>(models.json()).data?.items)
      .toEqual([
        {
          provider: 'openai',
          model: 'gpt4o',
          display_name: 'gpt-4o',
          max_context_size: 128000,
          capabilities: ['image_in', 'tool_use'],
        },
      ]);
  });

  it('maps unknown provider and model ids to catalog not-found error codes', async () => {
    seedCatalogConfig();
    const r = await bootDaemon();

    const provider = await appOf(r).inject({
      method: 'GET',
      url: '/api/v1/providers/missing',
    });
    expect(envelopeOf<unknown>(provider.json()).code).toBe(40412);

    const deleteProvider = await appOf(r).inject({
      method: 'DELETE',
      url: '/api/v1/providers/missing',
    });
    expect(envelopeOf<unknown>(deleteProvider.json()).code).toBe(40412);

    const model = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/models/missing:set_default',
      payload: {},
    });
    expect(envelopeOf<unknown>(model.json()).code).toBe(40413);
  });

});
