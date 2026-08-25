import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelAlias, PythinkerConfigShape } from '../src/provider-config';
import {
  fetchModelsDevCatalog,
  MODELS_DEV_CATALOG_URL,
  modelsDevProviderAliases,
  parseModelsDevSource,
} from '../src/models-dev-catalog';
import { refreshProviderModels, type RefreshProviderHost } from '../src/refreshProviderModels';

const PROVIDER_ID = 'opencode-go';
const PROVIDER_SOURCE = { kind: 'modelsDev', url: MODELS_DEV_CATALOG_URL };

function makeProviderRecord() {
  return {
    type: 'openai',
    baseUrl: 'https://opencode.example.test/zen/go/v1',
    apiKey: 'sk-opencode-test',
    source: { ...PROVIDER_SOURCE },
  } satisfies Record<string, unknown>;
}

/**
 * Base state mirrors a real import snapshot: upstream-seeded aliases only
 * (ox-alpha has not been imported yet) plus one bare-keyed user alias that
 * refreshes must preserve.
 */
function makeBaseConfig(): PythinkerConfigShape {
  const doc = makeDocument();
  const entry = doc[PROVIDER_ID] as Record<string, unknown>;
  const upstreamModels = entry['models'] as Record<string, unknown>;
  delete upstreamModels['ox-alpha-free'];
  const seeded = modelsDevProviderAliases(PROVIDER_ID, entry);
  return {
    providers: { [PROVIDER_ID]: makeProviderRecord() },
    models: {
      ...seeded,
      'my-favorite': {
        provider: PROVIDER_ID,
        model: 'gpt-5-x',
        maxContextSize: 400000,
        displayName: 'User-made alias',
      },
    },
    defaultModel: `${PROVIDER_ID}/deepseek-v4-flash`,
    thinking: { enabled: true },
  };
}

