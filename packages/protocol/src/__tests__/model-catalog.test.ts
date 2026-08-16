import { describe, expect, it } from 'vitest';

import {
  getProviderResponseSchema,
  listModelsResponseSchema,
  listProvidersResponseSchema,
  modelCatalogItemSchema,
  providerCatalogItemSchema,
  providerCatalogStatusSchema,
  setDefaultModelResponseSchema,
  type ModelCatalogItem,
  type ProviderCatalogItem,
} from '../index';

describe('model catalog schemas', () => {
  const model: ModelCatalogItem = {
    provider: 'pythinker',
    model: 'k2',
    display_name: 'Pythinker K2',
    max_context_size: 131072,
    capabilities: ['thinking'],
  };

  const modelWithThinking: ModelCatalogItem = {
    ...model,
    support_efforts: ['low', 'high', 'max'],
    adaptive_thinking: true,
  };

  const provider: ProviderCatalogItem = {
    id: 'pythinker',
    type: 'pythinker',
    base_url: 'https://api.example.test/v1',
    default_model: 'k2',
    has_api_key: true,
    status: 'connected',
    models: ['k2'],
  };

  it('round-trips a model catalog item', () => {
    expect(modelCatalogItemSchema.parse(model)).toEqual(model);
  });

  it('round-trips per-model thinking metadata', () => {
    expect(modelCatalogItemSchema.parse(modelWithThinking)).toEqual(modelWithThinking);
  });

  it('accepts model catalog items without thinking metadata', () => {
    expect(modelCatalogItemSchema.parse(model)).toEqual(model);
  });

  it('rejects invalid model context sizes', () => {
    expect(
      modelCatalogItemSchema.safeParse({ ...model, max_context_size: 0 }).success,
    ).toBe(false);
  });

  it.each(['connected', 'error', 'unconfigured'] as const)(
    'accepts provider status %s',
    (status) => {
      expect(providerCatalogStatusSchema.parse(status)).toBe(status);
    },
  );

  it('round-trips a provider catalog item', () => {
    expect(providerCatalogItemSchema.parse(provider)).toEqual(provider);
    expect(getProviderResponseSchema.parse(provider)).toEqual(provider);
  });

  it('round-trips list responses and set-default response', () => {
    expect(listModelsResponseSchema.parse({ items: [model] })).toEqual({
      items: [model],
    });
    expect(listProvidersResponseSchema.parse({ items: [provider] })).toEqual({
      items: [provider],
    });
    expect(
      setDefaultModelResponseSchema.parse({ default_model: 'k2', model }),
    ).toEqual({
      default_model: 'k2',
      model,
    });
  });
});
