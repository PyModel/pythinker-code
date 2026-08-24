import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CoreRPC,
  GetPythinkerConfigPayload,
  PythinkerConfig,
  PythinkerConfigPatch,
  SetPythinkerConfigPayload,
} from '../../src';
import {
  type ICoreProcessService,
  type IEnvironmentService,
  ModelCatalogService,
  ModelNotFoundError,
  ProviderNotFoundError,
  toProtocolModel,
  toProtocolProvider,
} from '../../src/services';
import type { IEventService } from '../../src/services/event/event';
import type { Event as ProtocolEvent } from '@pymodel/protocol';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function makeEnv(): IEnvironmentService {
  return {
    _serviceBrand: undefined,
    homeDir: '/tmp/pythinker-model-catalog-test',
    configPath: '/tmp/pythinker-model-catalog-test/config.toml',
  };
}

function makeCore(configRef: { current: PythinkerConfig }): {
  core: ICoreProcessService;
  getCalls: GetPythinkerConfigPayload[];
  setCalls: PythinkerConfigPatch[];
  removeCalls: string[];
} {
  const getCalls: GetPythinkerConfigPayload[] = [];
  const setCalls: PythinkerConfigPatch[] = [];
  const removeCalls: string[] = [];
  const rpc: Partial<CoreRPC> = {
    getPythinkerConfig: vi.fn(async (payload: GetPythinkerConfigPayload) => {
      getCalls.push(payload);
      return configRef.current;
    }),
    setPythinkerConfig: vi.fn(async (payload: SetPythinkerConfigPayload) => {
      setCalls.push(payload);
      const next: PythinkerConfig = { ...configRef.current };
      if (payload.providers !== undefined) {
        next.providers = payload.providers as PythinkerConfig['providers'];
      }
      if (payload.models !== undefined) {
        next.models = payload.models as PythinkerConfig['models'];
      }
      if (payload.defaultModel !== undefined) next.defaultModel = payload.defaultModel;
      if (payload.thinking !== undefined) next.thinking = payload.thinking;
      configRef.current = next;
      return configRef.current;
    }),
    removePythinkerProvider: vi.fn(async ({ providerId }) => {
      removeCalls.push(providerId);
      const providers = { ...configRef.current.providers };
      delete providers[providerId];
      const models = Object.fromEntries(
        Object.entries(configRef.current.models ?? {}).filter(([, model]) => model.provider !== providerId),
      ) as PythinkerConfig['models'];
      configRef.current = {
        ...configRef.current,
        providers,
        models,
        defaultModel: undefined,
      };
      return configRef.current;
    }),
  };
  return {
    core: {
      _serviceBrand: undefined,
      rpc: rpc as CoreRPC,
      ready: async () => undefined,
      dispose: () => undefined,
    },
    getCalls,
    setCalls,
    removeCalls,
  };
}

function makeEventService(): { svc: IEventService; published: ProtocolEvent[] } {
  const published: ProtocolEvent[] = [];
  const svc: IEventService = {
    _serviceBrand: undefined,
    onDidPublish: () => ({ dispose: () => undefined }),
    publish: (event) => {
      published.push(event);
    },
  };
  return { svc, published };
}

function catalogConfig(): PythinkerConfig {
  return {
    providers: {
      pythinker: {
        type: 'pythinker',
        apiKey: 'sk-test',
        baseUrl: 'https://api.example.test/v1',
      },
      openai: { type: 'openai' },
    },
    defaultModel: 'k2',
    models: {
      k2: {
        provider: 'pythinker',
        model: 'kimi-k2',
        maxContextSize: 131072,
        displayName: 'Kimi K2',
        capabilities: ['thinking'],
      },
      turbo: {
        provider: 'pythinker',
        model: 'pythinker-turbo',
        maxContextSize: 32768,
      },
      gpt4o: {
        provider: 'openai',
        model: 'gpt-4o',
        maxContextSize: 128000,
      },
    },
  };
}

describe('model catalog adapters', () => {
  it('maps model aliases to selectable wire ids', () => {
    const alias = catalogConfig().models!['k2']!;
    expect(toProtocolModel('k2', alias)).toEqual({
      provider: 'pythinker',
      model: 'k2',
      display_name: 'Kimi K2',
      max_context_size: 131072,
      capabilities: ['thinking'],
    });
  });

  it('uses the provider model name as display fallback', () => {
    const alias = catalogConfig().models!['turbo']!;
    expect(toProtocolModel('turbo', alias).display_name).toBe('pythinker-turbo');
  });

  it('projects official Anthropic effort metadata inferred from the model name', () => {
    expect(
      toProtocolModel('opus', {
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        maxContextSize: 200000,
      }),
    ).toMatchObject({
      capabilities: ['thinking'],
      support_efforts: ['low', 'medium', 'high', 'max'],
      default_effort: 'high',
    });
  });

  it('maps provider model ids and global default', () => {
    const config = catalogConfig();
    expect(
      toProtocolProvider('pythinker', config.providers['pythinker']!, config, {
        hasApiKey: true,
        hasOAuthToken: false,
      }),
    ).toEqual({
      id: 'pythinker',
      type: 'pythinker',
      base_url: 'https://api.example.test/v1',
      default_model: 'k2',
      has_api_key: true,
      status: 'connected',
      models: ['k2', 'turbo'],
    });
  });
});

