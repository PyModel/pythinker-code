import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IOAuthTokenService } from '#/app/auth/auth';
import { SERVICES_SECTION, type ServicesConfig } from '#/app/auth/configSection';
import { IAgentIdentity } from '#/app/agentIdentity/agentIdentity';
import { IConfigService } from '#/app/config/config';

import { LocalFetchURLProvider } from './providers/local-fetch-url';
import { PyModelFetchURLProvider } from './providers/pymodel-fetch-url';
import type { UrlFetcher } from './tools/fetch-url-types';
import { IWebFetchService } from './web';

const WEB_FETCH_CREDENTIAL_SLOT = 'services:pymodel-fetch';

export class WebFetchService implements IWebFetchService {
  declare readonly _serviceBrand: undefined;
  private readonly localFetcher: UrlFetcher;

  constructor(
    @IOAuthTokenService private readonly oauth: IOAuthTokenService,
    @IConfigService private readonly config: IConfigService,
    @IAgentIdentity private readonly identity: IAgentIdentity,
  ) {
    this.localFetcher = new LocalFetchURLProvider();
  }

  getUrlFetcher(): UrlFetcher {
    return this.fromServicesConfig() ?? this.localFetcher;
  }

  private fromServicesConfig(): UrlFetcher | undefined {
    const fetchConfig = this.config.get<ServicesConfig>(SERVICES_SECTION)?.pymodelFetch;
    if (fetchConfig?.baseUrl === undefined) {
      return undefined;
    }
    const tokenProvider =
      fetchConfig.oauth === undefined
        ? undefined
        : this.oauth.resolveTokenProvider(WEB_FETCH_CREDENTIAL_SLOT, fetchConfig.oauth);
    return new PyModelFetchURLProvider({
      baseUrl: fetchConfig.baseUrl,
      tokenProvider,
      apiKey: nonEmptyString(fetchConfig.apiKey),
      defaultHeaders: { ...this.identity.current().requestHeaders },
      customHeaders: fetchConfig.customHeaders,
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
