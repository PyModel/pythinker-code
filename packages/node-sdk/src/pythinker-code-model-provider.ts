import {
  ErrorCodes,
  PythinkerError,
  resolvePythinkerHome,
  type Logger,
  type ModelProvider,
  type ResolvedRuntimeProvider,
} from '@pythoughts/agent-core';
import {
  createPythinkerDefaultHeaders,
  KIMI_CODE_FLOW_CONFIG,
  KIMI_CODE_PROVIDER_NAME,
  PythinkerOAuthToolkit,
  kimiCodeBaseUrl,
  resolveKimiCodeOAuthRef,
  type PythinkerHostIdentity,
  type ManagedKimiOAuthRef,
} from '@pythoughts/pythinker-code-oauth';
import type {
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@pythoughts/kosong';
import { APIStatusError, UNKNOWN_CAPABILITY } from '@pythoughts/kosong';

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
  private readonly oauthRef: ManagedKimiOAuthRef;

  constructor(options: PythinkerForCodingProviderOptions) {
    this.model = options.model ?? 'pythinker-for-coding';
    this.baseUrl = options.baseUrl ?? kimiCodeBaseUrl();
    this.promptCacheKey = options.promptCacheKey;
    this.defaultHeaders = options.defaultHeaders;
    this.homeDir = resolvePythinkerHome(options.homeDir);
    this.identity = {
      userAgentProduct: options.userAgentProduct,
      version: options.version,
      userAgentSuffix: options.userAgentSuffix,
    };
    this.oauthRef = resolveKimiCodeOAuthRef({
      oauthHost: KIMI_CODE_FLOW_CONFIG.oauthHost,
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
        ...createPythinkerDefaultHeaders({
          homeDir: this.homeDir,
          ...this.identity,
        }),
        ...this.defaultHeaders,
      },
    };

    return {
      providerName: 'pythinker-for-coding',
      provider,
      modelCapabilities: UNKNOWN_CAPABILITY,
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
      const apiKey = await this.toolkit.ensureFresh(KIMI_CODE_PROVIDER_NAME, {
        force,
        oauthRef: this.oauthRef,
      });
      return { apiKey };
    } catch (error) {
      // Classify OAuth token failures into the public PythinkerError protocol so the
      // turn surfaces `auth.login_required` / `provider.connection_error`
      // instead of collapsing everything to `internal`. Unrecognized errors are
      // rethrown raw (see mapOAuthTokenError).
      throw mapOAuthTokenError(error, KIMI_CODE_PROVIDER_NAME) ?? error;
    }
  }
}
