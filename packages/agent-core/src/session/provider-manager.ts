import type { Logger } from '#/logging/types';
import type { ProviderConfig as KosongProviderConfig, ModelCapability, ProviderRequestAuth } from '@pymodel/kosong';
import {
  createProvider,
  getModelCapability,
  UNKNOWN_CAPABILITY,
} from '@pymodel/kosong';
import {
  inferAnthropicModelProfile,
  type AnthropicModelProfile,
} from '@pymodel/kosong/providers/anthropic-profile';
import {
  resolveProviderApiKey,
  type ModelAlias,
  type ProviderConfig,
  type PythinkerConfig,
} from '../config';
import { ErrorCodes, PythinkerError } from '../errors';



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
