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
  ModelCatalogService,
  ModelNotFoundError,
  ProviderNotFoundError,
  toProtocolModel,
  toProtocolProvider,
} from '../../src/services';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});


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
      if (payload.defaultThinking !== undefined) next.defaultThinking = payload.defaultThinking;
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
        model: 'pythinker-k2',
        maxContextSize: 131072,
        displayName: 'Pythinker K2',
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
      display_name: 'Pythinker K2',
      max_context_size: 131072,
      capabilities: ['thinking'],
    });
  });

  it('propagates optional per-model thinking metadata', () => {
    const configuredAlias = {
      ...catalogConfig().models!['k2']!,
      supportEfforts: ['low', 'high', 'max'],
      adaptiveThinking: true,
    };
    expect(toProtocolModel('k2', configuredAlias)).toEqual({
      provider: 'pythinker',
      model: 'k2',
      display_name: 'Pythinker K2',
      max_context_size: 131072,
      capabilities: ['thinking'],
      support_efforts: ['low', 'high', 'max'],
      adaptive_thinking: true,
    });

    const unconfigured = toProtocolModel('turbo', catalogConfig().models!['turbo']!);
    expect(unconfigured).toStrictEqual({
      provider: 'pythinker',
      model: 'turbo',
      display_name: 'pythinker-turbo',
      max_context_size: 32768,
      capabilities: undefined,
      support_efforts: undefined,
      adaptive_thinking: undefined,
    });
  });

  it('uses the provider model name as display fallback', () => {
    const alias = catalogConfig().models!['turbo']!;
    expect(toProtocolModel('turbo', alias).display_name).toBe('pythinker-turbo');
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
  it('reports a referenced shell credential without exposing it', async () => {
    vi.stubEnv('PYTHINKER_TEST_CATALOG_API_KEY', 'runtime-key');
    const config = catalogConfig();
    config.providers['openai'] = {
      type: 'openai',
      apiKeyEnvVar: 'PYTHINKER_TEST_CATALOG_API_KEY',
    };
    const configRef = { current: config };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(core);

    await expect(svc.getProvider('openai')).resolves.toMatchObject({
      id: 'openai',
      has_api_key: true,
      status: 'connected',
    });

    vi.stubEnv('PYTHINKER_TEST_CATALOG_API_KEY', '   ');
    await expect(svc.getProvider('openai')).resolves.toMatchObject({
      has_api_key: false,
      status: 'unconfigured',
    });
  });

  it('lists models and providers from live config', async () => {
    const configRef = { current: catalogConfig() };
    const { core, getCalls } = makeCore(configRef);
    const svc = new ModelCatalogService(core);

    expect(await svc.listModels()).toHaveLength(3);
    expect(await svc.listProviders()).toHaveLength(2);
    expect(getCalls).toEqual([{ reload: true }, { reload: true }]);
  });

  it('gets one provider or throws ProviderNotFoundError', async () => {
    const configRef = { current: catalogConfig() };
    const { core } = makeCore(configRef);
    const svc = new ModelCatalogService(core);

    await expect(svc.getProvider('pythinker')).resolves.toMatchObject({ id: 'pythinker' });
    await expect(svc.getProvider('missing')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
  });

  it('sets defaultModel through core config patch', async () => {
    const configRef = { current: catalogConfig() };
    const { core, setCalls } = makeCore(configRef);
    const svc = new ModelCatalogService(core);

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
    const svc = new ModelCatalogService(core);

    await expect(svc.setDefaultModel('missing')).rejects.toBeInstanceOf(
      ModelNotFoundError,
    );
  });

  it('removes an existing provider through core RPC', async () => {
    const configRef = { current: catalogConfig() };
    const { core, removeCalls } = makeCore(configRef);
    const svc = new ModelCatalogService(core);

    await expect(svc.removeProvider('pythinker')).resolves.toBeUndefined();
    expect(removeCalls).toEqual(['pythinker']);
    await expect(svc.removeProvider('missing')).rejects.toBeInstanceOf(
      ProviderNotFoundError,
    );
    expect(removeCalls).toEqual(['pythinker']);
  });

});
