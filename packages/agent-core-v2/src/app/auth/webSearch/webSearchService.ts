import {
  PYTHINKER_CODE_PROVIDER_NAME,
  pythinkerCodeBaseUrl,
  type BearerTokenProvider,
} from '@pymodel/pythinker-code-oauth';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IOAuthService } from '#/app/auth/auth';
import { IAgentIdentity } from '#/app/agentIdentity/agentIdentity';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IProviderService, type ProviderConfig } from '#/kosong/provider/provider';
import { isOAuthCatalogVendor } from '#/kosong/provider/providerDefinition';

import { SERVICES_SECTION, type ServicesConfig } from '../configSection';
import { PyModelWebSearchProvider } from './providers/pymodel-web-search';
import type { WebSearchProvider } from '#/agent/tools/web-search/web-search';
import { IWebSearchProviderService } from './webSearch';

export class WebSearchProviderService implements IWebSearchProviderService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IProviderService private readonly providers: IProviderService,
    @IOAuthService private readonly oauth: IOAuthService,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IConfigService private readonly config: IConfigService,
    @IAgentIdentity private readonly identity: IAgentIdentity,
  ) {}

  getWebSearchProvider(): WebSearchProvider | undefined {
    return this.fromServicesConfig() ?? this.fromManagedOAuth();
  }

  hasWebSearchProvider(): boolean {
    return this.configuredSearch() !== undefined || this.managedTokenProvider() !== undefined;
  }

  private configuredSearch(): (ServicesConfig['pymodelSearch'] & { baseUrl: string }) | undefined {
    const search = this.config.get<ServicesConfig>(SERVICES_SECTION)?.pymodelSearch;
    if (search?.baseUrl === undefined) return undefined;
    return search as ServicesConfig['pymodelSearch'] & { baseUrl: string };
  }

  private managedTokenProvider():
    | { provider: ProviderConfig; tokenProvider: BearerTokenProvider }
    | undefined {
    const provider = this.providers.get(PYTHINKER_CODE_PROVIDER_NAME);
    if (provider === undefined || !isOAuthCatalogVendor(provider.type) || provider.oauth === undefined) {
      return undefined;
    }
    const tokenProvider = this.oauth.resolveTokenProvider(
      PYTHINKER_CODE_PROVIDER_NAME,
      provider.oauth,
    );
    if (tokenProvider === undefined) return undefined;
    return { provider, tokenProvider };
  }

  private fromServicesConfig(): WebSearchProvider | undefined {
    const search = this.configuredSearch();
    if (search === undefined) return undefined;
    const tokenProvider =
      search.oauth === undefined
        ? undefined
        : this.oauth.resolveTokenProvider(PYTHINKER_CODE_PROVIDER_NAME, search.oauth);
    return new PyModelWebSearchProvider({
      baseUrl: search.baseUrl,
      tokenProvider,
      apiKey: nonEmptyString(search.apiKey),
      defaultHeaders: { ...this.identity.current().requestHeaders },
      customHeaders: search.customHeaders,
    });
  }

  private fromManagedOAuth(): WebSearchProvider | undefined {
    const managed = this.managedTokenProvider();
    if (managed === undefined) return undefined;
    const { provider, tokenProvider } = managed;
    const baseUrl = `${(provider.baseUrl ?? pythinkerCodeBaseUrl()).replace(/\/+$/, '')}/search`;
    return new PyModelWebSearchProvider({
      baseUrl,
      tokenProvider,
      defaultHeaders: { ...this.bootstrap.args.requestHeaders },
      customHeaders: provider.customHeaders,
    });
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

registerScopedService(
  LifecycleScope.App,
  IWebSearchProviderService,
  WebSearchProviderService,
  ScopeActivation.OnScopeCreated,
  'auth',
);