describe('ModelCatalogService', () => {
  it('lists models and providers from live config', async () => {
    const configRef = { current: catalogConfig() };
    const { core, getCalls } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    expect(await svc.listModels()).toHaveLength(3);
    expect(await svc.listProviders()).toHaveLength(2);
    expect(getCalls).toEqual([{ reload: true }, { reload: true }]);
  });

  it('projects latest Opus efforts for unknown Claude-marked Anthropic-compatible models', async () => {
    const configRef = { current: catalogConfig() };
    configRef.current.providers['custom'] = { type: 'anthropic' };
    configRef.current.models!['compatible'] = {
      provider: 'custom',
      model: 'custom-claude-model',
      maxContextSize: 128000,
    };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    const compatible = (await svc.listModels()).find((model) => model.model === 'compatible');
    expect(compatible).toMatchObject({
      capabilities: ['thinking'],
      support_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      default_effort: 'high',
    });
  });

  it('does not project fallback efforts for clearly non-Claude Anthropic-compatible models', async () => {
    const configRef = { current: catalogConfig() };
    configRef.current.providers['custom'] = { type: 'anthropic' };
    configRef.current.models!['compatible'] = {
      provider: 'custom',
      model: 'compatible-model',
      maxContextSize: 128000,
    };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    const compatible = (await svc.listModels()).find((model) => model.model === 'compatible');
    expect(compatible?.capabilities).toBeUndefined();
    expect(compatible?.support_efforts).toBeUndefined();
    expect(compatible?.default_effort).toBeUndefined();
  });

  it('does not project fallback efforts for a Pythinker provider routed through the Anthropic protocol', async () => {
    const configRef = { current: catalogConfig() };
    configRef.current.models!['compatible'] = {
      provider: 'pythinker',
      protocol: 'anthropic',
      model: 'compatible-model',
      maxContextSize: 128000,
    };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    const compatible = (await svc.listModels()).find((model) => model.model === 'compatible');
    expect(compatible).toMatchObject({
      provider: 'pythinker',
      model: 'compatible',
    });
    expect(compatible?.capabilities).toBeUndefined();
    expect(compatible?.support_efforts).toBeUndefined();
    expect(compatible?.default_effort).toBeUndefined();
  });

  it('gets one provider or throws ProviderNotFoundError', async () => {
    const configRef = { current: catalogConfig() };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    await expect(svc.getProvider('pythinker')).resolves.toMatchObject({ id: 'pythinker' });
    await expect(svc.getProvider('missing')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
  });

  it('sets defaultModel through core config patch', async () => {
    const configRef = { current: catalogConfig() };
    const { core, setCalls } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    await expect(svc.setDefaultModel('turbo')).resolves.toEqual({
      default_model: 'turbo',
      model: {
        provider: 'pythinker',
        model: 'turbo',
        display_name: 'pythinker-turbo',
        max_context_size: 32768,
      },
    });
    expect(setCalls).toEqual([{ defaultModel: 'turbo' }]);
  });

  it('rejects unknown model ids', async () => {
    const configRef = { current: catalogConfig() };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    await expect(svc.setDefaultModel('missing')).rejects.toBeInstanceOf(
      ModelNotFoundError,
    );
  });

  it('publishes one catalog event when a custom registry changes', async () => {
    const configRef: { current: PythinkerConfig } = {
      current: {
        providers: {
          acme: {
            type: 'openai',
            apiKey: 'sk-acme',
            source: {
              kind: 'apiJson',
              url: 'https://registry.example.test/api.json',
              apiKey: 'sk-registry',
            },
          },
        },
        models: {},
      },
    };
    const { core } = makeCore(configRef);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            acme: {
              id: 'acme',
              name: 'Acme',
              api: 'https://acme.example.test/v1',
              type: 'openai',
              models: { m1: { id: 'm1', name: 'M1' } },
            },
          }),
        ),
      ),
    );
    const { svc: eventService, published } = makeEventService();
    const svc = new ModelCatalogService(makeEnv(), core, eventService);

    const changed = await svc.refreshProviderModels();
    const unchanged = await svc.refreshProviderModels();

    expect(changed.changed).toEqual([
      expect.objectContaining({ provider_id: 'acme', provider_name: 'Acme' }),
    ]);
    expect(unchanged.changed).toEqual([]);
    expect(unchanged.unchanged).toEqual(['acme']);
    expect(published).toEqual([
      {
        type: 'event.model_catalog.changed',
        agentId: 'main',
        sessionId: '__global__',
        changed: changed.changed,
        unchanged: changed.unchanged,
        failed: changed.failed,
      },
    ]);
  });

  it('sends the host User-Agent on custom-registry fetches', async () => {
    const configRef: { current: PythinkerConfig } = {
      current: {
        providers: {
          acme: {
            type: 'openai',
            apiKey: 'sk-acme',
            source: {
              kind: 'apiJson',
              url: 'https://registry.example.test/api.json',
              apiKey: 'sk-registry',
            },
          },
        },
        models: {},
      },
    };
    const { core } = makeCore(configRef);
    (core as { pythinkerRequestHeaders?: Record<string, string> }).pythinkerRequestHeaders = {
      'User-Agent': 'pythinker-code-cli/test',
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            acme: {
              id: 'acme',
              name: 'Acme',
              api: 'https://acme.example.test/v1',
              type: 'openai',
              models: { m1: { id: 'm1', name: 'M1' } },
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const svc = new ModelCatalogService(makeEnv(), core, makeEventService().svc);

    await svc.refreshProviderModels();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.test/api.json',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': 'pythinker-code-cli/test' }),
      }),
    );
  });
});
