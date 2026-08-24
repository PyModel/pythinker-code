import {
  OAuthTokenReader,
  type OAuthRef,
  type OAuthTokenProviderResolver,
} from '@pymodel/agent-core';

export interface PythinkerAuthFacadeOptions {
  readonly homeDir: string;
}

export class PythinkerAuthFacade {
  private readonly tokens: OAuthTokenReader;

  constructor(options: PythinkerAuthFacadeOptions) {
    this.tokens = new OAuthTokenReader(options.homeDir);
  }

  getCachedAccessToken(oauthRef: OAuthRef): Promise<string | undefined> {
    return this.tokens.getCachedAccessToken(oauthRef);
  }

  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver = (providerName, oauthRef) =>
    this.tokens.resolveOAuthTokenProvider(providerName, oauthRef);
}
