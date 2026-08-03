import { describe, expect, it } from 'vitest';

import {
  catalogBaseUrl,
  catalogConnectionWire,
  catalogModelToCapability,
  catalogProviderModels,
  inferWireType,
  type CatalogModelEntry,
} from '../src/catalog';

describe('catalogConnectionWire', () => {
  it.each([
    [
      'deepseek',
      '@ai-sdk/openai-compatible',
      'https://api.deepseek.com',
      'openai',
      'https://api.deepseek.com',
    ],
    [
      'zai-coding-plan',
      '@ai-sdk/openai-compatible',
      'https://api.z.ai/api/coding/paas/v4',
      'openai',
      'https://api.z.ai/api/coding/paas/v4',
    ],
    [
      'minimax-coding-plan',
      '@ai-sdk/anthropic',
      'https://api.minimax.io/anthropic/v1',
      'anthropic',
      'https://api.minimax.io/anthropic',
    ],
    [
      'kimi-for-coding',
      '@ai-sdk/anthropic',
      'https://api.kimi.com/coding/v1',
      'anthropic',
      'https://api.kimi.com/coding',
    ],
  ] as const)('maps %s onto the shared %s adapter', (id, npm, api, wire, baseUrl) => {
    const entry = { id, npm, api };
    expect(catalogConnectionWire(entry)).toBe(wire);
    expect(catalogBaseUrl(entry, wire)).toBe(baseUrl);
  });

  it('accepts a credential-free Google transport this runtime can configure', () => {
    expect(catalogConnectionWire({ id: 'google', npm: '@ai-sdk/google' })).toBe(
      'google-genai',
    );
  });

  it('rejects providers that require missing account fields or a different transport', () => {
    expect(
      catalogConnectionWire({
        id: 'snowflake-cortex',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/v1',
      }),
    ).toBeUndefined();
    expect(
      catalogConnectionWire({
        id: 'bailing',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.example.test/v1/chat/completions',
      }),
    ).toBeUndefined();
    expect(
      catalogConnectionWire({
        id: 'google-vertex-anthropic',
        npm: '@ai-sdk/google-vertex/anthropic',
      }),
    ).toBeUndefined();
  });
});

describe('inferWireType', () => {
  it('honors an explicit valid type', () => {
    expect(inferWireType({ id: 'x', type: 'openai_responses' })).toBe('openai_responses');
  });

  it('infers anthropic from npm or id', () => {
    expect(inferWireType({ id: 'anthropic', npm: '@ai-sdk/anthropic' })).toBe('anthropic');
    expect(inferWireType({ id: 'my-claude' })).toBe('anthropic');
  });

  it('infers google-genai and vertexai', () => {
    expect(inferWireType({ id: 'gemini', npm: '@ai-sdk/google' })).toBe('google-genai');
    expect(inferWireType({ id: 'google-vertex' })).toBe('vertexai');
  });

  it('returns undefined for unknown / invalid wire types', () => {
    expect(inferWireType({ id: 'some-proxy' })).toBeUndefined();
    expect(inferWireType({ id: 'x', type: 'not-a-wire' })).toBeUndefined();
  });
});

