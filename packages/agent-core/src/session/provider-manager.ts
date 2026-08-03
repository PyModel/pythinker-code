import type { Logger } from '#/logging/types';
import type { ProviderConfig as KosongProviderConfig, ModelCapability, ProviderRequestAuth } from '@pythoughts/kosong';
import {
  APIStatusError,
  createProvider,
  getModelCapability,
  UNKNOWN_CAPABILITY,
} from '@pythoughts/kosong';
import {
  inferAnthropicModelProfile,
  type AnthropicModelProfile,
} from '@pythoughts/kosong/providers/anthropic-profile';
import {
  resolveProviderApiKey,
  type ModelAlias,
  type OAuthRef,
  type ProviderConfig,
  type PythinkerConfig,
} from '../config';
import { ErrorCodes, isPythinkerError, PythinkerError } from '../errors';

export interface BearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export type OAuthTokenProviderResolver = (
  providerName: string,
  oauthRef?: OAuthRef,
) => BearerTokenProvider | undefined;

export interface ResolvedRuntimeProvider {
  readonly providerName: string;
  readonly provider: KosongProviderConfig;
  readonly modelCapabilities: ModelCapability;
  /** Declared 'always_thinking' capability — the model cannot disable thinking. */
  readonly alwaysThinking?: boolean;
  readonly maxOutputSize?: number;
}

interface ProviderManagerOptions {
  readonly config: PythinkerConfig | (() => PythinkerConfig);
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pythinkerRequestHeaders?: Record<string, string>;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly promptCacheKey?: string;
}

type AuthorizedRequest = <T>(
  request: (auth: ProviderRequestAuth) => Promise<T>,
) => Promise<T>;

export interface ModelProvider {
  readonly defaultModel?: string;
  resolveProviderConfig(model: string): ResolvedRuntimeProvider;
  resolveAuth?(model: string, options?: { readonly log?: Logger }): AuthorizedRequest | undefined;
}

export class SingleModelProvider implements ModelProvider {
  constructor(
    private readonly providerConfig: KosongProviderConfig,
    private readonly modelCapabilities: ModelCapability = UNKNOWN_CAPABILITY,
  ) {}

