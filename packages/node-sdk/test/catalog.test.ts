import type { PythinkerConfig } from '@pythoughts/agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  applyCatalogProvider,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  importCatalogProvider,
  type CatalogModel,
} from '../src/catalog';

function catalogResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const model: CatalogModel = {
  id: 'm1',
  name: 'M1',
  maxOutputSize: 64000,
  capability: {
    image_in: true,
    video_in: false,
    audio_in: false,
    thinking: true,
    tool_use: true,
    max_context_tokens: 200000,
  },
};

describe('fetchCatalog', () => {
  it('fetches and returns the catalog map', async () => {
    const catalog = { anthropic: { id: 'anthropic', models: { x: { id: 'x', limit: { context: 1000 } } } } };
    const fetchMock = vi.fn(async () => catalogResponse(catalog));
    const result = await fetchCatalog('https://x/api.json', undefined, fetchMock as unknown as typeof fetch);
    expect(result).toEqual(catalog);
  });

  it('throws CatalogFetchError on HTTP error', async () => {
    const fetchMock = vi.fn(async () => catalogResponse('no', 500));
    await expect(
      fetchCatalog('https://x', undefined, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(CatalogFetchError);
  });

  it('throws on a non-object payload', async () => {
    const fetchMock = vi.fn(async () => catalogResponse([1, 2]));
    await expect(
      fetchCatalog('https://x', undefined, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow(/Unexpected catalog response/);
  });
});

describe('catalogModelToAlias', () => {
  it('flattens a catalog model capability into alias fields', () => {
    expect(catalogModelToAlias('anthropic', model)).toEqual({
      provider: 'anthropic',
      model: 'm1',
      maxContextSize: 200000,
      maxOutputSize: 64000,
      capabilities: ['image_in', 'thinking', 'tool_use'],
      displayName: 'M1',
    });
  });

  it('preserves catalog-declared reasoning controls', () => {
    expect(
      catalogModelToAlias('minimax-coding-plan', {
        ...model,
        supportEfforts: ['none', 'minimal', 'high'],
        alwaysThinking: false,
        adaptiveThinking: true,
        thinkingBudgets: { high: 8_000, max: 16_000 },
      }),
    ).toMatchObject({
      provider: 'minimax-coding-plan',
      supportEfforts: ['none', 'minimal', 'high'],
      adaptiveThinking: true,
      thinkingBudgets: { high: 8_000, max: 16_000 },
      capabilities: ['image_in', 'thinking', 'tool_use'],
    });

    expect(
      catalogModelToAlias('minimax-coding-plan', {
        ...model,
        supportEfforts: [],
        alwaysThinking: true,
      }),
    ).toMatchObject({
      supportEfforts: [],
      capabilities: ['image_in', 'thinking', 'tool_use', 'always_thinking'],
    });
  });
});

describe('applyCatalogProvider', () => {
  it('writes a direct API key, model aliases, and defaults', () => {
    const config = { providers: {} } as PythinkerConfig;
    const result = applyCatalogProvider(config, {
      providerId: 'anthropic',
      catalogUrl: DEFAULT_CATALOG_URL,
      wire: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'test-key',
      models: [model],
      selectedModelId: 'm1',
      thinking: true,
    });

    expect(result.defaultModel).toBe('anthropic/m1');
    expect(config.providers['anthropic']).toMatchObject({
      type: 'anthropic',
      apiKey: 'test-key',
      source: { kind: 'modelsDev', url: DEFAULT_CATALOG_URL },
    });
    expect(config.providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
    expect(config.models?.['anthropic/m1']).toMatchObject({
      provider: 'anthropic',
      model: 'm1',
      maxContextSize: 200000,
    });
    expect(config.defaultModel).toBe('anthropic/m1');
    expect(config.defaultThinking).toBe(true);
  });

  it('writes interleaved reasoning key from a catalog-selected model alias', () => {
    const models = catalogProviderModels({
      id: 'deepseek',
      models: {
        'deepseek-v4-pro': {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          family: 'deepseek-thinking',
          limit: { context: 1000000, output: 384000 },
          reasoning: true,
          tool_call: true,
          interleaved: { field: 'reasoning_content' },
        },
      },
    });
    const config = { providers: {} } as PythinkerConfig;

    applyCatalogProvider(config, {
      providerId: 'deepseek',
      catalogUrl: DEFAULT_CATALOG_URL,
      wire: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      models,
      selectedModelId: 'deepseek-v4-pro',
      thinking: true,
    });

    expect(config.providers['deepseek']).toMatchObject({
      type: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      source: { kind: 'modelsDev', url: DEFAULT_CATALOG_URL },
    });
    expect(config.providers['deepseek']?.apiKey).toBeUndefined();
    expect(config.models?.['deepseek/deepseek-v4-pro']).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      reasoningKey: 'reasoning_content',
    });
  });

  it('clears stale aliases for the same provider but keeps others', () => {
    const config = {
      providers: { anthropic: { type: 'anthropic', apiKey: 'old' } },
      models: {
        'anthropic/stale': { provider: 'anthropic', model: 'stale', maxContextSize: 1 },
        'other/keep': { provider: 'other', model: 'keep', maxContextSize: 1 },
      },
    } as unknown as PythinkerConfig;

    applyCatalogProvider(config, {
      providerId: 'anthropic',
      catalogUrl: DEFAULT_CATALOG_URL,
      wire: 'anthropic',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      models: [model],
      selectedModelId: 'm1',
      thinking: false,
    });

    expect(config.models?.['anthropic/stale']).toBeUndefined();
    expect(config.models?.['other/keep']).toBeDefined();
  });
});

describe('importCatalogProvider', () => {
  function createStore(initial: Partial<PythinkerConfig> = {}) {
    let config = { providers: {}, ...initial } as PythinkerConfig;
    const patches: Array<Partial<PythinkerConfig>> = [];
    const removed: string[] = [];
    return {
      patches,
      removed,
      current: () => config,
      store: {
        ensureConfigFile: async () => undefined,
        getConfig: async () => structuredClone(config),
        removeProvider: async (providerId: string) => {
          removed.push(providerId);
          const providers = { ...config.providers };
          delete providers[providerId];
          const models = Object.fromEntries(
            Object.entries(config.models ?? {}).filter(([, alias]) => alias.provider !== providerId),
          );
          // Mirrors the core: a default pointing at the removed provider is cleared.
          config = {
            ...config,
            providers,
            models,
            defaultProvider: config.defaultProvider === providerId ? undefined : config.defaultProvider,
            defaultModel:
              config.defaultModel !== undefined && models[config.defaultModel] === undefined
                ? undefined
                : config.defaultModel,
          } as PythinkerConfig;
          return structuredClone(config);
        },
        setConfig: async (patch: Partial<PythinkerConfig>) => {
          patches.push(patch);
          config = { ...config, ...patch } as PythinkerConfig;
          return structuredClone(config);
        },
      },
    };
  }

  const entry = {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'https://api.anthropic.com',
    npm: '@ai-sdk/anthropic',
    env: ['ANTHROPIC_API_KEY'],
    models: {
      m1: { id: 'm1', name: 'M1', limit: { context: 200000, output: 64000 } },
    },
  } as unknown as Parameters<typeof importCatalogProvider>[1]['entry'];

  it('writes the provider, its aliases, and the requested default model', async () => {
    const rig = createStore();

    const result = await importCatalogProvider(rig.store, {
      providerId: 'anthropic',
      entry,
      apiKey: 'test-key',
      defaultModel: 'm1',
    });

    expect(result.defaultModel).toBe('anthropic/m1');
    expect(rig.current().providers['anthropic']).toMatchObject({ apiKey: 'test-key' });
    expect(rig.current().models?.['anthropic/m1']).toBeDefined();
  });

  it("keeps a default that belongs to another provider when re-importing", async () => {
    const rig = createStore({
      providers: { anthropic: { type: 'anthropic' }, other: { type: 'openai' } },
      models: { 'other/x': { provider: 'other', model: 'x' }, 'anthropic/old': { provider: 'anthropic', model: 'old' } },
      defaultModel: 'other/x',
      defaultProvider: 'other',
      defaultThinking: true,
    } as Partial<PythinkerConfig>);

    await importCatalogProvider(rig.store, { providerId: 'anthropic', entry, apiKey: 'k' });

    expect(rig.removed).toEqual(['anthropic']);
    expect(rig.current().defaultModel).toBe('other/x');
    expect(rig.current().defaultProvider).toBe('other');
    expect(rig.current().defaultThinking).toBe(true);
    expect(rig.current().models?.['anthropic/old']).toBeUndefined();
  });

  it('clears a default the refreshed catalog no longer offers', async () => {
    const rig = createStore({
      providers: { anthropic: { type: 'anthropic' } },
      models: { 'anthropic/gone': { provider: 'anthropic', model: 'gone' } },
      defaultModel: 'anthropic/gone',
    } as Partial<PythinkerConfig>);

    await importCatalogProvider(rig.store, { providerId: 'anthropic', entry, apiKey: 'k' });

    expect(rig.current().defaultModel).toBeUndefined();
  });

  it('rejects an import with neither a key nor an env var', async () => {
    const rig = createStore();
    await expect(
      importCatalogProvider(rig.store, { providerId: 'anthropic', entry }),
    ).rejects.toThrow(/needs an API key/);
  });

  it('rejects a default model the provider does not offer', async () => {
    const rig = createStore();
    await expect(
      importCatalogProvider(rig.store, {
        providerId: 'anthropic',
        entry,
        apiKey: 'k',
        defaultModel: 'nope',
      }),
    ).rejects.toThrow(/is not offered/);
  });
});
