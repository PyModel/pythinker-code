import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScopedTestHost } from '#/_base/di/test';
import { isError2 } from '#/_base/errors/errors';
import { ILogService, type LogPayload } from '#/_base/log/log';
import { IAgentIdentity } from '#/app/agentIdentity/agentIdentity';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import {
  LegacySecondaryModelConfigSchema,
  normalizeLegacySecondaryModel,
  toPersistedSecondaryModel,
} from '#/session/subagent/policy';
import {
  ISubagentModelPolicyService,
  type PreparedSubagentPolicyMutation,
} from '#/session/subagent/subagentModelPolicy';
import { ConfigRegistry } from '#/app/config/configService';
import { IEventService } from '#/app/event/event';
import { IProviderDiscoveryService } from '#/app/kosongConfig/discovery';
import '#/app/kosongConfig/discoveryService';
import { MODEL_CATALOG_SECTION } from '#/app/kosongConfig/configSection';
import { IKosongConfigService } from '#/app/kosongConfig/kosongConfig';
import '#/app/kosongConfig/kosongConfigService';
import '#/kosong/model/errors';
import {
  IModelService,
  type ModelRecord,
} from '#/kosong/model/model';
import '#/kosong/model/modelService';
import {
  IProviderService,
  type ProviderConfig,
} from '#/kosong/provider/provider';
import '#/kosong/provider/providerService';
import '#/kosong/provider/providers/pythinker/pythinker.contrib';
import '#/kosong/provider/providers/standard.contrib';

import { StubConfigService } from '../../kosong/stubs';
import { stubBootstrap } from '../bootstrap/stubs';
import { stubAgentIdentity } from '../agentIdentity/stubs';

function stubEvents(): IEventService & { published: Array<{ type: string; payload: unknown }> } {
  const published: Array<{ type: string; payload: unknown }> = [];
  return {
    published,
    _serviceBrand: undefined,
    onDidPublish: () => ({ dispose: () => {} }),
    publish: (event: { type: string; payload: unknown }) => {
      published.push(event);
    },
    subscribe: () => ({ dispose: () => {} }),
  } as unknown as IEventService & { published: Array<{ type: string; payload: unknown }> };
}

function stubLogService(): ILogService {
  return {
    _serviceBrand: undefined,
    level: 'debug',
    setLevel: () => {},
    flush: async () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    child: () => {
      throw new Error('child loggers are not used by KosongConfigService');
    },
  } satisfies ILogService;
}

function stubSubagentModelPolicy(): ISubagentModelPolicyService {
  const prepare = (input: unknown): PreparedSubagentPolicyMutation => {
    const policy = normalizeLegacySecondaryModel(
      input === null || input === undefined ? undefined : LegacySecondaryModelConfigSchema.parse(input),
    );
    return { policy, section: toPersistedSecondaryModel(policy) };
  };
  return {
    _serviceBrand: undefined,
    get: () => ({ policy: { mode: 'inherit' }, resourceVersion: 'stub' }),
    getEffective: () => ({
      configuredPolicy: { mode: 'inherit' },
      effectivePolicy: { mode: 'inherit' },
      policySource: 'default',
      feature: { enabled: false, source: 'default' },
    }),
    set: () => Promise.reject(new Error('not stubbed')),
    clear: () => Promise.reject(new Error('not stubbed')),
    prepareLegacyMutation: prepare,
    resolveRevision: () => 'stub',
  };
}