function makeDocument(): Record<string, unknown> {
  return {
    [PROVIDER_ID]: {
      id: PROVIDER_ID,
      name: 'OpenCode Go',
      api: 'https://opencode.example.test/zen/go/v1',
      npm: '@ai-sdk/openai',
      models: {
        'deepseek-v4-flash': {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          limit: { context: 1000000, output: 384000 },
          tool_call: true,
          interleaved: { field: 'reasoning_content' },
          modalities: { input: ['text'], output: ['text'] },
        },
        'ox-alpha-free': {
          id: 'ox-alpha-free',
          name: 'Ox Alpha Free (Unlimited)',
          limit: { context: 262144, output: 65536 },
          tool_call: true,
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
          modalities: { input: ['text', 'image', 'video'], output: ['text'] },
        },
      },
    },
    'brand-new-guy': {
      id: 'brand-new-guy',
      name: 'Brand New Guy',
      api: 'https://new.example.test/v1',
      models: { m1: { id: 'm1', name: 'M1', limit: { context: 1000 } } },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface HostCalls {
  requests: string[];
  removeProvider: string[];
  setConfigPatches: PythinkerConfigShape[];
}

function makeHost(initial: PythinkerConfigShape): {
  host: RefreshProviderHost;
  calls: HostCalls;
} {
  let current = structuredClone(initial);
  const calls: HostCalls = { requests: [], removeProvider: [], setConfigPatches: [] };
  const host: RefreshProviderHost = {
    getConfig: async () => structuredClone(current),
    removeProvider: async (providerId) => {
      calls.removeProvider.push(providerId);
      delete current.providers[providerId];
      for (const [key, raw] of Object.entries(current.models ?? {})) {
        if ((raw as ModelAlias).provider === providerId) delete current.models?.[key];
      }
      return structuredClone(current);
    },
    setConfig: async (patch) => {
      calls.setConfigPatches.push(structuredClone(patch));
      if (patch.providers !== undefined) current.providers = structuredClone(patch.providers);
      if (patch.models !== undefined) current.models = structuredClone(patch.models);
      if ('defaultModel' in patch) current.defaultModel = patch.defaultModel;
      if ('thinking' in patch) current.thinking = structuredClone(patch.thinking);
      if ('secondaryModel' in patch) {
        current.secondaryModel = structuredClone(patch.secondaryModel);
      }
      return structuredClone(current);
    },
    userAgent: 'pythinker-code-cli/test',
  };
  return { host, calls };
}

function lastPatch(calls: HostCalls): PythinkerConfigShape {
  const patch = calls.setConfigPatches.at(-1);
  expect(patch).toBeDefined();
  return patch as PythinkerConfigShape;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('refreshProviderModels modelsDev directory providers', () => {
  it('adds an upstream model and preserves user aliases and the provider record', async () => {
    const document = makeDocument();
    const fetchMock = vi.fn(async (input: string, _init?: RequestInit) => {
      calls.requests.push(input);
      return jsonResponse(document);
    });
    vi.stubGlobal('fetch', fetchMock);

    const base = makeBaseConfig();
    const { host, calls } = makeHost(base);
    const result = await refreshProviderModels(host);

    expect(result.failed).toEqual([]);
    expect(result.changed).toEqual([
      { providerId: PROVIDER_ID, providerName: PROVIDER_ID, added: 1, removed: 0 },
    ]);
    expect(result.unchanged).toEqual([]);

    expect(calls.requests).toEqual([MODELS_DEV_CATALOG_URL]);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'User-Agent': 'pythinker-code-cli/test',
    });
    expect(JSON.stringify(init?.headers)).not.toContain('Authorization');

    expect(calls.removeProvider).toEqual([PROVIDER_ID]);
    expect(calls.setConfigPatches).toHaveLength(1);
    const patch = lastPatch(calls);

    expect(Object.keys(patch.models ?? {})).toContain(`${PROVIDER_ID}/ox-alpha-free`);
    const added = patch.models?.[`${PROVIDER_ID}/ox-alpha-free`] as ModelAlias;
    expect(added.model).toBe('ox-alpha-free');
    expect(added.maxContextSize).toBe(262144);
    expect(added.maxOutputSize).toBe(65536);
    expect(added.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(added.displayName).toBe('Ox Alpha Free (Unlimited)');
    expect(added.capabilities).toEqual(['image_in', 'video_in', 'always_thinking', 'tool_use']);
    expect(Object.keys(patch.models ?? {})).toContain(`${PROVIDER_ID}/deepseek-v4-flash`);

    expect(patch.models?.['my-favorite'] as ModelAlias | undefined).toEqual(
      base.models?.['my-favorite'],
    );

    const providerPatch = patch.providers?.[PROVIDER_ID] as Record<string, unknown> | undefined;
    expect(providerPatch).toBeDefined();
    expect(providerPatch).toEqual(makeProviderRecord());

    expect(patch.defaultModel).toBe(`${PROVIDER_ID}/deepseek-v4-flash`);
    expect(patch.thinking).toEqual({ enabled: true });
  });

  it('preserves a generated alias referenced by secondary_model when upstream drops it', async () => {
    const document = makeDocument();
    const entry = document[PROVIDER_ID] as Record<string, unknown>;
    delete (entry['models'] as Record<string, unknown>)['deepseek-v4-flash'];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(document)));

    const base = makeBaseConfig();
    base.defaultModel = undefined;
    base.thinking = undefined;
    base.secondaryModel = {
      defaultModel: `${PROVIDER_ID}/deepseek-v4-flash`,
      models: { [`${PROVIDER_ID}/deepseek-v4-flash`]: 'fast' },
    };
    const { host, calls } = makeHost(base);

    const result = await refreshProviderModels(host);

    expect(result.failed).toEqual([]);
    const patch = lastPatch(calls);
    expect(patch.models?.[`${PROVIDER_ID}/deepseek-v4-flash`]).toEqual(
      base.models?.[`${PROVIDER_ID}/deepseek-v4-flash`],
    );
    expect(patch.secondaryModel).toEqual(base.secondaryModel);
  });

  it('removes a provider that vanished from the directory and clamps the dangling default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ 'brand-new-guy': makeDocument()['brand-new-guy'] })),
    );
    const base = makeBaseConfig();
    base.defaultModel = `${PROVIDER_ID}/deepseek-v4-flash`;
    base.secondaryModel = { defaultModel: `${PROVIDER_ID}/deepseek-v4-flash` };

    const { host, calls } = makeHost(base);
    const result = await refreshProviderModels(host);

    expect(result.changed).toEqual([
      { providerId: PROVIDER_ID, providerName: PROVIDER_ID, added: 0, removed: 2 },
    ]);
    expect(calls.removeProvider).toEqual([PROVIDER_ID]);
    expect(calls.setConfigPatches).toHaveLength(1);
    const patch = lastPatch(calls);
    expect(patch.providers?.[PROVIDER_ID]).toBeUndefined();
    expect(patch.defaultModel).toBeUndefined();
    expect(patch.thinking).toBeUndefined();
    expect(patch.secondaryModel).toEqual(base.secondaryModel);
  });

  it('reports a failure without writing when an entry lists no usable models', async () => {
    const document = makeDocument();
    const entry = document[PROVIDER_ID] as Record<string, unknown>;
    entry['models'] = Object.fromEntries(
      Object.entries(entry['models'] as Record<string, unknown>).map(([key, value]) => [
        key,
        { ...(value as Record<string, unknown>), status: 'deprecated' },
      ]),
    );
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(document)));

    const { host, calls } = makeHost(makeBaseConfig());
    const result = await refreshProviderModels(host);

    expect(result.failed).toEqual([
      { provider: PROVIDER_ID, reason: `models.dev entry ${PROVIDER_ID} lists no usable models` },
    ]);
    expect(result.changed).toEqual([]);
    expect(calls.removeProvider).toEqual([]);
    expect(calls.setConfigPatches).toEqual([]);
  });

  it('never auto-adds directory siblings as configured providers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(makeDocument())));

    const { host, calls } = makeHost(makeBaseConfig());
    await refreshProviderModels(host);

    const patch = lastPatch(calls);
    expect(patch.providers?.['brand-new-guy']).toBeUndefined();
    expect(Object.keys(patch.models ?? {}).some((key) => key.startsWith('brand-new-guy/'))).toBe(false);
  });

  it('is a no-op write when upstream matches local state', async () => {
    const document = makeDocument();
    const entry = document[PROVIDER_ID] as Record<string, unknown>;
    const upstreamModels = entry['models'] as Record<string, unknown>;
    delete upstreamModels['ox-alpha-free'];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(document)));

    const { host, calls } = makeHost(makeBaseConfig());
    const result = await refreshProviderModels(host);

    expect(result.unchanged).toEqual([PROVIDER_ID]);
    expect(result.changed).toEqual([]);
    expect(calls.setConfigPatches).toEqual([]);
    expect(calls.removeProvider).toEqual([]);
  });

  it('scopes a targeted refresh to the requested provider only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(makeDocument())));
    const base = makeBaseConfig();
    base.providers['other-go'] = {
      type: 'openai',
      apiKey: 'sk-other',
      source: { kind: 'modelsDev', url: MODELS_DEV_CATALOG_URL },
    };
    base.models = {
      ...base.models,
      'other-go/m1': { provider: 'other-go', model: 'm1', maxContextSize: 128000 },
    };

    const { host, calls } = makeHost(base);
    const result = await refreshProviderModels(host, { providerId: PROVIDER_ID });

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]?.providerId).toBe(PROVIDER_ID);
    const patch = lastPatch(calls);
    expect(patch.models?.['other-go/m1']).toEqual({
      provider: 'other-go',
      model: 'm1',
      maxContextSize: 128000,
    });
    expect(patch.providers?.['other-go']).toEqual(base.providers['other-go']);
  });

  it('reports upstream fetch failures per provider without touching config', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const { host, calls } = makeHost(makeBaseConfig());
    const result = await refreshProviderModels(host);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.provider).toBe(PROVIDER_ID);
    expect(result.failed[0]?.reason).toContain('503');
    expect(calls.setConfigPatches).toEqual([]);
    expect(calls.removeProvider).toEqual([]);
  });

  it('keeps private apiJson registry behavior intact: siblings are discovered', async () => {
    const registry = {
      acme: {
        id: 'acme',
        name: 'Acme',
        api: 'https://acme.example.test/v1',
        type: 'openai',
        models: { m1: { id: 'm1', name: 'M1' } },
      },
      'acme-new-sibling': {
        id: 'acme-new-sibling',
        name: 'Acme New Sibling',
        api: 'https://acme.example.test/v1',
        type: 'openai',
        models: { s1: { id: 's1', name: 'S1' } },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(registry)));

    const { host, calls } = makeHost({
      providers: {
        acme: {
          type: 'openai',
          apiKey: 'sk-acme',
          source: { kind: 'apiJson', url: 'https://registry.example.test/api.json', apiKey: '' },
        },
      },
      models: {},
    });
    await refreshProviderModels(host);

    expect(calls.setConfigPatches.length).toBeGreaterThan(0);
    expect(lastPatch(calls).providers?.['acme-new-sibling']).toBeDefined();
  });
});

