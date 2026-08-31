import { describe, expect, it } from 'vitest';

import { ConfigErrors } from '#/app/config/errors';
import '#/kosong/provider/providers/pythinker/pythinker.contrib';
import '#/kosong/provider/providers/standard.contrib';
import type { ProviderConfig } from '#/kosong/provider/provider';
import type { ModelRecord } from '#/kosong/model/model';
import {
  deriveProviderId,
  effectiveModelConfig,
  resolveModelAuthMaterial,
  resolveModelForReady,
} from '#/kosong/model/modelAuth';

function authMaterial(args: {
  model: ModelRecord;
  provider?: ProviderConfig;
}): ReturnType<typeof resolveModelAuthMaterial> {
  return resolveModelAuthMaterial({
    modelId: 'm1',
    model: args.model,
    provider: args.provider,
    providerName: 'p1',
  });
}

describe('resolveModelAuthMaterial', () => {
  it('prefers the model inline credentials over everything else', () => {
    expect(
      authMaterial({
        model: { model: 'm', apiKey: 'model-key' },
        provider: { type: 'openai', apiKey: 'provider-key' },
      }),
    ).toEqual({ apiKey: 'model-key' });
    expect(
      authMaterial({
        model: { model: 'm', oauth: { storage: 'file', key: 'k' }, providerId: 'p1' },
        provider: { type: 'openai', apiKey: 'provider-key' },
      }),
    ).toEqual({ oauth: { storage: 'file', key: 'k' }, oauthProviderKey: 'p1' });
  });

  it('rejects apiKey+oauth on the same level as config.invalid', () => {
    expect(() =>
      authMaterial({ model: { model: 'm', apiKey: 'k', oauth: { storage: 'file', key: 'k' } } }),
    ).toThrowError(expect.objectContaining({ code: ConfigErrors.codes.CONFIG_INVALID }));
    expect(() =>
      authMaterial({
        model: { model: 'm' },
        provider: { type: 'openai', apiKey: 'k', oauth: { storage: 'file', key: 'k' } },
      }),
    ).toThrowError(expect.objectContaining({ code: ConfigErrors.codes.CONFIG_INVALID }));
  });

  it('reads env-bag credentials through the vendor endpoint declarations', () => {
    expect(
      authMaterial({
        model: { model: 'm' },
        provider: { type: 'pythinker', env: { PYTHINKER_API_KEY: 'pythinker-env-key' } },
      }),
    ).toEqual({ apiKey: 'pythinker-env-key' });
    expect(
      authMaterial({
        model: { model: 'm' },
        provider: { type: 'anthropic', env: { ANTHROPIC_API_KEY: 'anthropic-env-key' } },
      }),
    ).toEqual({ apiKey: 'anthropic-env-key' });
    expect(
      authMaterial({
        model: { model: 'm' },
        provider: { type: 'openai', env: { OPENAI_API_KEY: 'openai-env-key' } },
      }),
    ).toEqual({ apiKey: 'openai-env-key' });
    expect(
      authMaterial({
        model: { model: 'm' },
        provider: { type: 'google-genai', env: { GOOGLE_API_KEY: 'google-env-key' } },
      }),
    ).toEqual({ apiKey: 'google-env-key' });
    expect(
      authMaterial({
        model: { model: 'm' },
        provider: {
          type: 'google-genai',
          env: { VERTEXAI_API_KEY: 'vertex-env-key', GOOGLE_API_KEY: 'google-env-key' },
        },
      }),
    ).toEqual({ apiKey: 'vertex-env-key' });
  });

  it('returns empty material when nothing is configured', () => {
    expect(authMaterial({ model: { model: 'm' }, provider: { type: 'openai' } })).toEqual({});
    expect(authMaterial({ model: { model: 'm' } })).toEqual({});
  });
});

