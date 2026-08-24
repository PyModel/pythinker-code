import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { IOAuthTokenService } from '#/app/auth/auth';
import { SERVICES_SECTION, type ServicesConfig } from '#/app/auth/configSection';
import {
  buildAgentIdentitySnapshot,
  IAgentIdentity,
  type AgentIdentitySnapshot,
} from '#/app/agentIdentity/agentIdentity';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IProviderService, type ProviderConfig } from '#/kosong/provider/provider';
import { LocalFetchURLProvider } from '#/app/web/providers/local-fetch-url';
import { PyModelFetchURLProvider } from '#/app/web/providers/pymodel-fetch-url';
import { IWebFetchService } from '#/app/web/web';
import { WebFetchService } from '#/app/web/webService';
import '#/kosong/provider/providers/pythinker/pythinker.contrib';

import { stubAgentIdentity } from '../agentIdentity/stubs';

const OAUTH_PROVIDER = 'services:pymodel-fetch';
const NON_OAUTH_PROVIDER = 'openai-main';
const HOST_HEADERS = {
  'User-Agent': 'pythinker-code-cli/test',
  'X-Msh-Device-Id': 'device-test',
};

describe('WebFetchService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let providers: Record<string, ProviderConfig>;
  let servicesConfig: ServicesConfig | undefined;
  let identitySlug: string | undefined;
  let resolveTokenProvider: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    disposables = new DisposableStore();
    providers = {};
    servicesConfig = undefined;
    identitySlug = undefined;
    resolveTokenProvider = vi
      .fn()
      .mockReturnValue({ getAccessToken: async () => 'access-token' });
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.definePartialInstance(IProviderService, {
          get: ((name: string) => providers[name]) as IProviderService['get'],
        });
        reg.definePartialInstance(IOAuthTokenService, {
          resolveTokenProvider:
            resolveTokenProvider as unknown as IOAuthTokenService['resolveTokenProvider'],
        });
        const snapshot = (): AgentIdentitySnapshot =>
          buildAgentIdentitySnapshot({ slug: identitySlug, hostRequestHeaders: HOST_HEADERS });
        reg.defineInstance(IAgentIdentity, {
          _serviceBrand: undefined,
          resolved: () => Promise.resolve(snapshot()),
          current: snapshot,
        });
        reg.definePartialInstance(IBootstrapService, {
          args: { requestHeaders: HOST_HEADERS },
        });
        reg.definePartialInstance(IConfigService, {
          get: ((domain: string) =>
            domain === SERVICES_SECTION ? servicesConfig : undefined) as IConfigService['get'],
        });
        reg.define(IWebFetchService, WebFetchService);
      },
    });
  });

  afterEach(() => {
    disposables.dispose();
    vi.unstubAllGlobals();
  });

  function fetcher(): ReturnType<IWebFetchService['getUrlFetcher']> {
    return ix.get(IWebFetchService).getUrlFetcher();
  }

  it('yields the local fetcher when no service endpoint is configured', () => {
    providers = { [NON_OAUTH_PROVIDER]: { type: 'openai', apiKey: 'sk-test' } };
    expect(fetcher()).toBeInstanceOf(LocalFetchURLProvider);
    expect(resolveTokenProvider).not.toHaveBeenCalled();
  });

  it('does not infer a service endpoint from a model provider', () => {
    providers = { [OAUTH_PROVIDER]: { type: 'pythinker', apiKey: 'sk-test' } };
    expect(fetcher()).toBeInstanceOf(LocalFetchURLProvider);
    expect(resolveTokenProvider).not.toHaveBeenCalled();
  });

  it('yields the local fetcher when the oauth service yields no token provider', () => {
    providers = {
      [OAUTH_PROVIDER]: {
        type: 'pythinker',
        baseUrl: 'https://api.example.com',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
    };
    resolveTokenProvider.mockReturnValue(undefined);
    expect(fetcher()).toBeInstanceOf(LocalFetchURLProvider);
  });

  it('builds a PyModel fetcher from the services.pymodel_fetch api_key config', async () => {
    servicesConfig = {
      pymodelFetch: {
        baseUrl: 'https://fetch.example.com/fetch',
        apiKey: 'fetch-key',
        customHeaders: { 'X-Config': '1' },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => 'page body',
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(fetcher()).toBeInstanceOf(PyModelFetchURLProvider);
    expect(resolveTokenProvider).not.toHaveBeenCalled();
    const result = await fetcher().fetch('https://example.com/page');

    expect(result).toEqual({ content: 'page body', kind: 'extracted' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://fetch.example.com/fetch');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer fetch-key');
    expect(headers['User-Agent']).toBe('pythinker-code-cli/test');
    expect(headers['X-Msh-Device-Id']).toBe('device-test');
    expect(headers['X-Config']).toBe('1');
  });

  it('sends the configured identity to a services-config endpoint', async () => {
    identitySlug = 'acme';
    servicesConfig = {
      pymodelFetch: { baseUrl: 'https://fetch.example.com/fetch', apiKey: 'fetch-key' },
    };
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => 'page body' });
    vi.stubGlobal('fetch', fetchMock);

    await fetcher().fetch('https://example.com/page');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('acme/test');
  });

  it('uses services.pymodel_fetch without consulting model providers', () => {
    servicesConfig = {
      pymodelFetch: { baseUrl: 'https://config.example.com/fetch', apiKey: 'config-key' },
    };
    providers = {
      [OAUTH_PROVIDER]: {
        type: 'pythinker',
        baseUrl: 'https://models.example.com/v1',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
    };
    expect(fetcher()).toBeInstanceOf(PyModelFetchURLProvider);
    expect(resolveTokenProvider).not.toHaveBeenCalled();
  });

  it('builds a PyModel fetcher from the services.pymodel_fetch oauth ref', () => {
    servicesConfig = {
      pymodelFetch: {
        baseUrl: 'https://fetch.example.com/fetch',
        oauth: { storage: 'file', key: 'oauth/pythinker-code' },
      },
    };
    expect(fetcher()).toBeInstanceOf(PyModelFetchURLProvider);
    expect(resolveTokenProvider).toHaveBeenCalledWith(OAUTH_PROVIDER, {
      storage: 'file',
      key: 'oauth/pythinker-code',
    });
  });

  it('yields the local fetcher when services.pymodel_fetch has no baseUrl', () => {
    servicesConfig = { pymodelFetch: { apiKey: 'fetch-key' } };
    expect(fetcher()).toBeInstanceOf(LocalFetchURLProvider);
    expect(resolveTokenProvider).not.toHaveBeenCalled();
  });
});
