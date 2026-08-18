import {
  PYTHINKER_CODE_PROVIDER_NAME,
  pythinkerCodeBaseUrl,
} from '@pymodel/pythinker-code-oauth';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IOAuthService } from '#/app/auth/auth';
import { SERVICES_SECTION, type ServicesConfig } from '#/app/auth/configSection';
import { IAgentIdentity } from '#/app/agentIdentity/agentIdentity';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IProviderService } from '#/kosong/provider/provider';
import { isOAuthCatalogVendor } from '#/kosong/provider/providerDefinition';

import { LocalFetchURLProvider } from './providers/local-fetch-url';
import { PyModelFetchURLProvider } from './providers/pymodel-fetch-url';
import type { UrlFetcher } from './tools/fetch-url-types';
import { IWebFetchService } from './web';

export class WebFetchService implements IWebFetchService {
  declare readonly _serviceBrand: undefined;
  private readonly localFetcher: UrlFetcher;

  constructor(
    @IProviderService private readonly providers: IProviderService,
    @IOAuthService private readonly oauth: IOAuthService,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IConfigService private readonly config: IConfigService,
    @IAgentIdentity private readonly identity: IAgentIdentity,
  ) {
    this.localFetcher = new LocalFetchURLProvider();
  }

  getUrlFetcher(): UrlFetcher {
    return this.fromServicesConfig() ?? this.fromManagedOAuth() ?? this.localFetcher;
  }

  private fromServicesConfig(): UrlFetcher | undefined {
    const fetchConfig = this.config.get<ServicesConfig>(SERVICES_SECTION)?.pymodelFetch;
    if (fetchConfig?.baseUrl === undefined) {
      return undefined;
    }
    const tokenProvider =
      fetchConfig.oauth === undefined
        ? undefined
        : this.oauth.resolveTokenProvider(PYTHINKER_CODE_PROVIDER_NAME, fetchConfig.oauth);
    return new PyModelFetchURLProvider({
      baseUrl: fetchConfig.baseUrl,
      tokenProvider,
      apiKey: nonEmptyString(fetchConfig.apiKey),
      defaultHeaders: { ...this.identity.current().requestHeaders },
      customHeaders: fetchConfig.customHeaders,
      localFallback: this.localFetcher,
    });
  }

  private fromManagedOAuth(): UrlFetcher | undefined {
    const provider = this.providers.get(PYTHINKER_CODE_PROVIDER_NAME);
    if (provider === undefined || !isOAuthCatalogVendor(provider.type) || provider.oauth === undefined) {
      return undefined;
    }
    const tokenProvider = this.oauth.resolveTokenProvider(
      PYTHINKER_CODE_PROVIDER_NAME,
      provider.oauth,
    );
    if (tokenProvider === undefined) {
      return undefined;
    }
    const baseUrl = `${(provider.baseUrl ?? pythinkerCodeBaseUrl()).replace(/\/+$/, '')}/fetch`;
    return new PyModelFetchURLProvider({
      baseUrl,
      tokenProvider,
      defaultHeaders: { ...this.bootstrap.args.requestHeaders },
      customHeaders: provider.customHeaders,
      localFallback: this.localFetcher,
    });
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

registerScopedService(
  LifecycleScope.App,
  IWebFetchService,
  WebFetchService,
  ScopeActivation.OnScopeCreated,
  'web',
);
