import { readApiErrorMessage } from './api-error';
import { isRecord } from './utils';

export type LoginPlatformProviderType = 'pythinker' | 'openai' | 'anthropic' | 'openai_responses';

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

/**
 * A model as a login platform describes it, normalized from the platform's
 * `/models` response (snake_case on the wire) or from a models.dev catalog
 * entry. Shared by every platform: API-key platforms, the OpenAI Codex OAuth
 * login, and the custom api.json registry.
 */
export interface PlatformModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning: boolean;
  readonly supportedReasoningEfforts?: readonly string[];
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly supportsToolUse?: boolean;
  readonly supportsFastMode?: boolean;
  readonly supportsThinkingType?: SupportsThinkingType;
  readonly displayName?: string | undefined;
}

export interface PlatformProviderConfig {
  type: LoginPlatformProviderType;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  readonly [key: string]: unknown;
}

export interface PlatformModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities?: string[] | undefined;
  supportEfforts?: readonly string[];
  displayName?: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * The slice of the on-disk config a login writes. Structural rather than
 * imported from `agent-core` so this package stays dependency-free.
 */
export interface PlatformConfigShape {
  providers: Record<string, PlatformProviderConfig | Record<string, unknown>>;
  models?: Record<string, PlatformModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: boolean | undefined;
  thinking?: {
    mode?: 'auto' | 'on' | 'off';
    effort?: string;
  };
  [key: string]: unknown;
}

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

// Unknown or missing values resolve to undefined so the field is simply absent
// for older servers instead of being guessed.
function parseSupportedReasoningEfforts(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = value.filter((effort): effort is string => typeof effort === 'string');
  return efforts.length > 0 ? efforts : undefined;
}

/**
 * A platform the user can add with an API key. Models are fetched from the
 * remote `/models` endpoint at `baseUrl`, or from a models.dev catalog when
 * `catalogProviderId` is set.
 */
export interface OpenPlatformDefinition {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string | undefined;
  readonly consoleUrl?: string | undefined;
  readonly allowedPrefixes?: readonly string[] | undefined;
  readonly providerType?: LoginPlatformProviderType | undefined;
  /** When set, models are loaded from models.dev instead of the remote /models endpoint. */
  readonly catalogProviderId?: string | undefined;
  /** Fallback context length for OpenAI-compatible /models responses without context_length. */
  readonly defaultContextLength?: number | undefined;
}

export const OPENAI_CODEX_OAUTH_LOGIN = {
  id: 'openai-codex-oauth',
  name: 'OpenAI Codex (OAuth)',
} as const;

export const OPEN_PLATFORMS: readonly OpenPlatformDefinition[] = [
  {
    id: 'moonshot-cn',
    name: 'Kimi Platform (API key · platform.kimi.com)',
    baseUrl: 'https://api.moonshot.cn/v1',
    consoleUrl: 'https://platform.kimi.com',
    allowedPrefixes: ['kimi-k'],
    providerType: 'pythinker',
  },
  {
    id: 'moonshot-ai',
    name: 'Kimi Platform (API key · platform.kimi.ai)',
    baseUrl: 'https://api.moonshot.ai/v1',
    consoleUrl: 'https://platform.kimi.ai',
    allowedPrefixes: ['kimi-k'],
    providerType: 'pythinker',
  },
  {
    id: 'openai-api',
    name: 'OpenAI (API key)',
    consoleUrl: 'https://platform.openai.com',
    catalogProviderId: 'openai',
    providerType: 'openai',
  },
  {
    id: 'anthropic-api',
    name: 'Anthropic (API key)',
    consoleUrl: 'https://console.anthropic.com',
    catalogProviderId: 'anthropic',
    providerType: 'anthropic',
  },
  {
    id: 'glm-zai-coding',
    name: 'GLM Z.ai Coding Plan (API key)',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    consoleUrl: 'https://z.ai',
    allowedPrefixes: ['glm-'],
    providerType: 'openai',
    defaultContextLength: 256_000,
  },
  {
    id: 'glm-cn-coding',
    name: 'GLM Coding Plan · China (API key)',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    consoleUrl: 'https://open.bigmodel.cn',
    allowedPrefixes: ['glm-'],
    providerType: 'openai',
    defaultContextLength: 256_000,
  },
  {
    id: 'minimax-token',
    name: 'MiniMax Token Plan (API key)',
    baseUrl: 'https://api.minimax.io/v1',
    consoleUrl: 'https://platform.minimax.io',
    allowedPrefixes: ['MiniMax-', 'minimax-'],
    providerType: 'openai',
    defaultContextLength: 512_000,
  },
];

export function getOpenPlatformById(id: string): OpenPlatformDefinition | undefined {
  return OPEN_PLATFORMS.find((p) => p.id === id);
}

export function isOpenPlatformId(id: string): boolean {
  return OPEN_PLATFORMS.some((p) => p.id === id);
}

function toModelInfo(
  item: unknown,
  platform: OpenPlatformDefinition,
): PlatformModelInfo | undefined {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) {
    return undefined;
  }
  let contextLength = Number(item['context_length']);
  if (!Number.isInteger(contextLength) || contextLength <= 0) {
    const fallback = platform.defaultContextLength;
    if (fallback === undefined || fallback <= 0) {
      return undefined;
    }
    contextLength = fallback;
  }
  const displayName = item['display_name'];
  const normalizedDisplayName =
    typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined;
  const supportsToolUse = Object.hasOwn(item, 'supports_tool_use')
    ? Boolean(item['supports_tool_use'])
    : true;
  return {
    id: item['id'],
    contextLength,
    supportsReasoning: Boolean(item['supports_reasoning']),
    supportsImageIn: Boolean(item['supports_image_in']),
    supportsVideoIn: Boolean(item['supports_video_in']),
    supportsToolUse,
    supportsFastMode: Boolean(item['supports_fast_mode']),
    supportsThinkingType: parseSupportsThinkingType(item['supports_thinking_type']),
    supportedReasoningEfforts: parseSupportedReasoningEfforts(item['supported_reasoning_efforts']),
    displayName: normalizedDisplayName,
  };
}