  get defaultModel(): string {
    return this.providerConfig.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.providerConfig.model) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by SingleModelProvider.`,
      );
    }
    return {
      modelCapabilities: this.modelCapabilities,
      providerName: 'single-model-provider',
      provider: this.providerConfig,
    };
  }
}

export class ProviderManager implements ModelProvider {
  constructor(private readonly options: ProviderManagerOptions) {}

  private get config(): PythinkerConfig {
    const { config } = this.options;
    return typeof config === 'function' ? config() : config;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    const alias = this.config.models?.[model];
    if (alias === undefined) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not configured in config.toml. Add a [models."${model}"] entry with max_context_size.`,
      );
    }

    const providerName = alias.provider ?? this.config.defaultProvider;
    if (providerName === undefined) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" must define a provider in config.toml.`,
      );
    }

    const providerConfig = this.config.providers[providerName];
    if (providerConfig === undefined) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Provider "${providerName}" for model "${model}" is not configured.`,
      );
    }

    if (!Number.isInteger(alias.maxContextSize) || alias.maxContextSize <= 0) {
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" must define a positive max_context_size in config.toml.`,
      );
    }

    const fastModeSupported = (alias.capabilities ?? []).some(
      // First-party providers advertise fast mode through kosong; gateways
      // and compatible endpoints must declare it per model in capabilities.
      (capability) => capability.trim().toLowerCase() === 'fast_mode',
    );
    const provider = toKosongProviderConfig(
      providerConfig,
      alias.model,
      this.options.pythinkerRequestHeaders,
      alias.maxOutputSize,
      alias.reasoningKey,
      this.options.promptCacheKey,
      alias.adaptiveThinking,
      alias.supportEfforts,
      alias.thinkingBudgets,
      fastModeSupported,
      this.options.env,
    );
    const anthropicProfile =
      providerConfig.type === 'anthropic'
        ? inferAnthropicModelProfile(alias.model)
        : undefined;

    return {
      providerName,
      provider,
      modelCapabilities: resolveModelCapabilities(alias, provider, anthropicProfile),
      alwaysThinking: (alias.capabilities ?? []).some(
        (c) => c.trim().toLowerCase() === 'always_thinking',
      ) || anthropicProfile?.canDisableThinking === false,
      maxOutputSize: alias.maxOutputSize,
    };
  }

  resolveAuth(
    model: string,
    options?: { readonly log?: Logger },
  ): AuthorizedRequest | undefined {
    const configuredProviderName =
      this.config.models?.[model]?.provider ?? this.config.defaultProvider;
    const configuredProvider =
      configuredProviderName === undefined
        ? undefined
        : this.config.providers[configuredProviderName];
    if (
      configuredProvider?.oauth !== undefined &&
      ((configuredProvider.apiKey?.trim().length ?? 0) > 0 ||
        configuredProvider.apiKeyEnvVar !== undefined)
    ) {
      // oauth + static credentials on the same provider makes request auth
      // ambiguous: provider construction would prefer the static key while
      // runtime auth resolves OAuth. Reject it before resolving either source.
      throw new PythinkerError(
        ErrorCodes.CONFIG_INVALID,
        `Provider "${configuredProviderName}" has both static API key configuration and oauth set in config.toml — they are mutually exclusive. Remove one.`,
      );
    }

    const { providerName } = this.resolveProviderConfig(model);
    const providerConfig = this.config.providers[providerName];
    if (providerConfig?.oauth === undefined) return undefined;

    const loginRequired = (cause?: unknown): PythinkerError =>
      new PythinkerError(
        ErrorCodes.AUTH_LOGIN_REQUIRED,
        `OAuth provider "${providerName}" requires login before it can be used.`,
        cause === undefined ? undefined : { cause },
      );

    const tokenProvider = this.options.resolveOAuthTokenProvider?.(providerName, providerConfig.oauth);
    if (tokenProvider === undefined) {
      return async () => {
        throw loginRequired();
      };
    }

    const log = options?.log;
    const fetchAuth = async (force: boolean): Promise<ProviderRequestAuth> => {
      let apiKey: string;
      try {
        apiKey = await tokenProvider.getAccessToken(force ? { force: true } : undefined);
      } catch (error) {
        // login-required is an expected state (the user must /login); don't
        // warn. Other failures (connection errors, etc.) are logged once for
        // diagnosis and then propagated — chatWithRetry does not retry them.
        if (!isPythinkerError(error) || error.code !== ErrorCodes.AUTH_LOGIN_REQUIRED) {
          log?.warn('oauth token fetch failed', { providerName, error });
        }
        throw error;
      }
      if (apiKey.trim().length === 0) throw loginRequired();
      return { apiKey };
    };

    return async (request) => {
      let auth = await fetchAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          return await request(auth);
        } catch (error) {
          if (!(error instanceof APIStatusError) || error.statusCode !== 401) throw error;
          if (refreshed) {
            throw new PythinkerError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth provider credentials were rejected. Send /login to login.',
              {
                cause: error,
                details: { statusCode: error.statusCode, requestId: error.requestId },
              },
            );
          }
          auth = await fetchAuth(true);
        }
      }
    };
  }
}

function resolveModelCapabilities(
  alias: ModelAlias,
  provider: KosongProviderConfig,
  anthropicProfile: AnthropicModelProfile | undefined,
): ModelCapability {
  const declared = new Set((alias.capabilities ?? []).map((c) => c.trim().toLowerCase()));
  const detected = getModelCapability(provider.type, provider.model);

  return {
    image_in: declared.has('image_in') || detected.image_in,
    video_in: declared.has('video_in') || detected.video_in,
    audio_in: declared.has('audio_in') || detected.audio_in,
    thinking:
      declared.has('thinking') ||
      declared.has('always_thinking') ||
      anthropicProfile !== undefined ||
      detected.thinking,
    tool_use: declared.has('tool_use') || detected.tool_use,
    fast_mode: createProvider(provider).supportsFastMode === true,
    max_context_tokens: alias.maxContextSize,
  };
}

