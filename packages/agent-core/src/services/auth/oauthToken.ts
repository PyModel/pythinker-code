import { join } from 'node:path';

import { FileTokenStorage, resolveOAuthTokenStorageName } from '@pymodel/pythinker-code-oauth';

import type { OAuthRef } from '../../config';
import { ErrorCodes, PythinkerError } from '../../errors';
import type { OAuthTokenProviderResolver } from '../../session/provider-manager';

export class OAuthTokenReader {
  private readonly storage: FileTokenStorage;

  constructor(homeDir: string) {
    this.storage = new FileTokenStorage(join(homeDir, 'credentials'));
  }

  async getCachedAccessToken(oauthRef: OAuthRef): Promise<string | undefined> {
    if (oauthRef.storage !== 'file') return undefined;
    const token = await this.storage.load(resolveOAuthTokenStorageName(oauthRef.key));
    if (token === undefined || token.accessToken.trim().length === 0) return undefined;
    if (token.expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    return token.accessToken;
  }

  readonly resolveOAuthTokenProvider: OAuthTokenProviderResolver = (providerName, oauthRef) => {
    if (oauthRef === undefined || oauthRef.storage !== 'file') return undefined;
    return {
      getAccessToken: async () => {
        const token = await this.getCachedAccessToken(oauthRef);
        if (token !== undefined) return token;
        throw new PythinkerError(
          ErrorCodes.AUTH_LOGIN_REQUIRED,
          `OAuth provider "${providerName}" requires login before it can be used.`,
        );
      },
    };
  };
}
