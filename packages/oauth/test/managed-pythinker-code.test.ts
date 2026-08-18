import { describe, expect, it, vi } from 'vitest';

import {
  applyManagedPythinkerCodeLogoutConfig,
  applyManagedPythinkerCodeConfig,
  clearManagedPythinkerCodeConfig,
  fetchManagedPythinkerCodeModels,
  PYTHINKER_CODE_OAUTH_KEY,
  PYTHINKER_CODE_PROVIDER_NAME,
  ManagedPythinkerCodeModelsAuthError,
  provisionManagedPythinkerCodeConfig,
  resolvePythinkerCodeLoginAuth,
  resolvePythinkerCodeOAuthKey,
  resolvePythinkerCodeOAuthRef,
  resolvePythinkerCodeRuntimeAuth,
  type ManagedPythinkerConfigShape,
} from '../src/managed-pythinker-code';
import { OAuthUnauthorizedError } from '../src/errors';

function makeModelsResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'kimi-for-coding',
          context_length: 262144,
          supports_reasoning: true,
          supports_image_in: true,
          supports_video_in: true,
          display_name: 'Pythinker for Coding',
        },
        {
          id: 'kimi-k2.5',
          context_length: 250000,
          supports_reasoning: false,
          supports_image_in: false,
          supports_video_in: false,
          supports_tool_use: false,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('provisionManagedPythinkerCodeConfig', () => {
  it('keeps the legacy credential key for the default production environment', () => {
    expect(
      resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.kimi.com/',
        baseUrl: 'https://api.kimi.com/coding/v1/',
      }),
    ).toBe(PYTHINKER_CODE_OAUTH_KEY);
  });

  it('scopes credential keys for non-default OAuth hosts and API base URLs', () => {
    const devKey = resolvePythinkerCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    expect(devKey).not.toBe(PYTHINKER_CODE_OAUTH_KEY);
    expect(devKey).toMatch(/^oauth\/pythinker-code-env-[a-f0-9]{16}$/);
    expect(
      resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test/',
        baseUrl: 'https://api.dev.example.test/coding/v1/',
      }),
    ).toBe(devKey);
  });

  it('derives a full OAuth ref whose key and persisted host stay in sync', () => {
    // Default environment collapses to the legacy ref (no persisted host), so
    // existing production credentials keep resolving to `pythinker-code.json`.
    expect(
      resolvePythinkerCodeOAuthRef({
        oauthHost: 'https://auth.kimi.com/',
        baseUrl: 'https://api.kimi.com/coding/v1/',
      }),
    ).toEqual({ storage: 'file', key: PYTHINKER_CODE_OAUTH_KEY, oauthHost: undefined });

    const defaultAuthCustomApiRef = resolvePythinkerCodeOAuthRef({
      baseUrl: 'https://api.example.test/coding/v1',
    });
    expect(defaultAuthCustomApiRef).toEqual({
      storage: 'file',
      key: resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.kimi.com',
        baseUrl: 'https://api.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.kimi.com',
    });

    // A non-default environment yields a scoped key AND the normalized host,
    // both derived from the same input — login and runtime cannot drift apart.
    const devRef = resolvePythinkerCodeOAuthRef({
      oauthHost: 'https://auth.dev.example.test/',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    expect(devRef).toEqual({
      storage: 'file',
      key: resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl: 'https://api.dev.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('resolves runtime auth from environment overrides over persisted config', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const envBaseUrl = 'https://api.env.example.test/coding/v1/';
    const envOauthHost = 'https://auth.env.example.test/';
    const configuredOAuthRef = resolvePythinkerCodeOAuthRef({
      baseUrl: configuredBaseUrl,
    });

    const auth = resolvePythinkerCodeRuntimeAuth({
      configuredBaseUrl,
      configuredOAuthRef,
      env: {
        PYTHINKER_CODE_BASE_URL: envBaseUrl,
        PYTHINKER_CODE_OAUTH_HOST: envOauthHost,
      },
    });

    expect(auth.baseUrl).toBe('https://api.env.example.test/coding/v1');
    expect(auth.oauthRef).toEqual({
      storage: 'file',
      key: resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.env.example.test',
        baseUrl: 'https://api.env.example.test/coding/v1',
      }),
      oauthHost: 'https://auth.env.example.test',
    });
  });

  it('preserves a matching configured runtime OAuth ref when env is not overridden', () => {
    const baseUrl = 'https://api.dev.example.test/coding/v1';
    const configuredOAuthRef = {
      storage: 'keyring' as const,
      key: resolvePythinkerCodeOAuthKey({
        oauthHost: 'https://auth.dev.example.test',
        baseUrl,
      }),
      oauthHost: 'https://auth.dev.example.test',
    };

    expect(
      resolvePythinkerCodeRuntimeAuth({
        configuredBaseUrl: baseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl,
      oauthRef: configuredOAuthRef,
    });
  });

  it('resolves login auth without reusing persisted refs under explicit or env overrides', () => {
    const configuredBaseUrl = 'https://api.configured.example.test/coding/v1';
    const configuredOAuthRef = resolvePythinkerCodeOAuthRef({ baseUrl: configuredBaseUrl });

    expect(
      resolvePythinkerCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        requestedBaseUrl: 'https://api.requested.example.test/coding/v1/',
        env: {},
      }),
    ).toEqual({
      baseUrl: 'https://api.requested.example.test/coding/v1',
      oauthHost: undefined,
    });

    expect(
      resolvePythinkerCodeLoginAuth({
        configuredBaseUrl,
        configuredOAuthRef,
        env: {},
      }),
    ).toEqual({
      baseUrl: configuredBaseUrl,
      oauthHost: undefined,
      oauthRef: configuredOAuthRef,
    });
  });

  it('writes the managed provider, models, services, and default model through an adapter', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
      },
      models: {
        'pythinker-code/stale': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'stale',
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
        },
      },
    };
    const write = vi.fn();
    const fetchMock = vi.fn(async () => makeModelsResponse());

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
      adapter: {
        configPath: '/tmp/config.toml',
        read: () => config,
        write,
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result).toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      defaultModel: 'pythinker-code/kimi-for-coding',
      defaultThinking: true,
      configPath: '/tmp/config.toml',
    });
    expect(result.models[0]?.supportsToolUse).toBe(true);
    expect(result.models[1]?.supportsToolUse).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.kimi.com/coding/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-access-token',
          Accept: 'application/json',
        }),
      }),
    );
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][];
    const init = calls[0]?.[1] ?? {};
    const headers = new Headers((init.headers ?? {}) as Record<string, string>);
    expect(headers.get('user-agent')).toBeNull();
    expect(headers.get('x-msh-platform')).toBeNull();
    expect(write).toHaveBeenCalledWith(config);

    expect(config.providers['custom']).toMatchObject({
      apiKey: 'sk-existing',
    });
    expect(config.models?.['custom-default']?.provider).toBe('custom');
    expect(config.models?.['pythinker-code/stale']).toBeUndefined();
    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]).toMatchObject({
      type: 'pythinker',
      baseUrl: 'https://api.kimi.com/coding/v1',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/pythinker-code' },
    });
    expect(config.models?.['pythinker-code/kimi-for-coding']).toMatchObject({
      provider: PYTHINKER_CODE_PROVIDER_NAME,
      model: 'kimi-for-coding',
      maxContextSize: 262144,
      capabilities: ['thinking', 'image_in', 'video_in', 'tool_use'],
      displayName: 'Pythinker for Coding',
    });
    expect(config.models?.['pythinker-code/kimi-k2.5']?.capabilities).toBeUndefined();
    expect(config.services?.pymodelSearch).toMatchObject({
      baseUrl: 'https://api.kimi.com/coding/v1/search',
      apiKey: '',
      oauth: { storage: 'file', key: 'oauth/pythinker-code' },
    });
    expect(Object.keys(config.services ?? {})).toEqual(['pymodelSearch', 'pymodelFetch']);
  });

  it('writes scoped OAuth refs when provisioning against a non-default environment', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {},
    };
    const oauthKey = resolvePythinkerCodeOAuthKey({
      oauthHost: 'https://auth.dev.example.test',
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });

    await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauthKey,
      oauthHost: 'https://auth.dev.example.test',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]).toMatchObject({
      baseUrl: 'https://api.dev.example.test/coding/v1',
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.dev.example.test',
      },
    });
    expect(config.services?.pymodelSearch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
    expect(config.services?.pymodelFetch?.oauth).toEqual({
      storage: 'file',
      key: oauthKey,
      oauthHost: 'https://auth.dev.example.test',
    });
  });

  it('persists the default OAuth host when only the API base URL is scoped', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {},
    };
    const baseUrl = 'https://api.example.test/coding/v1';
    const oauthKey = resolvePythinkerCodeOAuthKey({ baseUrl });

    await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      baseUrl,
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]).toMatchObject({
      baseUrl,
      oauth: {
        storage: 'file',
        key: oauthKey,
        oauthHost: 'https://auth.kimi.com',
      },
    });
  });

  it('preserves an existing valid default model during refresh', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
          baseUrl: 'https://example.test/v1',
        },
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
      },
      defaultModel: 'custom-default',
      defaultThinking: false,
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
        'pythinker-code/stale': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('custom-default');
    expect(config.defaultThinking).toBe(false);
    expect(config.models?.['pythinker-code/stale']).toBeUndefined();
    expect(config.models?.['pythinker-code/kimi-for-coding']?.displayName).toBe('Pythinker for Coding');
  });

  it('infers default_thinking from fresh managed model capabilities', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
      },
      defaultModel: 'pythinker-code/kimi-for-coding',
      models: {
        'pythinker-code/kimi-for-coding': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('pythinker-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.defaultThinking).toBe(true);
  });

  it('preserves explicit default_thinking when preserving a custom default without capabilities', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      defaultThinking: true,
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(true);
    expect(config.defaultThinking).toBe(true);
  });

  it('defaults default_thinking to false when a preserved custom default has no signal', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultThinking).toBe(false);
  });

  it('does not infer default_thinking from preserved custom default capabilities', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: [],
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultThinking).toBe(false);
  });

  it('keeps default_thinking off even when preserved custom default has thinking capability', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultThinking).toBe(false);
  });

  it('falls back to the first fetched model when the preserved default was removed', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
      },
      defaultModel: 'pythinker-code/stale',
      defaultThinking: false,
      models: {
        'pythinker-code/stale': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'stale',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('pythinker-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultModel).toBe('pythinker-code/kimi-for-coding');
    expect(config.defaultThinking).toBe(false);
  });

  it('removes managed provider, models, services, and default model on logout', () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'pythinker-code/kimi-for-coding',
      defaultThinking: true,
      models: {
        'pythinker-code/kimi-for-coding': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
      services: {
        pymodelSearch: { baseUrl: 'https://api.kimi.com/coding/v1/search' },
        pymodelFetch: { baseUrl: 'https://api.kimi.com/coding/v1/fetch' },
        customService: { baseUrl: 'https://service.example.test' },
      },
      raw: {
        default_model: 'pythinker-code/kimi-for-coding',
        providers: {
          [PYTHINKER_CODE_PROVIDER_NAME]: { type: 'pythinker' },
          custom: { type: 'pythinker' },
        },
        models: {
          'pythinker-code/kimi-for-coding': {
            provider: PYTHINKER_CODE_PROVIDER_NAME,
            model: 'kimi-for-coding',
          },
          'custom-default': {
            provider: 'custom',
            model: 'custom-model',
          },
        },
        services: {
          pymodel_search: { base_url: 'https://api.kimi.com/coding/v1/search' },
          pymodel_fetch: { base_url: 'https://api.kimi.com/coding/v1/fetch' },
        },
      },
    };

    applyManagedPythinkerCodeLogoutConfig(config);

    expect(config.defaultModel).toBeUndefined();
    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toBeDefined();
    expect(config.models?.['pythinker-code/kimi-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toBeDefined();
    expect(config.services?.pymodelSearch).toBeUndefined();
    expect(config.services?.pymodelFetch).toBeUndefined();
    expect(config.services?.['customService']).toEqual({
      baseUrl: 'https://service.example.test',
    });
  });

  it('rejects managed models that do not include a positive context_length', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 'kimi-for-coding', supports_reasoning: true }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow(/positive context_length/);
  });

  it('surfaces API error messages from model listing failures', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toThrow('quota exceeded');
  });

  it('classifies model listing 401 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: 'The API Key appears to be invalid or may have expired.' },
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
  });

  it('classifies membership-check 402 responses as OAuth unauthorized', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                "We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
            },
          }),
          {
            status: 402,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ) as unknown as typeof fetch;

    const promise = fetchManagedPythinkerCodeModels({
      accessToken: 'oauth-access-token',
      baseUrl: 'https://api.dev.example.test/coding/v1',
      fetchImpl,
    });

    await expect(promise).rejects.toThrow(
      "Pythinker Code models endpoint https://api.dev.example.test/coding/v1 rejected OAuth credentials: We're unable to verify your membership benefits at this time. Please ensure your membership is active.",
    );
    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        baseUrl: 'https://api.dev.example.test/coding/v1',
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      status: 402,
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthUnauthorizedError);
    await expect(
      fetchManagedPythinkerCodeModels({
        accessToken: 'oauth-access-token',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ManagedPythinkerCodeModelsAuthError);
  });

  it('clears managed provider, models, default model, and services on logout', () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/pythinker-code' },
        },
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'pythinker-code/kimi-for-coding',
      models: {
        'pythinker-code/kimi-for-coding': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
        },
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 128000,
        },
      },
      services: {
        pymodelSearch: {
          baseUrl: 'https://api.kimi.com/coding/v1/search',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/pythinker-code' },
        },
        pymodelFetch: {
          baseUrl: 'https://api.kimi.com/coding/v1/fetch',
          apiKey: '',
          oauth: { storage: 'file', key: 'oauth/pythinker-code' },
        },
        otherService: { baseUrl: 'https://service.example.test' },
      },
    };

    const result = clearManagedPythinkerCodeConfig(config);

    expect(result).toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      removedProvider: true,
      removedModels: ['pythinker-code/kimi-for-coding'],
      defaultModelCleared: true,
      removedServices: ['pymodelSearch', 'pymodelFetch'],
    });
    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]).toBeUndefined();
    expect(config.providers['custom']).toMatchObject({ apiKey: 'sk-existing' });
    expect(config.defaultModel).toBeUndefined();
    expect(config.models?.['pythinker-code/kimi-for-coding']).toBeUndefined();
    expect(config.models?.['custom-default']).toMatchObject({ provider: 'custom' });
    expect(config.services?.pymodelSearch).toBeUndefined();
    expect(config.services?.pymodelFetch).toBeUndefined();
    expect(config.services?.['otherService']).toMatchObject({
      baseUrl: 'https://service.example.test',
    });
  });
});

