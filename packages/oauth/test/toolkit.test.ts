import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyManagedPythinkerCodeConfig,
  PYTHINKER_CODE_PROVIDER_NAME,
  PythinkerOAuthToolkit,
  resolvePythinkerCodeOAuthKey,
  resolvePythinkerTokenStorageName,
  type ManagedPythinkerConfigShape,
  type TokenInfo,
  type TokenStorage,
} from '../src';

class MemoryTokenStorage implements TokenStorage {
  readonly tokens = new Map<string, TokenInfo>();

  async load(name: string): Promise<TokenInfo | undefined> {
    return this.tokens.get(name);
  }

  async save(name: string, token: TokenInfo): Promise<void> {
    this.tokens.set(name, token);
  }

  async remove(name: string): Promise<void> {
    this.tokens.delete(name);
  }

  async list(): Promise<string[]> {
    return [...this.tokens.keys()];
  }
}

function token(accessToken: string): TokenInfo {
  return {
    accessToken,
    refreshToken: `refresh-${accessToken}`,
    expiresAt: 10_000,
    scope: '',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
}

const TEST_IDENTITY = {
  userAgentProduct: 'pythinker-code-cli',
  version: '0.0.0-test',
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function managedModelsResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          id: 'kimi-for-coding',
          context_length: 262144,
          supports_reasoning: true,
        },
      ],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function fetchInputUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new TypeError('expected fetch input to be a string, URL, or Request');
}

describe('resolvePythinkerTokenStorageName', () => {
  it('maps config oauth keys to the file storage token name', () => {
    expect(
      resolvePythinkerTokenStorageName({
        providerName: PYTHINKER_CODE_PROVIDER_NAME,
        oauthKey: 'oauth/pythinker-code',
      }),
    ).toBe('pythinker-code');
    expect(resolvePythinkerTokenStorageName({ oauthKey: 'pythinker-code' })).toBe('pythinker-code');
  });

  it('rejects unsupported providers and unsafe token keys', () => {
    expect(() =>
      resolvePythinkerTokenStorageName({
        providerName: 'custom',
        oauthKey: 'pythinker-code',
      }),
    ).toThrow(/No OAuth manager/);
    expect(() => resolvePythinkerTokenStorageName({ oauthKey: '../pythinker-code' })).toThrow(/Invalid/);
  });
});

