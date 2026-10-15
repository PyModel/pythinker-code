import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PythinkerConfigShape } from '../src/provider-config';
import { refreshProviderModels } from '../src/refreshProviderModels';

type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function makeRefreshHost(initial: PythinkerConfigShape): {
  current: () => PythinkerConfigShape;
  removeProvider: ReturnType<typeof vi.fn<(providerId: string) => Promise<PythinkerConfigShape>>>;
  setConfig: ReturnType<typeof vi.fn<(patch: Partial<PythinkerConfigShape>) => Promise<PythinkerConfigShape>>>;
} {
  let persisted = structuredClone(initial);
  const removeProvider = vi.fn(async (providerId: string) => {
    const providers = { ...persisted.providers };
    delete providers[providerId];
    const models = { ...persisted.models };
    let defaultRemoved = false;
    for (const [alias, model] of Object.entries(models)) {
      if (model.provider !== providerId) continue;
      delete models[alias];
      if (persisted.defaultModel === alias) defaultRemoved = true;
    }
    persisted = { ...persisted, providers, models };
    if (defaultRemoved) persisted = { ...persisted, defaultModel: undefined };
    return structuredClone(persisted);
  });
  const setConfig = vi.fn(async (patch: Partial<PythinkerConfigShape>) => {
    persisted = { ...persisted, ...patch };
    return structuredClone(persisted);
  });
  return {
    current: () => structuredClone(persisted),
    removeProvider,
    setConfig,
  };
}

describe('refreshProviderModels', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('when the registry drops the default model', () => {
    const registryUrl = 'https://registry.example.test/v1/models/api.json';
    const providerId = 'example_chat-completions';
    const legacyAlias = `${providerId}/legacy`;
    const nextAlias = `${providerId}/next`;

    async function refreshWithRegistryModels(models: Record<string, unknown>) {
      const host = makeRefreshHost({
        providers: {
          [providerId]: {
            type: 'openai',
            baseUrl: 'https://api.example.test/v1',
            apiKey: 'sk-test-token',
            source: { kind: 'apiJson', url: registryUrl, apiKey: 'sk-test-token' },
          },
        },
        models: {
          [legacyAlias]: {
            provider: providerId,
            model: 'legacy',
            maxContextSize: 131072,
            upgrade: { model: nextAlias, migrationMarkdown: 'Use next' },
          },
          [nextAlias]: { provider: providerId, model: 'next', maxContextSize: 131072 },
        },
        defaultModel: legacyAlias,
        thinking: { enabled: true, effort: 'low' },
      } as unknown as PythinkerConfigShape);
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchMock>(async () => {
          return new Response(
            JSON.stringify({
              [providerId]: {
                id: providerId,
                name: 'Example',
                api: 'https://api.example.test/v1',
                type: 'openai',
                models,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }),
      );
      const result = await refreshProviderModels({
        getConfig: async () => host.current(),
        removeProvider: host.removeProvider,
        setConfig: host.setConfig,
      });
      return { host, result };
    }

    it('moves the default to the upgrade target the dropped model declared, keeping thinking', async () => {
      const { host, result } = await refreshWithRegistryModels({ next: { id: 'next' } });

      expect(result.retiredDefault).toEqual({
        from: legacyAlias,
        to: nextAlias,
        fromModel: expect.objectContaining({ model: 'legacy' }),
      });
      expect(host.current().models?.[legacyAlias]).toBeUndefined();
      expect(host.current().defaultModel).toBe(nextAlias);
      expect(host.current().thinking).toEqual({ enabled: true, effort: 'low' });
    });

    it('clears the default when the declared target is gone too', async () => {
      const { host, result } = await refreshWithRegistryModels({ other: { id: 'other' } });

      expect(result.retiredDefault).toBeUndefined();
      expect(host.current().defaultModel).toBeUndefined();
      expect(host.current().thinking).toBeUndefined();
    });
  });
});