describe('parseModelsDevSource', () => {
  it('accepts modelsDev blobs with or without an apiKey', () => {
    expect(parseModelsDevSource({ kind: 'modelsDev', url: MODELS_DEV_CATALOG_URL })).toEqual({
      url: MODELS_DEV_CATALOG_URL,
    });
    expect(parseModelsDevSource({ kind: 'modelsDev', url: MODELS_DEV_CATALOG_URL, apiKey: 'sk-x' })).toEqual({
      url: MODELS_DEV_CATALOG_URL,
    });
  });

  it('rejects everything else', () => {
    expect(parseModelsDevSource(undefined)).toBeUndefined();
    expect(parseModelsDevSource('nope')).toBeUndefined();
    expect(parseModelsDevSource({ kind: 'apiJson', url: MODELS_DEV_CATALOG_URL })).toBeUndefined();
    expect(parseModelsDevSource({ kind: 'modelsDev' })).toBeUndefined();
    expect(parseModelsDevSource({ kind: 'modelsDev', url: '' })).toBeUndefined();
  });
});

describe('fetchModelsDevCatalog', () => {
  it('sends no Authorization header even when credentials exist on the provider', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse({}));
    await fetchModelsDevCatalog(MODELS_DEV_CATALOG_URL, {
      fetchImpl: fetchMock as unknown as typeof fetch,
      userAgent: 'pythinker-code-cli/test',
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ Accept: 'application/json', 'User-Agent': 'pythinker-code-cli/test' });
  });

  it('rejects non-object payloads loudly', async () => {
    await expect(
      fetchModelsDevCatalog(MODELS_DEV_CATALOG_URL, { fetchImpl: async () => jsonResponse([]) }),
    ).rejects.toThrow('expected a JSON object');
  });
});