function toKosongProviderConfig(
  provider: ProviderConfig,
  model: string,
  pythinkerRequestHeaders: Record<string, string> | undefined,
  maxOutputSize: number | undefined,
  reasoningKey: string | undefined,
  promptCacheKey: string | undefined,
  adaptiveThinking: boolean | undefined,
  supportEfforts: readonly string[] | undefined,
  thinkingBudgets: Readonly<Record<string, number>> | undefined,
  fastModeSupported: boolean,
  env: Readonly<Record<string, string | undefined>> | undefined,
): KosongProviderConfig {
  const apiKey = resolveProviderApiKey(provider, env);
  if (provider.apiKeyEnvVar !== undefined && apiKey === undefined) {
    throw new PythinkerError(
      ErrorCodes.CONFIG_INVALID,
      `Provider API key environment variable "${provider.apiKeyEnvVar}" is not set or is empty.`,
    );
  }

  switch (provider.type) {
    case 'anthropic':
      return {
        type: 'anthropic',
        model,
        baseUrl: providerValue(provider.baseUrl, provider.env, 'ANTHROPIC_BASE_URL'),
        apiKey,
        ...(maxOutputSize !== undefined ? { defaultMaxTokens: maxOutputSize } : {}),
        ...(adaptiveThinking !== undefined ? { adaptiveThinking } : {}),
        supportEfforts,
        thinkingBudgets,
        fastModeSupported,
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'openai':
      return {
        type: 'openai',
        model,
        baseUrl: providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL'),
        apiKey,
        reasoningKey,
        supportEfforts,
        fastModeSupported,
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'pythinker':
      return {
        type: 'pythinker',
        model,
        baseUrl: providerValue(provider.baseUrl, provider.env, 'PYTHINKER_BASE_URL'),
        apiKey,
        generationKwargs: { prompt_cache_key: promptCacheKey },
        ...defaultHeadersField({ ...pythinkerRequestHeaders, ...provider.customHeaders }),
      };
    case 'google-genai':
      return {
        type: 'google-genai',
        model,
        apiKey,
        supportEfforts,
        thinkingBudgets,
      };
    case 'openai_responses':
      return {
        type: 'openai_responses',
        model,
        baseUrl: providerValue(provider.baseUrl, provider.env, 'OPENAI_BASE_URL'),
        apiKey,
        supportEfforts,
        fastModeSupported,
        ...defaultHeadersField(provider.customHeaders),
      };
    case 'vertexai': {
      const useServiceAccount = hasVertexAIServiceEnv(provider);
      return {
        type: 'vertexai',
        model,
        vertexai: useServiceAccount,
        apiKey: useServiceAccount ? undefined : apiKey,
        project: vertexAIProject(provider),
        location: vertexAILocation(provider),
        supportEfforts,
        thinkingBudgets,
      };
    }
    default: {
      const exhaustive: never = provider.type;
      throw new PythinkerError(
        ErrorCodes.MODEL_CONFIG_INVALID,
        `Unsupported provider type: ${String(exhaustive)}`,
      );
    }
  }
}

// Returns a fresh `defaultHeaders` field for a kosong provider config so
// resolved instances never share a header object. Omits the key entirely when
// there are no headers — callers and tests rely on `'defaultHeaders' in provider`.
function defaultHeadersField(
  headers: Record<string, string> | undefined,
): { defaultHeaders?: Record<string, string> } {
  if (headers === undefined || Object.keys(headers).length === 0) return {};
  return { defaultHeaders: { ...headers } };
}

function hasVertexAIServiceEnv(provider: ProviderConfig): boolean {
  return vertexAIProject(provider) !== undefined && vertexAILocation(provider) !== undefined;
}

function vertexAIProject(provider: ProviderConfig): string | undefined {
  return envValue(provider.env, 'GOOGLE_CLOUD_PROJECT');
}

function vertexAILocation(provider: ProviderConfig): string | undefined {
  return (
    envValue(provider.env, 'GOOGLE_CLOUD_LOCATION') ??
    locationFromVertexAIBaseUrl(provider.baseUrl)
  );
}

function providerValue(
  configured: string | undefined,
  env: Record<string, string> | undefined,
  envKey: string,
): string | undefined {
  return nonEmptyString(configured) ?? envValue(env, envKey);
}

function envValue(env: Record<string, string> | undefined, key: string): string | undefined {
  return nonEmptyString(env?.[key]);
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function locationFromVertexAIBaseUrl(baseUrl: string | undefined): string | undefined {
  const url = nonEmptyString(baseUrl);
  if (url === undefined) return undefined;
  try {
    const host = new URL(url).hostname;
    const suffix = '-aiplatform.googleapis.com';
    return host.endsWith(suffix) ? nonEmptyString(host.slice(0, -suffix.length)) : undefined;
  } catch {
    return undefined;
  }
}
