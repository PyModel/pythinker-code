import { FileTokenStorage, resolveOAuthTokenStorageName } from '@pymodel/pythinker-code-oauth';
import { join } from 'pathe';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { type ILogger, ILogService } from '#/_base/log/log';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { LifecycleScope } from '#/app/scopes';
import { IModelService, type ModelRecord } from '#/kosong/model/model';
import {
  deriveProviderId,
  effectiveModelConfig,
  nonEmpty,
  resolveModelAuthMaterial,
} from '#/kosong/model/modelAuth';
import { IProviderService, type OAuthRef } from '#/kosong/provider/provider';

import {
  AuthModelNotResolvedError,
  AuthProvisioningRequiredError,
  AuthTokenMissingError,
  type AuthStatus,
  type OAuthBearerTokenProvider,
  IAuthSummaryService,
  IOAuthTokenService,
} from './auth';

export class OAuthTokenService implements IOAuthTokenService {
  declare readonly _serviceBrand: undefined;

  private readonly storage: FileTokenStorage;

  constructor(@IBootstrapService bootstrap: IBootstrapService) {
    this.storage = new FileTokenStorage(join(bootstrap.homeDir, bootstrap.scope('credentials')));
  }

  async status(provider: string, oauthRef: OAuthRef): Promise<AuthStatus> {
    return {
      loggedIn: (await this.getCachedAccessToken(provider, oauthRef)) !== undefined,
      provider,
    };
  }

  resolveTokenProvider(provider: string, oauthRef: OAuthRef): OAuthBearerTokenProvider | undefined {
    if (oauthRef.storage !== 'file') return undefined;
    return {
      getAccessToken: async () => {
        const token = await this.getCachedAccessToken(provider, oauthRef);
        if (token === undefined) throw new AuthTokenMissingError(provider);
        return token;
      },
    };
  }

  async getCachedAccessToken(
    _provider: string,
    oauthRef: OAuthRef,
  ): Promise<string | undefined> {
    if (oauthRef.storage !== 'file') return undefined;
    const token = await this.storage.load(resolveOAuthTokenStorageName(oauthRef.key));
    if (token === undefined || token.accessToken.trim().length === 0) return undefined;
    if (token.expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    return token.accessToken;
  }
}

export class AuthSummaryService implements IAuthSummaryService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IProviderService private readonly providerService: IProviderService,
    @IModelService private readonly modelService: IModelService,
    @IConfigService private readonly config: IConfigService,
    @IOAuthTokenService private readonly oauth: IOAuthTokenService,
    @ILogService private readonly log: ILogger,
  ) {}

  async summarize(): Promise<readonly AuthStatus[]> {
    const statuses: AuthStatus[] = [];
    for (const [name, provider] of Object.entries(this.providerService.list())) {
      if (provider.oauth === undefined) continue;
      try {
        statuses.push(await this.oauth.status(name, provider.oauth));
      } catch (error) {
        this.log.warn('OAuth credential status failed', {
          provider: name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return statuses;
  }

  async ensureReady(modelOverride?: string): Promise<void> {
    await this.config.reload();
    const providers = this.providerService.list();
    const models = this.modelService.list();
    const modelId = modelOverride ?? this.modelService.getDefaultModel();
    const configured = modelId === undefined || modelId === '' ? undefined : models[modelId];
    if (Object.keys(providers).length === 0 && !isProviderlessModel(configured)) {
      throw new AuthProvisioningRequiredError();
    }
    if (modelId === undefined || modelId === '') {
      throw new AuthModelNotResolvedError(undefined);
    }
    if (configured === undefined) {
      throw new AuthModelNotResolvedError(modelId);
    }

    const model = effectiveModelConfig(configured);
    const providerId = model.providerId ?? model.provider;
    const provider = providerId === undefined ? undefined : this.providerService.get(providerId);
    if (providerId !== undefined && provider === undefined) {
      throw new AuthModelNotResolvedError(modelId, providerId);
    }

    const providerName = providerId ?? providerNameFromFlatModel(model);
    if (providerName === undefined) {
      throw new AuthModelNotResolvedError(modelId);
    }

    const auth = resolveModelAuthMaterial({
      modelId,
      model,
      provider,
      providerName,
    });
    if (auth.apiKey !== undefined) return;
    if (auth.oauth !== undefined) {
      const providerKey = auth.oauthProviderKey ?? providerName;
      const token = await this.oauth.getCachedAccessToken(providerKey, auth.oauth);
      if (nonEmpty(token) !== undefined) return;
      throw new AuthTokenMissingError(providerKey);
    }
    throw new AuthTokenMissingError(providerName);
  }
}

function isProviderlessModel(model: ModelRecord | undefined): boolean {
  if (model === undefined) return false;
  const effective = effectiveModelConfig(model);
  return (
    effective.providerId === undefined &&
    effective.provider === undefined &&
    providerNameFromFlatModel(effective) !== undefined
  );
}

function providerNameFromFlatModel(model: ModelRecord): string | undefined {
  const baseUrl = nonEmpty(model.baseUrl);
  return baseUrl === undefined ? undefined : deriveProviderId(baseUrl);
}

registerScopedService(
  LifecycleScope.App,
  IOAuthTokenService,
  OAuthTokenService,
  ScopeActivation.OnScopeCreated,
  'auth',
);
registerScopedService(
  LifecycleScope.App,
  IAuthSummaryService,
  AuthSummaryService,
  ScopeActivation.OnScopeCreated,
  'auth',
);
