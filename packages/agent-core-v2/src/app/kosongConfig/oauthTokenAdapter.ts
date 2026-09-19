import { LifecycleScope } from '#/app/scopes';

import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2 } from '#/_base/errors/errors';

import { IOAuthTokenService } from '#/app/auth/auth';
import { AuthErrors } from '#/app/auth/errors';
import { nonEmpty } from '#/kosong/model/modelAuth';
import { IModelOAuthTokens } from '#/kosong/model/modelOAuth';
import type { OAuthRef } from '#/kosong/provider/provider';

export class ModelOAuthTokenAdapter implements IModelOAuthTokens {
  declare readonly _serviceBrand: undefined;

  constructor(@IOAuthTokenService private readonly oauth: IOAuthTokenService) {}

  async hasCachedAccessToken(provider: string, oauthRef: OAuthRef): Promise<boolean> {
    try {
      const token = await this.oauth.getCachedAccessToken(provider, oauthRef);
      return nonEmpty(token) !== undefined;
    } catch {
      return false;
    }
  }

  async getAccessToken(
    provider: string,
    oauthRef: OAuthRef,
    options?: { readonly force?: boolean },
  ): Promise<string> {
    const tokenProvider = this.oauth.resolveTokenProvider(provider, oauthRef);
    if (tokenProvider === undefined) throw loginRequired(provider);
    const token = await tokenProvider.getAccessToken(
      options?.force === true ? { force: true } : undefined,
    );
    if (token.trim().length === 0) throw loginRequired(provider);
    return token;
  }
}

function loginRequired(providerKey: string): Error2 {
  return new Error2(
    AuthErrors.codes.AUTH_LOGIN_REQUIRED,
    `OAuth provider "${providerKey}" has no usable stored credential.`,
  );
}

registerScopedService(
  LifecycleScope.App,
  IModelOAuthTokens,
  ModelOAuthTokenAdapter,
  ScopeActivation.OnScopeCreated,
  'kosongConfig',
);