async function createHost(
  sections: Record<string, unknown> = {},
): Promise<{
  host: ReturnType<typeof createScopedTestHost>;
  config: StubConfigService;
  events: ReturnType<typeof stubEvents>;
  discovery: IProviderDiscoveryService;
  providers: IProviderService;
  models: IModelService;
}> {
  const config = new StubConfigService(sections);
  const events = stubEvents();
  const host = createScopedTestHost([
    [IConfigService, config],
    [IEventService, events],
    [ISubagentModelPolicyService, stubSubagentModelPolicy()],
    [ILogService, stubLogService()],
    [
      IBootstrapService,
      stubBootstrap('/tmp/pythinker-home', {}, { requestHeaders: { 'User-Agent': 'pythinker-test/1.0' } }),
    ],
    [
      IAgentIdentity,
      stubAgentIdentity({ hostRequestHeaders: { 'User-Agent': 'pythinker-test/1.0' } }),
    ],
  ]);
  const providers = host.app.accessor.get(IProviderService);
  const models = host.app.accessor.get(IModelService);
  const bridge = host.app.accessor.get(IKosongConfigService);
  await bridge.ready;
  return {
    host,
    config,
    events,
    discovery: host.app.accessor.get(IProviderDiscoveryService),
    providers,
    models,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const staticProviders: Record<string, ProviderConfig> = {
  'static-p': { type: 'openai', modelSource: 'static', apiKey: 'sk-static' },
};

const staticModels: Record<string, ModelRecord> = {
  s1: { provider: 'static-p', model: 'static-model', maxContextSize: 1000 },
};

const staticSections: Record<string, unknown> = {
  providers: staticProviders,
  models: staticModels,
  defaultModel: 's1',
};

describe('refreshProviderModels modelSource short-circuit', () => {
  it('answers scoped refreshes of static providers with unchanged and no I/O', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { host, discovery } = await createHost(staticSections);
    try {
      const result = await discovery.refreshProviderModels({ providerId: 'static-p' });
      expect(result).toEqual({ changed: [], unchanged: ['static-p'], failed: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      host.dispose();
    }
  });

  it('returns an empty result when nothing is refreshable', async () => {
    const { host, discovery, events } = await createHost(staticSections);
    try {
      const result = await discovery.refreshProviderModels();
      expect(result).toEqual({ changed: [], unchanged: [], failed: [] });
      expect(events.published).toEqual([]);
    } finally {
      host.dispose();
    }
  });

  it('hides static entries from the orchestrator and merges them back verbatim', async () => {
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
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { host, config, discovery, events, providers, models } = await createHost({
      providers: {
        ...staticProviders,
        acme: {
          type: 'openai',
          apiKey: 'sk-acme',
          source: { kind: 'apiJson', url: 'https://registry.example.test/api.json', apiKey: 'sk-registry' },
        },
      },
      models: staticModels,
      defaultModel: 's1',
      thinking: { enabled: true },
    });
    try {
      const result = await discovery.refreshProviderModels();
      expect(result.changed).toEqual([
        { provider_id: 'acme', provider_name: 'Acme', added: 1, removed: 0 },
      ]);
      expect(result.unchanged).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(events.published).toEqual([
        expect.objectContaining({ type: 'event.model_catalog.changed' }),
      ]);

      const providerRecords = providers.list();
      expect(Object.keys(providerRecords).toSorted()).toEqual(['acme', 'static-p']);
      expect(providerRecords['static-p']).toEqual({ type: 'openai', modelSource: 'static', apiKey: 'sk-static' });
      const modelRecords = models.list();
      expect(modelRecords['s1']).toEqual({ provider: 'static-p', model: 'static-model', maxContextSize: 1000 });
      expect(modelRecords['acme/m1']).toBeDefined();
      expect(config.get<string>('defaultModel')).toBe('s1');
      expect(config.get('thinking')).toEqual({ enabled: true });
    } finally {
      host.dispose();
    }
  });

  it('throws provider.not_found for an unknown scoped provider', async () => {
    const { host, discovery } = await createHost(staticSections);
    try {
      await expect(discovery.refreshProviderModels({ providerId: 'missing' })).rejects.toSatisfy(
        (error) => isError2(error) && error.code === 'provider.not_found',
      );
    } finally {
      host.dispose();
    }
  });
});

describe('refreshProviderModels write behavior', () => {
  it('serializes concurrent runs so they never overlap', async () => {
    const { host, discovery } = await createHost({
      providers: {
        acme: {
          type: 'openai',
          source: {
            kind: 'apiJson',
            url: 'https://registry.example.test/api.json',
            apiKey: 'registry-key',
          },
        },
      },
      models: {},
    });
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        return new Response(
          JSON.stringify({
            acme: {
              id: 'acme',
              name: 'Acme',
              api: 'https://acme.example.test/v1',
              type: 'openai',
              models: { m1: { id: 'm1', name: 'M1' } },
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      await Promise.all([
        discovery.refreshProviderModels(),
        discovery.refreshProviderModels(),
      ]);

      expect(maxInFlight).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      host.dispose();
    }
  });

  it('sends the host User-Agent on custom-registry fetches', async () => {
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
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { host, discovery } = await createHost({
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
    });
    try {
      await discovery.refreshProviderModels();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.example.test/api.json',
        expect.objectContaining({
          headers: expect.objectContaining({ 'User-Agent': 'pythinker-test/1.0' }),
        }),
      );
    } finally {
      host.dispose();
    }
  });

  it('persists refresh atomically and preserves aliases referenced by secondary_model', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            acme: {
              id: 'acme',
              name: 'Acme',
              api: 'https://acme.example.test/v1',
              type: 'openai',
              models: { m2: { id: 'm2', name: 'M2' } },
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { host, config, discovery, providers, models } = await createHost({
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
      models: {
        'acme/m1': { provider: 'acme', model: 'm1', maxContextSize: 1000 },
        'acme/old-default': {
          provider: 'acme',
          model: 'old-default',
          maxContextSize: 1000,
        },
      },
      defaultModel: 'acme/old-default',
      secondaryModel: {
        defaultModel: 'acme/m1',
        models: { 'acme/m1': 'fast' },
      },
    });
    try {
      let seenDuringWrite: { providers: readonly string[]; models: readonly string[] } | undefined;
      const originalReplaceSections = config.replaceSections.bind(config);
      vi.spyOn(config, 'replaceSections').mockImplementation(async (sections) => {
        seenDuringWrite = {
          providers: Object.keys(providers.list()),
          models: Object.keys(models.list()),
        };
        await originalReplaceSections(sections);
      });

      const result = await discovery.refreshProviderModels();

      expect(result.failed).toEqual([]);
      expect(seenDuringWrite).toEqual({
        providers: ['acme'],
        models: ['acme/m1', 'acme/old-default'],
      });
      expect(vi.mocked(config.replaceSections).mock.calls.length).toBe(1);
      expect(providers.list()['acme']).toBeDefined();
      expect(models.list()['acme/m2']).toBeDefined();
      expect(models.list()['acme/m1']).toBeDefined();
      expect(config.get('secondaryModel')).toEqual({
        defaultModel: 'acme/m1',
        models: { 'acme/m1': 'fast' },
      });
      expect(config.get('defaultModel')).toBeUndefined();
    } finally {
      host.dispose();
    }
  });
});

describe('modelCatalog config section', () => {
  it('self-registers and validates', () => {
    const registry = new ConfigRegistry();
    expect(registry.getSection(MODEL_CATALOG_SECTION)).toBeDefined();
    expect(
      registry.validate(MODEL_CATALOG_SECTION, {
        refreshIntervalMs: 1000,
        refreshOnStart: false,
      }),
    ).toEqual({ refreshIntervalMs: 1000, refreshOnStart: false });
    expect(() => registry.validate(MODEL_CATALOG_SECTION, { refreshIntervalMs: -1 })).toThrow();
  });
});