/**
 * Derives kosong capability strings from a model info entry; undefined when
 * the model declares no capabilities.
 */
export function capabilitiesForModel(model: PlatformModelInfo): string[] | undefined {
  const caps = new Set<string>();
  // supports_thinking_type is the full three-state declaration and wins over
  // the legacy supports_reasoning boolean; absent (older servers) falls back.
  switch (model.supportsThinkingType) {
    case 'only':
      caps.add('thinking');
      caps.add('always_thinking');
      break;
    case 'both':
      caps.add('thinking');
      break;
    case 'no':
      break;
    case undefined:
      if (model.supportsReasoning) caps.add('thinking');
      break;
  }
  if (model.supportsImageIn) caps.add('image_in');
  if (model.supportsVideoIn) caps.add('video_in');
  if (model.supportsToolUse ?? true) caps.add('tool_use');
  // Fast mode is opt-in: only add the capability when the server explicitly
  // declares support (unlike tool_use, which defaults to true).
  if (model.supportsFastMode === true) caps.add('fast_mode');
  return caps.size > 0 ? [...caps] : undefined;
}

export class OpenPlatformApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Fetches and normalizes the platform's `/models` response. Models without a
 * usable context length are skipped unless the platform defines a
 * defaultContextLength fallback.
 */
export async function fetchOpenPlatformModels(
  platform: OpenPlatformDefinition,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PlatformModelInfo[]> {
  const baseUrl = platform.baseUrl;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error(`Platform "${platform.id}" has no baseUrl for remote model listing.`);
  }
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal,
  });
  if (!res.ok) {
    throw new OpenPlatformApiError(
      await readApiErrorMessage(res, `Failed to list models (HTTP ${res.status}).`),
      res.status,
    );
  }
  const payload: unknown = await res.json();
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error(`Unexpected models response for ${platform.baseUrl}.`);
  }
  return payload['data']
    .map((item) => toModelInfo(item, platform))
    .filter((item): item is PlatformModelInfo => item !== undefined);
}

/**
 * Keeps only models whose id starts with one of the platform's allowed
 * prefixes; returns the full list when no prefixes are configured.
 */
export function filterModelsByPrefix(
  models: PlatformModelInfo[],
  platform: OpenPlatformDefinition,
): PlatformModelInfo[] {
  if (!platform.allowedPrefixes || platform.allowedPrefixes.length === 0) {
    return models;
  }
  const prefixes = platform.allowedPrefixes;
  return models.filter((m) => prefixes.some((p) => m.id.startsWith(p)));
}

export interface ApplyOpenPlatformResult {
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
}

/**
 * Writes the platform provider and its model aliases into the config in
 * place, replacing any earlier state for the same platform and resetting the
 * default model to the selected one.
 */
export function applyOpenPlatformConfig(
  config: PlatformConfigShape,
  options: {
    readonly platform: OpenPlatformDefinition;
    readonly models: readonly PlatformModelInfo[];
    readonly selectedModel: PlatformModelInfo;
    readonly thinking: boolean;
    /** The effort level the user picked; only the on/off bit persists without it. */
    readonly effort?: string;
    readonly apiKey: string;
  },
): ApplyOpenPlatformResult {
  const providerKey = options.platform.id;
  const modelKey = `${providerKey}/${options.selectedModel.id}`;

  config.providers[providerKey] = {
    type: options.platform.providerType ?? 'pythinker',
    baseUrl: options.platform.baseUrl,
    apiKey: options.apiKey,
  };

  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (isRecord(model) && model['provider'] === providerKey) {
      delete existingModels[key];
    }
  }

  for (const model of options.models) {
    const aliasKey = `${providerKey}/${model.id}`;
    existingModels[aliasKey] = {
      provider: providerKey,
      model: model.id,
      maxContextSize: model.contextLength,
      capabilities: capabilitiesForModel(model),
      displayName: model.displayName,
    };
  }

  config.models = existingModels;
  config.defaultModel = modelKey;
  config.defaultThinking = options.thinking;
  // defaultThinking is a boolean, so without this the picked level is lost and
  // the session reopens at 'high' regardless of what the user chose. 'off' is
  // written too rather than skipped: `setConfig` deep-merges and cannot delete a
  // key, so skipping it would leave a previous login's effort on disk.
  if (options.effort !== undefined) {
    config.thinking = { ...config.thinking, effort: options.effort };
  }

  return { defaultModel: modelKey, defaultThinking: options.thinking };
}

/**
 * Removes the platform provider and its model aliases, clearing defaults
 * that pointed at them.
 */
export function removeOpenPlatformConfig(
  config: PlatformConfigShape,
  platformId: string,
): void {
  delete config.providers[platformId];

  let removedDefault = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== platformId) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefault = true;
  }
  config.models = existingModels;

  if (removedDefault) {
    config.defaultModel = undefined;
  }

  if (config['defaultProvider'] === platformId) {
    config['defaultProvider'] = undefined;
  }
}