describe('supports_thinking_type', () => {
  function makeThinkingTypeModelsResponse(): Response {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: 'kimi-for-coding',
            context_length: 262144,
            supports_reasoning: true,
            supports_image_in: true,
            supports_video_in: true,
            supports_thinking_type: 'only',
            display_name: 'Pythinker For Coding',
          },
          {
            // 'no' is the authoritative declaration and overrides the legacy
            // supports_reasoning boolean.
            id: 'pythinker-plain',
            context_length: 128000,
            supports_reasoning: true,
            supports_thinking_type: 'no',
          },
          {
            id: 'pythinker-toggle',
            context_length: 128000,
            supports_reasoning: true,
            supports_thinking_type: 'both',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  it('parses supports_thinking_type from the models endpoint', async () => {
    const models = await fetchManagedPythinkerCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
    });

    expect(models[0]?.supportsThinkingType).toBe('only');
    expect(models[1]?.supportsThinkingType).toBe('no');
    expect(models[2]?.supportsThinkingType).toBe('both');
  });

  it('leaves supportsThinkingType undefined when the field is absent or invalid', async () => {
    const absent = await fetchManagedPythinkerCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeModelsResponse()) as unknown as typeof fetch,
    });
    expect(absent[0]?.supportsThinkingType).toBeUndefined();

    const invalid = await fetchManagedPythinkerCodeModels({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: 'kimi-for-coding',
                  context_length: 262144,
                  supports_reasoning: true,
                  supports_thinking_type: 'maybe',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch,
    });
    expect(invalid[0]?.supportsThinkingType).toBeUndefined();
  });

  it('maps the three states onto capabilities, overriding supports_reasoning', async () => {
    const config: ManagedPythinkerConfigShape = { providers: {} };

    await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    // 'only' → thinking locked on.
    expect(config.models?.['pythinker-code/kimi-for-coding']?.capabilities).toEqual([
      'thinking',
      'always_thinking',
      'image_in',
      'video_in',
      'tool_use',
    ]);
    // 'no' → no thinking capability despite supports_reasoning=true.
    expect(config.models?.['pythinker-code/pythinker-plain']?.capabilities).toEqual(['tool_use']);
    // 'both' → plain toggleable thinking.
    expect(config.models?.['pythinker-code/pythinker-toggle']?.capabilities).toEqual([
      'thinking',
      'tool_use',
    ]);
  });

  it('forces default thinking on when the selected default model is thinking-only', async () => {
    const config: ManagedPythinkerConfigShape = { providers: {}, defaultThinking: false };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('pythinker-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.defaultThinking).toBe(true);
  });

  it('forces default thinking on when preserving a thinking-only managed default', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
      },
      defaultModel: 'pythinker-code/kimi-for-coding',
      defaultThinking: false,
      models: {
        'pythinker-code/kimi-for-coding': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'kimi-for-coding',
          maxContextSize: 262144,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('pythinker-code/kimi-for-coding');
    expect(result.defaultThinking).toBe(true);
    expect(config.defaultThinking).toBe(true);
  });

  it('forces default thinking off when preserving a no-thinking managed default', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        [PYTHINKER_CODE_PROVIDER_NAME]: {
          type: 'pythinker',
          apiKey: '',
        },
      },
      defaultModel: 'pythinker-code/pythinker-plain',
      defaultThinking: true,
      models: {
        'pythinker-code/pythinker-plain': {
          provider: PYTHINKER_CODE_PROVIDER_NAME,
          model: 'pythinker-plain',
          maxContextSize: 128000,
          capabilities: ['thinking'],
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('pythinker-code/pythinker-plain');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultThinking).toBe(false);
  });

  it('keeps a preserved non-managed default thinking selection untouched', async () => {
    const config: ManagedPythinkerConfigShape = {
      providers: {
        custom: {
          type: 'pythinker',
          apiKey: 'sk-existing',
        },
      },
      defaultModel: 'custom-default',
      defaultThinking: false,
      models: {
        'custom-default': {
          provider: 'custom',
          model: 'custom-model',
          maxContextSize: 1000,
        },
      },
    };

    const result = await provisionManagedPythinkerCodeConfig({
      accessToken: 'oauth-access-token',
      fetchImpl: vi.fn(async () => makeThinkingTypeModelsResponse()) as unknown as typeof fetch,
      preserveDefaultModel: true,
      adapter: {
        read: () => config,
        write: vi.fn(),
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    expect(result.defaultModel).toBe('custom-default');
    expect(result.defaultThinking).toBe(false);
    expect(config.defaultThinking).toBe(false);
  });
});
