import {
  ErrorCodes,
  PythinkerError,
  resolvePythinkerHome,
  type Logger,
  type ModelProvider,
  type ResolvedRuntimeProvider,
} from '@pymodel/agent-core';
import {
  createPythinkerDefaultHeaders,
  PYTHINKER_CODE_FLOW_CONFIG,
  PYTHINKER_CODE_PROVIDER_NAME,
  PythinkerOAuthToolkit,
  pythinkerCodeBaseUrl,
  parsePythinkerCodeCustomHeaders,
  resolvePythinkerCodeOAuthRef,
  type PythinkerHostIdentity,
  type ManagedPythinkerOAuthRef,
} from '@pymodel/pythinker-code-oauth';
import type {
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@pymodel/kosong';
import { APIStatusError, UNKNOWN_CAPABILITY } from '@pymodel/kosong';

import { mapOAuthTokenError } from '#/oauth-error';

export interface PythinkerForCodingProviderOptions extends PythinkerHostIdentity {
  readonly homeDir?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly promptCacheKey?: string;
  readonly defaultHeaders?: Record<string, string>;
}

export class PythinkerForCodingProvider implements ModelProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly promptCacheKey: string | undefined;
  private readonly defaultHeaders: Record<string, string> | undefined;
  private readonly toolkit: PythinkerOAuthToolkit;
  private readonly homeDir: string;
  private readonly identity: PythinkerHostIdentity;
  private readonly oauthRef: ManagedPythinkerOAuthRef;

  constructor(options: PythinkerForCodingProviderOptions) {
    this.model = options.model ?? 'kimi-for-coding';
    this.baseUrl = options.baseUrl ?? pythinkerCodeBaseUrl();
    this.promptCacheKey = options.promptCacheKey;
    this.defaultHeaders = options.defaultHeaders;
    this.homeDir = resolvePythinkerHome(options.homeDir);
    this.identity = {
      productName: options.productName,
      version: options.version,
      platform: options.platform,
      userAgentSuffix: options.userAgentSuffix,
    };
    this.oauthRef = resolvePythinkerCodeOAuthRef({
      oauthHost: PYTHINKER_CODE_FLOW_CONFIG.oauthHost,
      baseUrl: this.baseUrl,
    });
    this.toolkit = new PythinkerOAuthToolkit({
      homeDir: this.homeDir,
      identity: this.identity,
    });
  }

  get defaultModel(): string {
    return this.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.model) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by PythinkerForCodingProvider.`,
      );
    }

    const provider: KosongProviderConfig = {
      type: 'pythinker',
      model: this.model,
      baseUrl: this.baseUrl,
      generationKwargs: this.promptCacheKey
        ? { prompt_cache_key: this.promptCacheKey }
        : undefined,
      defaultHeaders: {
        ...parsePythinkerCodeCustomHeaders(),
        ...createPythinkerDefaultHeaders({
          homeDir: this.homeDir,
          ...this.identity,
        }),
        ...this.defaultHeaders,
      },
    };

    return {
      providerName: 'kimi-for-coding',
      provider,
      modelCapabilities: UNKNOWN_CAPABILITY,
      type: 'pythinker',
      protocol: undefined,
    };
  }

  resolveAuth(_model: string, _options?: { readonly log?: Logger }) {
    return async <T>(request: (auth: ProviderRequestAuth) => Promise<T>): Promise<T> => {
      let auth = await this.buildAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          return await request(auth);
        } catch (error) {
          const is401 = error instanceof APIStatusError && error.statusCode === 401;
          if (!is401) throw error;
          if (refreshed) {
            throw new PythinkerError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth token was rejected after refresh. Run /login to re-authenticate.',
              { cause: error },
            );
          }
          auth = await this.buildAuth(true);
        }
      }
    };
  }

  private async buildAuth(force: boolean): Promise<ProviderRequestAuth> {
    try {
      const apiKey = await this.toolkit.ensureFresh(PYTHINKER_CODE_PROVIDER_NAME, {
        force,
        oauthRef: this.oauthRef,
      });
      return { apiKey };
    } catch (error) {
      // Classify OAuth token failures into the public PythinkerError protocol so the
      // turn surfaces `auth.login_required` / `provider.connection_error`
      // instead of collapsing everything to `internal`. Unrecognized errors are
      // rethrown raw (see mapOAuthTokenError).
      throw mapOAuthTokenError(error, PYTHINKER_CODE_PROVIDER_NAME) ?? error;
    }
  }
}