describe('effectiveModelConfig', () => {
  it('applies overrides over the base record', () => {
    const effective = effectiveModelConfig({
      model: 'm',
      maxOutputSize: 8192,
      overrides: { maxOutputSize: 4096, displayName: 'M' },
    });
    expect(effective.maxOutputSize).toBe(4096);
    expect(effective.displayName).toBe('M');
  });

  it('drops a defaultEffort the override effort list does not contain', () => {
    const effective = effectiveModelConfig({
      model: 'm',
      supportEfforts: ['low', 'high'],
      defaultEffort: 'high',
      overrides: { supportEfforts: ['low'] },
    });
    expect(effective.supportEfforts).toEqual(['low']);
    expect(effective.defaultEffort).toBeUndefined();
  });

  it('infers the Anthropic profile for non-trait-driven vendors only', () => {
    const record: ModelRecord = { model: 'claude-sonnet-4-5', protocol: 'anthropic' };
    const inferred = effectiveModelConfig(record, 'anthropic');
    expect(inferred.supportEfforts).toEqual(['low', 'medium', 'high']);
    expect(inferred.defaultEffort).toBe('high');
    expect(inferred.capabilities).toContain('thinking');

    const pythinkerRouted = effectiveModelConfig({ model: 'kimi-k2', protocol: 'anthropic' }, 'pythinker');
    expect(pythinkerRouted.supportEfforts).toBeUndefined();
    expect(pythinkerRouted.capabilities).toBeUndefined();
  });
});

describe('deriveProviderId', () => {
  it('keys flat providers by the baseUrl origin', () => {
    expect(deriveProviderId('https://api.example.test/v1')).toBe('api.example.test');
    expect(deriveProviderId('not-a-url')).toBe('not-a-url');
  });
});

describe('resolveModelForReady', () => {
  const providers: Readonly<Record<string, ProviderConfig>> = {
    api: { type: 'openai', apiKey: 'sk-example' },
  };

  it('rejects an absent, blank, or dangling default model', () => {
    expect(resolveModelForReady(undefined, {}, providers)).toEqual({
      resolved: false,
      reason: 'no-default',
    });
    expect(resolveModelForReady(' ', {}, providers)).toEqual({
      resolved: false,
      reason: 'no-default',
    });
    expect(resolveModelForReady('gone', {}, providers)).toEqual({
      resolved: false,
      reason: 'dangling-alias',
    });
  });

  it('resolves an explicit or default provider', () => {
    const explicit = { m: { provider: 'api', model: 'gpt', maxContextSize: 4096 } };
    const inherited = { m: { model: 'gpt', maxContextSize: 4096 } };
    expect(resolveModelForReady('m', explicit, providers)).toEqual({ resolved: true });
    expect(resolveModelForReady('m', inherited, providers, 'api')).toEqual({ resolved: true });
  });

  it('reports a missing explicit or default provider', () => {
    expect(
      resolveModelForReady(
        'm',
        { m: { provider: 'gone', model: 'gpt', maxContextSize: 4096 } },
        providers,
      ),
    ).toEqual({ resolved: false, reason: 'provider-missing' });
    expect(
      resolveModelForReady(
        'm',
        { m: { model: 'gpt', maxContextSize: 4096 } },
        providers,
        'gone',
      ),
    ).toEqual({ resolved: false, reason: 'provider-missing' });
  });

  it('resolves a providerless flat model', () => {
    expect(
      resolveModelForReady(
        'flat',
        {
          flat: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt',
            protocol: 'openai',
            maxContextSize: 4096,
          },
        },
        {},
      ),
    ).toEqual({ resolved: true });
  });

  it('requires a wire name, positive context size, and protocol', () => {
    expect(resolveModelForReady('m', { m: { provider: 'api', maxContextSize: 4096 } }, providers))
      .toEqual({ resolved: false, reason: 'unresolvable' });
    expect(resolveModelForReady('m', { m: { provider: 'api', model: 'gpt' } }, providers))
      .toEqual({ resolved: false, reason: 'unresolvable' });
    expect(
      resolveModelForReady(
        'm',
        {
          m: {
            baseUrl: 'https://api.example.test/v1',
            model: 'gpt',
            maxContextSize: 4096,
          },
        },
        {},
      ),
    ).toEqual({ resolved: false, reason: 'unresolvable' });
  });
});