describe('catalogBaseUrl', () => {
  it('strips a trailing /v1 for anthropic so the official SDK does not double it', () => {
    expect(catalogBaseUrl({ id: 'k', api: 'https://api.pythinker.com/coding/v1' }, 'anthropic')).toBe(
      'https://api.pythinker.com/coding',
    );
    expect(catalogBaseUrl({ id: 'k', api: 'https://api.pythinker.com/coding/v1/' }, 'anthropic')).toBe(
      'https://api.pythinker.com/coding',
    );
  });

  it('leaves anthropic base URLs without a bare /v1 suffix untouched', () => {
    expect(catalogBaseUrl({ id: 'a', api: 'https://api.anthropic.com' }, 'anthropic')).toBe(
      'https://api.anthropic.com',
    );
    expect(catalogBaseUrl({ id: 'a', api: 'https://host/v1beta' }, 'anthropic')).toBe(
      'https://host/v1beta',
    );
  });

  it('passes openai-family base URLs through unchanged (SDK appends /chat/completions)', () => {
    expect(catalogBaseUrl({ id: 'o', api: 'https://api.openai.com/v1' }, 'openai')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('returns undefined for a missing or empty api', () => {
    expect(catalogBaseUrl({ id: 'x' }, 'anthropic')).toBeUndefined();
    expect(catalogBaseUrl({ id: 'x', api: '' }, 'openai')).toBeUndefined();
  });
});

describe('catalogModelToCapability', () => {
  it('maps modalities and limits into a ModelCapability', () => {
    expect(
      catalogModelToCapability({
        id: 'm',
        name: 'M',
        limit: { context: 200000, output: 64000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      }),
    ).toEqual({
      id: 'm',
      name: 'M',
      maxOutputSize: 64000,
      capability: {
        image_in: true,
        video_in: false,
        audio_in: false,
        thinking: true,
        tool_use: true,
        max_context_tokens: 200000,
      },
    });
  });

  it('defaults tool_use to true and skips models without a positive context', () => {
    expect(catalogModelToCapability({ id: 'm', limit: { context: 1000 } })?.capability.tool_use).toBe(
      true,
    );
    expect(catalogModelToCapability({ id: 'm' })).toBeUndefined();
    expect(catalogModelToCapability({ id: 'm', limit: { context: 0 } })).toBeUndefined();
  });

  it('skips embedding and non-text-output models that cannot serve as chat defaults', () => {
    expect(
      catalogModelToCapability({
        id: 'text-embedding-3-large',
        name: 'text-embedding-3-large',
        family: 'text-embedding',
        limit: { context: 8192, output: 1536 },
        modalities: { input: ['text'], output: ['text'] },
      }),
    ).toBeUndefined();
    expect(
      catalogModelToCapability({
        id: 'grok-imagine-image',
        name: 'Grok Imagine Image',
        family: 'grok',
        limit: { context: 8000 },
        modalities: { input: ['text', 'image'], output: ['image', 'pdf'] },
      }),
    ).toBeUndefined();
    expect(
      catalogModelToCapability({
        id: 'mimo-v2-tts',
        name: 'MiMo-V2-TTS',
        family: 'mimo',
        limit: { context: 8192, output: 16384 },
        modalities: { input: ['text'], output: ['audio'] },
      }),
    ).toBeUndefined();
  });

  it.each<[CatalogModelEntry['interleaved'], string | undefined]>([
    [undefined, undefined],
    [true, 'reasoning_content'],
    [false, undefined],
    [{}, undefined],
    [{ field: '' }, undefined],
    [{ field: 'reasoning_content' }, 'reasoning_content'],
    [{ field: 'reasoning_details' }, 'reasoning_details'],
    [{ field: '  reasoning_content  ' }, 'reasoning_content'],
  ])('derives reasoningKey from interleaved=%j → %j', (interleaved, expected) => {
    const model = catalogModelToCapability({ id: 'm', limit: { context: 1000 }, interleaved });
    expect(model?.reasoningKey).toBe(expected);
  });
});

describe('catalogProviderModels', () => {
  it('extracts only valid models from a provider entry', () => {
    const models = catalogProviderModels({
      id: 'p',
      models: {
        good: { id: 'good', limit: { context: 1000 } },
        bad: { id: 'bad' },
      },
    });
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe('good');
  });

  it('uses exact catalog effort levels instead of guessed defaults', () => {
    const [model] = catalogProviderModels({
      id: 'deepseek',
      npm: '@ai-sdk/openai-compatible',
      models: {
        v4: {
          id: 'deepseek-v4-pro',
          limit: { context: 1_000_000, output: 384_000 },
          reasoning: true,
          reasoning_options: [
            { type: 'toggle' },
            { type: 'effort', values: ['high', 'max'] },
          ],
        },
      },
    });

    expect(model).toMatchObject({
      supportEfforts: ['high', 'max'],
      alwaysThinking: true,
    });
  });

  it('maps native none to off-capable metadata and preserves minimal', () => {
    const [model] = catalogProviderModels({
      id: 'proxy',
      npm: '@ai-sdk/openai-compatible',
      models: {
        m: {
          id: 'm',
          limit: { context: 1000 },
          reasoning: true,
          reasoning_options: [
            { type: 'effort', values: [null, 'minimal', 'high', 'unsupported'] },
          ],
        },
      },
    });

    expect(model).toMatchObject({
      supportEfforts: ['none', 'minimal', 'high'],
      alwaysThinking: false,
    });
  });

  it('distinguishes fixed reasoning from legacy missing metadata', () => {
    const models = catalogProviderModels({
      id: 'minimax',
      npm: '@ai-sdk/anthropic',
      models: {
        fixed: {
          id: 'fixed',
          limit: { context: 1000 },
          reasoning: true,
          reasoning_options: [],
        },
        legacy: {
          id: 'legacy',
          limit: { context: 1000 },
          reasoning: true,
        },
        toggle: {
          id: 'toggle',
          limit: { context: 1000 },
          reasoning: true,
          reasoning_options: [{ type: 'toggle' }],
        },
        budget: {
          id: 'budget',
          limit: { context: 1000 },
          reasoning: true,
          reasoning_options: [{ type: 'budget_tokens', min: 1024, max: 32_000 }],
        },
      },
    });

    expect(models.find((model) => model.id === 'fixed')).toMatchObject({
      supportEfforts: [],
      alwaysThinking: true,
    });
    expect(models.find((model) => model.id === 'legacy')).toMatchObject({
      supportEfforts: undefined,
      alwaysThinking: undefined,
    });
    expect(models.find((model) => model.id === 'toggle')).toMatchObject({
      supportEfforts: ['none', 'high'],
      alwaysThinking: false,
      adaptiveThinking: true,
    });
    expect(models.find((model) => model.id === 'budget')).toMatchObject({
      supportEfforts: ['high', 'max'],
      alwaysThinking: true,
      adaptiveThinking: false,
      thinkingBudgets: { high: 16_000, max: 31_999 },
    });
  });

  it('ignores malformed remote reasoning metadata', () => {
    const [model] = catalogProviderModels({
      id: 'proxy',
      npm: '@ai-sdk/openai-compatible',
      models: {
        m: {
          id: 'm',
          limit: { context: 1000 },
          reasoning: true,
          reasoning_options: {} as never,
        },
      },
    });

    expect(model).toMatchObject({ supportEfforts: undefined, alwaysThinking: undefined });
  });
});
