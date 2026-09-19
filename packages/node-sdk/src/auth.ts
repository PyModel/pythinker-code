import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  FileTokenStorage,
  refreshKimiOAuthToken,
  refreshMiniMaxOAuthToken,
  resolveOAuthTokenStorageName,
  type TokenInfo,
} from '@pymodel/pythinker-code-oauth';

import type { OAuthRef } from '#/config/index';

const REFRESH_BUFFER_SECONDS = 5 * 60;

export interface BearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export type OAuthTokenProviderResolver = (
  providerName: string,
  oauthRef: OAuthRef | undefined,
) => BearerTokenProvider | undefined;

export interface PythinkerAuthFacadeOptions {
  readonly homeDir: string;
  readonly configPath?: string;
  readonly identity?: unknown;
  readonly onConfigUpdated?: ((config: unknown) => void) | undefined;
  readonly onRefresh?: ((outcome: import('@pymodel/pythinker-code-oauth').OAuthRefreshOutcome) => void) | undefined;
}

export class PythinkerAuthFacade {
  private readonly storage: FileTokenStorage;
  private readonly refreshInflight = new Map<string, Promise<TokenInfo>>();

  constructor(options: PythinkerAuthFacadeOptions) {
    this.storage = new FileTokenStorage(join(options.homeDir, 'credentials'));
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
      getAccessToken: async (options) => {
        const storageName = resolveOAuthTokenStorageName(oauthRef.key);
        const token = await this.storage.load(storageName);
        if (token === undefined || token.accessToken.trim().length === 0) {
          throw new Error(`login required for provider ${providerName}`);
        }
        const nowSeconds = Math.floor(Date.now() / 1000);
        const force = options?.force === true;
        if (!force && token.expiresAt - nowSeconds > REFRESH_BUFFER_SECONDS) return token.accessToken;
        if (token.refreshToken.trim().length === 0 || token.metadata?.['provider'] === undefined) {
          if (!force && token.expiresAt > nowSeconds) return token.accessToken;
          throw new Error(`login required for provider ${providerName}`);
        }
        try {
          return (await this.refreshSingleFlight(storageName, token)).accessToken;
        } catch (error) {
          const current = await this.storage.load(storageName);
          if (
            !force &&
            isDeepStrictEqual(current, token) &&
            token.expiresAt > Math.floor(Date.now() / 1000)
          ) {
            return token.accessToken;
          }
          throw error;
        }
      },
    };
  };

  private refreshSingleFlight(storageName: string, token: TokenInfo): Promise<TokenInfo> {
    const existing = this.refreshInflight.get(storageName);
    if (existing !== undefined) return existing;
    const refresh = this.refreshToken(token)
      .then(async (next) => {
        if (!(await this.storage.saveIfUnchanged(storageName, token, next))) {
          throw new Error(
            'OAuth credential changed during refresh. Retry with the current configuration.',
          );
        }
        return next;
      })
      .finally(() => {
        if (this.refreshInflight.get(storageName) === refresh) this.refreshInflight.delete(storageName);
      });
    this.refreshInflight.set(storageName, refresh);
    return refresh;
  }

  private async refreshToken(token: TokenInfo): Promise<TokenInfo> {
    const provider = token.metadata?.['provider'];
    if (provider === 'kimi' || provider === 'kimi-coding') {
      const deviceId = token.metadata?.['device_id'];
      if (deviceId === undefined || deviceId.trim().length === 0) {
        throw new Error('Kimi OAuth credential is missing device_id metadata.');
      }
      const refreshed = await refreshKimiOAuthToken(token.refreshToken, deviceId);
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: Math.floor(refreshed.expiresAtMs / 1000),
        expiresIn: Math.max(1, Math.floor((refreshed.expiresAtMs - Date.now()) / 1000)),
        scope: refreshed.scope,
        tokenType: refreshed.tokenType,
        metadata: token.metadata,
      };
    }
    if (provider === 'minimax' || provider === 'minimax-coding') {
      const region = token.metadata?.['region'];
      if (region !== 'global' && region !== 'cn') {
        throw new Error('MiniMax OAuth credential has invalid region metadata.');
      }
      const refreshed = await refreshMiniMaxOAuthToken(region, token.refreshToken);
      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: Math.floor(refreshed.expiresAtMs / 1000),
        expiresIn: Math.max(1, Math.floor((refreshed.expiresAtMs - Date.now()) / 1000)),
        scope: refreshed.scope,
        tokenType: refreshed.tokenType,
        metadata: token.metadata,
      };
    }
    throw new Error(`OAuth provider "${provider ?? 'unknown'}" does not support token refresh.`);
  }
}