describe('PythinkerOAuthToolkit', () => {
  it('can be constructed without host identity', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('pythinker-code', token('access-1'));
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      storage,
      now: () => 100,
    });

    await expect(toolkit.tokenProvider().getAccessToken()).resolves.toBe('access-1');
  });

  it('reports status and exposes a bearer token provider', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('pythinker-code', token('access-1'));
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
    });

    await expect(toolkit.status()).resolves.toEqual({
      providers: [{ providerName: PYTHINKER_CODE_PROVIDER_NAME, hasToken: true }],
    });
    await expect(toolkit.tokenProvider().getAccessToken()).resolves.toBe('access-1');
  });

  it('resolves bearer token providers using the configured oauth key', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('custom-pythinker-code', token('custom-access'));
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
    });

    await expect(
      toolkit
        .tokenProvider(PYTHINKER_CODE_PROVIDER_NAME, { key: 'oauth/custom-pythinker-code' })
        .getAccessToken(),
    ).resolves.toBe('custom-access');
  });

  it('refreshes configured bearer token refs against their OAuth host', async () => {
    const storage = new MemoryTokenStorage();
    const oauthHost = 'https://auth.dev.example.test';
    const oauthKey = resolvePythinkerCodeOAuthKey({
      oauthHost,
      baseUrl: 'https://api.dev.example.test/coding/v1',
    });
    storage.tokens.set(resolvePythinkerTokenStorageName({ oauthKey }), {
      ...token('expired-dev-access'),
      expiresAt: 100,
    });
    const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(fetchInputUrl(input)).toBe(`${oauthHost}/api/oauth/token`);
      if (typeof init?.body !== 'string') throw new TypeError('expected form body');
      expect(new URLSearchParams(init.body).get('grant_type')).toBe('refresh_token');
      return new Response(
        JSON.stringify({
          access_token: 'rotated-dev-access',
          refresh_token: 'rotated-dev-refresh',
          expires_in: 3600,
          scope: '',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchImpl);
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 1_000,
      flowConfig: {
        name: 'pythinker-code',
        oauthHost: 'https://auth.kimi.com',
        clientId: 'test-client-id',
      },
    });

    await expect(
      toolkit
        .tokenProvider(PYTHINKER_CODE_PROVIDER_NAME, { key: oauthKey, oauthHost })
        .getAccessToken(),
    ).resolves.toBe('rotated-dev-access');
  });

  it('does not reuse a cached OAuth manager across different hosts for the same token key', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('custom-pythinker-code', {
      ...token('expired-custom-access'),
      expiresAt: 100,
    });
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: unknown) => {
      requests.push(fetchInputUrl(input));
      return new Response(
        JSON.stringify({
          access_token: `rotated-${String(requests.length)}`,
          refresh_token: `refresh-${String(requests.length)}`,
          expires_in: 3600,
          scope: '',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchImpl);
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 1_000,
      flowConfig: {
        name: 'pythinker-code',
        oauthHost: 'https://auth.kimi.com',
        clientId: 'test-client-id',
      },
    });

    await expect(
      toolkit
        .tokenProvider(PYTHINKER_CODE_PROVIDER_NAME, {
          key: 'oauth/custom-pythinker-code',
          oauthHost: 'https://auth.one.test/',
        })
        .getAccessToken({ force: true }),
    ).resolves.toBe('rotated-1');
    await expect(
      toolkit
        .tokenProvider(PYTHINKER_CODE_PROVIDER_NAME, {
          key: 'oauth/custom-pythinker-code',
          oauthHost: 'https://auth.two.test',
        })
        .getAccessToken({ force: true }),
    ).resolves.toBe('rotated-2');

    expect(requests).toEqual([
      'https://auth.one.test/api/oauth/token',
      'https://auth.two.test/api/oauth/token',
    ]);
  });

  it('returns the cached access token without refreshing it', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('pythinker-code', {
      ...token('cached-access'),
      expiresAt: 1,
    });
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 10_000,
    });

    await expect(toolkit.getCachedAccessToken()).resolves.toBe('cached-access');
  });

  it('resolves cached access tokens using the configured oauth key', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('custom-pythinker-code', token('custom-cached-access'));
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
    });

    await expect(
      toolkit.getCachedAccessToken(PYTHINKER_CODE_PROVIDER_NAME, { key: 'oauth/custom-pythinker-code' }),
    ).resolves.toBe('custom-cached-access');
  });

  it('returns undefined when no cached access token exists', async () => {
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage: new MemoryTokenStorage(),
      now: () => 100,
    });

    await expect(toolkit.getCachedAccessToken()).resolves.toBeUndefined();
  });

  it('provisions managed config after login when an adapter is configured', async () => {
    const storage = new MemoryTokenStorage();
    const write = vi.fn();
    const fetchImpl = vi.fn(async () => managedModelsResponse()) as unknown as typeof fetch;
    const config = { providers: {} };
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
      fetchImpl,
      configAdapter: {
        read: () => config,
        write,
        apply: (target, input) => {
          target.providers[PYTHINKER_CODE_PROVIDER_NAME] = {
            type: 'pythinker',
            apiKey: '',
          };
          return {
            defaultModel: `pythinker-code/${input.models[0]?.id ?? 'unknown'}`,
            defaultThinking: true,
          };
        },
      },
    });

    storage.tokens.set('pythinker-code', token('access-1'));
    await expect(toolkit.login()).resolves.toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      ok: true,
      provision: {
        defaultModel: 'pythinker-code/kimi-for-coding',
      },
    });
    expect(write).toHaveBeenCalledWith(config);
  });

  it.each([401, 402])(
    'force-refreshes a stored token when managed model provisioning rejects cached auth with HTTP %i',
    async (status) => {
      const storage = new MemoryTokenStorage();
      const write = vi.fn();
      const onDeviceCode = vi.fn();
      const config = { providers: {} };
      const oauthHost = 'https://auth.test';
      const oauthKey = resolvePythinkerCodeOAuthKey({ oauthHost });
      storage.tokens.set(resolvePythinkerTokenStorageName({ oauthKey }), token('stale-access'));
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { message: 'The API Key appears to be invalid or may have expired.' },
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
        )
        .mockResolvedValueOnce(managedModelsResponse());
      const fetchImpl = fetchMock as unknown as typeof fetch;
      const oauthFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new TypeError('expected form body');
        const body = new URLSearchParams(init.body);
        if (body.get('grant_type') !== 'refresh_token') {
          throw new Error(`unexpected OAuth grant: ${body.get('grant_type') ?? '<missing>'}`);
        }
        return new Response(
          JSON.stringify({
            access_token: 'rotated-access',
            refresh_token: 'rotated-refresh',
            expires_in: 3600,
            scope: '',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });
      vi.stubGlobal('fetch', oauthFetch);
      const toolkit = new PythinkerOAuthToolkit({
        homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
        identity: TEST_IDENTITY,
        storage,
        now: () => 100,
        fetchImpl,
        flowConfig: {
          name: 'pythinker-code',
          oauthHost,
          clientId: 'test-client-id',
        },
        configAdapter: {
          read: () => config,
          write,
          apply: (target, input) => {
            target.providers[PYTHINKER_CODE_PROVIDER_NAME] = {
              type: 'pythinker',
              apiKey: '',
            };
            return {
              defaultModel: `pythinker-code/${input.models[0]?.id ?? 'unknown'}`,
              defaultThinking: true,
            };
          },
        },
      });

      await expect(toolkit.login(undefined, { onDeviceCode })).resolves.toMatchObject({
        providerName: PYTHINKER_CODE_PROVIDER_NAME,
        ok: true,
        provision: {
          defaultModel: 'pythinker-code/kimi-for-coding',
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const firstModelRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const secondModelRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
      expect(new Headers(firstModelRequest?.headers).get('authorization')).toBe(
        'Bearer stale-access',
      );
      expect(new Headers(secondModelRequest?.headers).get('authorization')).toBe(
        'Bearer rotated-access',
      );
      expect(oauthFetch).toHaveBeenCalledTimes(1);
      expect(onDeviceCode).not.toHaveBeenCalled();
      expect(write).toHaveBeenCalledWith(config);
    },
  );

  it('uses a scoped credential slot for non-default OAuth login environments', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('pythinker-code', token('prod-access'));
    const config: ManagedPythinkerConfigShape = { providers: {} };
    const devBaseUrl = 'https://api.dev.example.test/coding/v1';
    const devOauthHost = 'https://auth.dev.example.test';
    const devOauthKey = resolvePythinkerCodeOAuthKey({
      oauthHost: devOauthHost,
      baseUrl: devBaseUrl,
    });
    const devStorageName = resolvePythinkerTokenStorageName({ oauthKey: devOauthKey });
    const write = vi.fn();
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      managedModelsResponse(),
    );
    const oauthFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected form body');
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        return new Response(
          JSON.stringify({
            access_token: 'dev-access',
            refresh_token: 'dev-refresh',
            expires_in: 3600,
            scope: '',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          user_code: 'WDJB-MJHT',
          device_code: 'device-code',
          verification_uri: `${devOauthHost}/verify`,
          verification_uri_complete: `${devOauthHost}/verify?user_code=WDJB-MJHT`,
          expires_in: 600,
          interval: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', oauthFetch);
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
      fetchImpl: fetchMock as unknown as typeof fetch,
      flowConfig: {
        name: 'pythinker-code',
        oauthHost: devOauthHost,
        clientId: 'test-client-id',
      },
      configAdapter: {
        read: () => config,
        write,
        apply: applyManagedPythinkerCodeConfig,
      },
    });

    await expect(toolkit.login(undefined, { baseUrl: devBaseUrl })).resolves.toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      ok: true,
    });
    expect(oauthFetch).toHaveBeenCalledTimes(2);
    expect(storage.tokens.get('pythinker-code')?.accessToken).toBe('prod-access');
    expect(storage.tokens.get(devStorageName)?.accessToken).toBe('dev-access');
    expect(config.providers[PYTHINKER_CODE_PROVIDER_NAME]?.oauth).toEqual({
      storage: 'file',
      key: devOauthKey,
      oauthHost: devOauthHost,
    });
    const modelRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(modelRequest?.headers).get('authorization')).toBe('Bearer dev-access');
    expect(write).toHaveBeenCalledWith(config);
  });

  it('starts a new device flow when the stored refresh token is invalid', async () => {
    const storage = new MemoryTokenStorage();
    const oauthHost = 'https://auth.test';
    const oauthKey = resolvePythinkerCodeOAuthKey({ oauthHost });
    const storageName = resolvePythinkerTokenStorageName({ oauthKey });
    storage.tokens.set(storageName, {
      ...token('stale-access'),
      refreshToken: 'revoked-refresh',
      expiresAt: 101,
    });
    const onDeviceCode = vi.fn();
    const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new TypeError('expected form body');
      const body = new URLSearchParams(init.body);
      if (body.get('grant_type') === 'refresh_token') {
        return new Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'The provided authorization grant is invalid',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (body.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        return new Response(
          JSON.stringify({
            access_token: 'fresh-access',
            refresh_token: 'fresh-refresh',
            expires_in: 3600,
            scope: '',
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          user_code: 'WDJB-MJHT',
          device_code: 'device-code',
          verification_uri: 'https://auth.test/verify',
          verification_uri_complete: 'https://auth.test/verify?user_code=WDJB-MJHT',
          expires_in: 600,
          interval: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
      flowConfig: {
        name: 'pythinker-code',
        oauthHost,
        clientId: 'test-client-id',
      },
    });

    await expect(toolkit.login(undefined, { onDeviceCode })).resolves.toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      ok: true,
    });
    expect(onDeviceCode).toHaveBeenCalledTimes(1);
    expect((await storage.load(storageName))?.accessToken).toBe('fresh-access');
  });

  it('removes managed config on logout when an adapter supports cleanup', async () => {
    const storage = new MemoryTokenStorage();
    storage.tokens.set('pythinker-code', token('access-1'));
    const config = { providers: { [PYTHINKER_CODE_PROVIDER_NAME]: { type: 'pythinker' } } };
    const write = vi.fn();
    const remove = vi.fn();
    const toolkit = new PythinkerOAuthToolkit({
      homeDir: join('/tmp', 'pythinker-oauth-toolkit-test'),
      identity: TEST_IDENTITY,
      storage,
      now: () => 100,
      configAdapter: {
        read: () => config,
        write,
        apply: () => ({ defaultModel: 'pythinker-code/kimi-for-coding', defaultThinking: true }),
        remove,
      },
    });

    await expect(toolkit.logout()).resolves.toMatchObject({
      providerName: PYTHINKER_CODE_PROVIDER_NAME,
      ok: true,
    });
    expect(remove).toHaveBeenCalledWith(config);
    expect(write).toHaveBeenCalledWith(config);
    await expect(storage.load('pythinker-code')).resolves.toBeUndefined();
  });
});
