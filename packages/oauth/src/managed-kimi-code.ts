import { createHash } from 'node:crypto';

import { readApiErrorMessage } from './api-error';
import { DEFAULT_KIMI_CODE_OAUTH_HOST } from './constants';
import { OAuthUnauthorizedError } from './errors';
import { DEFAULT_KIMI_CODE_BASE_URL, kimiCodeBaseUrl } from './managed-usage';
import { isRecord } from './utils';

export const KIMI_CODE_PLATFORM_ID = 'kimi-code';
export const KIMI_CODE_PROVIDER_NAME = 'managed:kimi-code';
export const KIMI_CODE_OAUTH_KEY = 'oauth/kimi-code';
const KIMI_CODE_SCOPED_OAUTH_KEY_PREFIX = 'oauth/kimi-code-env-';

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

/**
 * Normalized model catalog entry returned by the managed Kimi Code
 * `/models` endpoint; raw snake_case server fields map to these camelCase
 * fields.
 */
export interface ManagedKimiCodeModelInfo {
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

export interface ManagedKimiCodeProvisionResult {
  readonly providerName: typeof KIMI_CODE_PROVIDER_NAME;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly models: readonly ManagedKimiCodeModelInfo[];
  readonly configPath?: string | undefined;
}

export interface FetchManagedKimiCodeModelsOptions {
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface ManagedKimiCodeApplyResult {
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
}

export interface ManagedKimiCodeCleanupResult {
  readonly providerName: typeof KIMI_CODE_PROVIDER_NAME;
  readonly removedProvider: boolean;
  readonly removedModels: readonly string[];
  readonly defaultModelCleared: boolean;
  readonly removedServices: readonly string[];
}

export interface ManagedKimiOAuthRef {
  readonly storage: 'file' | 'keyring';
  readonly key: string;
  readonly oauthHost?: string | undefined;
}

export interface ManagedKimiOAuthRefInput {
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
}

export interface ManagedKimiRuntimeAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthRef: ManagedKimiOAuthRef;
}

export interface ManagedKimiLoginAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly oauthRef?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiEnv {
  readonly PYTHINKER_CODE_BASE_URL?: string | undefined;
  readonly PYTHINKER_CODE_OAUTH_HOST?: string | undefined;
  readonly PYTHINKER_OAUTH_HOST?: string | undefined;
}

export class ManagedKimiCodeModelsAuthError extends OAuthUnauthorizedError {
  readonly status: number;
  readonly baseUrl: string;

  constructor(options: {
    readonly status: number;
    readonly baseUrl: string;
    readonly message: string;
  }) {
    super(
      `Kimi Code models endpoint ${options.baseUrl} rejected OAuth credentials: ${options.message}`,
    );
    this.name = 'ManagedKimiCodeModelsAuthError';
    this.status = options.status;
    this.baseUrl = options.baseUrl;
  }
}

export interface ManagedKimiProviderConfig {
  type: 'pythinker';
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities?: string[] | undefined;
  supportEfforts?: readonly string[];
  displayName?: string | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiServiceConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiServicesConfig {
  pythoughtsSearch?: ManagedKimiServiceConfig | undefined;
  pythoughtsFetch?: ManagedKimiServiceConfig | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiConfigShape {
  providers: Record<string, ManagedKimiProviderConfig | Record<string, unknown>>;
  models?: Record<string, ManagedKimiModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: boolean | undefined;
  thinking?: {
    mode?: 'auto' | 'on' | 'off';
    effort?: string;
  };
  services?: ManagedKimiServicesConfig | undefined;
  [key: string]: unknown;
}

export interface ManagedKimiConfigAdapter<TConfig> {
  read(): Promise<TConfig> | TConfig;
  write(config: TConfig): Promise<void> | void;
  apply(
    config: TConfig,
    input: {
      readonly models: readonly ManagedKimiCodeModelInfo[];
      readonly baseUrl?: string | undefined;
      readonly oauthKey?: string | undefined;
      readonly oauthHost?: string | undefined;
      readonly preserveDefaultModel?: boolean | undefined;
    },
  ): ManagedKimiCodeApplyResult;
  remove?(config: TConfig): void;
  readonly configPath?: string | undefined;
}

export interface ProvisionManagedKimiCodeConfigOptions<TConfig> {
  readonly adapter: ManagedKimiConfigAdapter<TConfig>;
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly preserveDefaultModel?: boolean | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

function managedModelKey(modelId: string): string {
  return `${KIMI_CODE_PLATFORM_ID}/${modelId}`;
}

interface SelectedDefaultModel {
  readonly modelKey: string;
  readonly thinking: boolean;
}

function capabilitiesForModel(model: ManagedKimiCodeModelInfo): string[] | undefined {
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

function defaultBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? kimiCodeBaseUrl()).replace(/\/+$/, '');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function persistedOAuthHost(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
}): string | undefined {
  const oauthHost = options.oauthHost;
  const normalized = normalizeEndpoint(oauthHost ?? DEFAULT_KIMI_CODE_OAUTH_HOST);
  if (
    options.key === KIMI_CODE_OAUTH_KEY &&
    normalized === normalizeEndpoint(DEFAULT_KIMI_CODE_OAUTH_HOST)
  ) {
    return undefined;
  }
  return normalized;
}

function managedOAuthRef(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly storage?: 'file' | 'keyring' | undefined;
}): ManagedKimiOAuthRef {
  const oauthHost = persistedOAuthHost(options);
  return {
    storage: options.storage ?? 'file',
    key: options.key,
    oauthHost,
  };
}

function configuredOAuthRef(
  oauthRef: ManagedKimiOAuthRefInput | undefined,
): ManagedKimiOAuthRef | undefined {
  if (oauthRef === undefined) return undefined;
  const key = oauthRef.key;
  if (key === undefined) return undefined;
  return managedOAuthRef({
    storage: oauthRef.storage,
    key,
    oauthHost: oauthRef.oauthHost,
  });
}

/**
 * Managed Kimi Code base URL from the environment.
 */
export function kimiCodeEnvBaseUrl(env: ManagedKimiEnv = process.env): string | undefined {
  return env.PYTHINKER_CODE_BASE_URL;
}

/**
 * Managed Kimi Code OAuth host from the environment.
 */
export function kimiCodeEnvOAuthHost(env: ManagedKimiEnv = process.env): string | undefined {
  return env.PYTHINKER_CODE_OAUTH_HOST ?? env.PYTHINKER_OAUTH_HOST;
}

/**
 * Returns the credential-storage key for an (oauthHost, baseUrl) pair: the
 * global slot for defaults, otherwise a hash-scoped per-environment slot.
 */
export function resolveKimiCodeOAuthKey(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): string {
  const oauthHost = normalizeEndpoint(options.oauthHost ?? DEFAULT_KIMI_CODE_OAUTH_HOST);
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const defaultOauthHost = normalizeEndpoint(DEFAULT_KIMI_CODE_OAUTH_HOST);
  const defaultApiBaseUrl = normalizeEndpoint(DEFAULT_KIMI_CODE_BASE_URL);

  if (oauthHost === defaultOauthHost && baseUrl === defaultApiBaseUrl) {
    return KIMI_CODE_OAUTH_KEY;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ oauthHost, baseUrl }))
    .digest('hex')
    .slice(0, 16);
  return `${KIMI_CODE_SCOPED_OAUTH_KEY_PREFIX}${digest}`;
}

/**
 * Resolve the full managed-Kimi-Code OAuth ref (credential storage key +
 * persisted host) for an (oauthHost, baseUrl) environment.
 *
 * Single source of truth for "which credential slot does this environment map
 * to". Login, provisioning, and the runtime provider all derive their ref
 * through here, so the slot a token is written to always matches the slot it
 * is later read from — preventing the env-mismatch credential mix-ups this
 * scoping is meant to fix.
 */
export function resolveKimiCodeOAuthRef(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): ManagedKimiOAuthRef {
  return managedOAuthRef({
    key: resolveKimiCodeOAuthKey(options),
    oauthHost: options.oauthHost,
  });
}

/**
 * Combines the configured base URL and OAuth ref with any env overrides into
 * the runtime auth the managed provider should use, migrating to the env's
 * credential slot when they disagree.
 */
export function resolveKimiCodeRuntimeAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedKimiOAuthRefInput | undefined;
  readonly env?: ManagedKimiEnv | undefined;
}): ManagedKimiRuntimeAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = kimiCodeEnvBaseUrl(env);
  const envOAuthHost = kimiCodeEnvOAuthHost(env);
  const hasEnvOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
  const baseUrl =
    envBaseUrl !== undefined ? normalizeBaseUrl(envBaseUrl) : options.configuredBaseUrl;
  const expected = resolveKimiCodeOAuthRef({
    oauthHost: hasEnvOverride ? envOAuthHost : options.configuredOAuthRef?.oauthHost,
    baseUrl,
  });
  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthRef: expected };
  if (hasEnvOverride) return { baseUrl, oauthRef: expected };
  if (configured.key !== expected.key) return { baseUrl, oauthRef: expected };
  return { baseUrl, oauthRef: configured };
}

/**
 * Resolves the auth inputs for the login flow: explicit request options win,
 * then env overrides, then the configured ref validated against the key the
 * resolved base URL implies.
 */
export function resolveKimiCodeLoginAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedKimiOAuthRefInput | undefined;
  readonly requestedBaseUrl?: string | undefined;
  readonly requestedOAuthHost?: string | undefined;
  readonly env?: ManagedKimiEnv | undefined;
}): ManagedKimiLoginAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = kimiCodeEnvBaseUrl(env);
  const envOAuthHost = kimiCodeEnvOAuthHost(env);
  const hasOverride =
    options.requestedBaseUrl !== undefined ||
    options.requestedOAuthHost !== undefined ||
    envBaseUrl !== undefined ||
    envOAuthHost !== undefined;
  const baseUrl =
    options.requestedBaseUrl !== undefined
      ? normalizeBaseUrl(options.requestedBaseUrl)
      : envBaseUrl !== undefined
        ? normalizeBaseUrl(envBaseUrl)
        : options.configuredBaseUrl;
  const oauthHost = options.requestedOAuthHost ?? envOAuthHost;
  if (hasOverride) return { baseUrl, oauthHost };

  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthHost };
  const expectedKey = resolveKimiCodeOAuthKey({
    oauthHost: configured.oauthHost,
    baseUrl,
  });
  return configured.key === expectedKey
    ? { baseUrl, oauthHost, oauthRef: configured }
    : { baseUrl, oauthHost };
}

function toModelInfo(item: unknown): ManagedKimiCodeModelInfo | undefined {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) {
    return undefined;
  }
  const contextLength = Number(item['context_length']);
  if (!Number.isInteger(contextLength) || contextLength <= 0) {
    throw new Error(`Kimi Code model "${item['id']}" must include a positive context_length.`);
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

// Unknown or missing values resolve to undefined so the field is simply absent
// for older servers instead of being guessed.
function parseSupportedReasoningEfforts(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const efforts = value.filter((effort): effort is string => typeof effort === 'string');
  return efforts.length > 0 ? efforts : undefined;
}

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

/**
 * Lists the managed Kimi Code models for an access token. Throws
 * ManagedKimiCodeModelsAuthError on 401/402/403 so callers can trigger
 * re-login.
 */
export async function fetchManagedKimiCodeModels(
  options: FetchManagedKimiCodeModelsOptions,
): Promise<ManagedKimiCodeModelInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const response = await fetchImpl(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await readApiErrorMessage(
      response,
      `Failed to list Kimi Code models (HTTP ${response.status}).`,
    );
    if (response.status === 401 || response.status === 402 || response.status === 403) {
      throw new ManagedKimiCodeModelsAuthError({
        status: response.status,
        baseUrl,
        message,
      });
    }
    throw new Error(message);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error(`Unexpected models response for ${baseUrl}.`);
  }
  return payload['data']
    .map((item) => toModelInfo(item))
    .filter((item): item is ManagedKimiCodeModelInfo => item !== undefined);
}

/**
 * Writes the managed provider, its model aliases, services, and a default
 * model into the config in place. The current default is preserved when
 * preserveDefaultModel is set and it still exists in the new catalog.
 */
export function applyManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
  options: {
    readonly models: readonly ManagedKimiCodeModelInfo[];
    readonly baseUrl?: string | undefined;
    readonly oauthKey?: string | undefined;
    readonly oauthHost?: string | undefined;
    readonly preserveDefaultModel?: boolean | undefined;
  },
): ManagedKimiCodeApplyResult {
  if (options.models.length === 0) {
    throw new Error('No models available for Kimi Code.');
  }
  for (const model of options.models) {
    assertPositiveContextLength(model);
  }

  const baseUrl = defaultBaseUrl(options.baseUrl);
  const oauth =
    options.oauthKey !== undefined
      ? managedOAuthRef({ key: options.oauthKey, oauthHost: options.oauthHost })
      : resolveKimiCodeOAuthRef({ baseUrl, oauthHost: options.oauthHost });
  const existingModels = config.models ?? {};
  const selectedDefault = selectDefaultModel(config, options.models, {
    preserveExisting: options.preserveDefaultModel === true,
  });

  config.providers[KIMI_CODE_PROVIDER_NAME] = {
    type: 'pythinker',
    baseUrl,
    apiKey: '',
    oauth,
  };

  for (const [key, model] of Object.entries(existingModels)) {
    if (isRecord(model) && model['provider'] === KIMI_CODE_PROVIDER_NAME) {
      delete existingModels[key];
    }
  }
  for (const model of options.models) {
    const capabilities = capabilitiesForModel(model);
    existingModels[managedModelKey(model.id)] = {
      provider: KIMI_CODE_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.contextLength,
      capabilities,
      supportEfforts:
        model.supportedReasoningEfforts !== undefined
          ? [...model.supportedReasoningEfforts]
          : undefined,
      displayName: model.displayName,
    };
  }

  config.models = existingModels;
  config.defaultModel = selectedDefault.modelKey;
  config.defaultThinking = selectedDefault.thinking;
  config.services = {
    pythoughtsSearch: {
      baseUrl: `${baseUrl}/search`,
      apiKey: '',
      oauth,
    },
    pythoughtsFetch: {
      baseUrl: `${baseUrl}/fetch`,
      apiKey: '',
      oauth,
    },
  };

  return {
    defaultModel: selectedDefault.modelKey,
    defaultThinking: selectedDefault.thinking,
  };
}

/**
 * Removes the managed provider and its aliases/services from the config,
 * clearing defaults that pointed at them.
 */
export function applyManagedKimiCodeLogoutConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[KIMI_CODE_PROVIDER_NAME];

  let removedDefaultModel = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== KIMI_CODE_PROVIDER_NAME) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefaultModel = true;
  }
  config.models = existingModels;

  if (removedDefaultModel) {
    config.defaultModel = undefined;
  }

  if (config['defaultProvider'] === KIMI_CODE_PROVIDER_NAME) {
    config['defaultProvider'] = undefined;
  }

  if (config.services !== undefined) {
    delete config.services.pythoughtsSearch;
    delete config.services.pythoughtsFetch;
    if (Object.keys(config.services).length === 0) {
      config.services = undefined;
    }
  }
}

// The server's three-state declaration overrides any stale defaultThinking
// being preserved from an earlier config: an always-thinking model ('only')
// must never end up with thinking off, and a non-thinking model ('no') must
// never end up with thinking on.
function forcedThinking(
  model: ManagedKimiCodeModelInfo | undefined,
  fallback: boolean,
): boolean {
  if (model?.supportsThinkingType === 'only') return true;
  if (model?.supportsThinkingType === 'no') return false;
  return fallback;
}

function selectDefaultModel(
  config: ManagedKimiConfigShape,
  models: readonly ManagedKimiCodeModelInfo[],
  options: { readonly preserveExisting: boolean },
): SelectedDefaultModel {
  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error('No models available for Kimi Code.');
  }

  const managedModels = new Map(models.map((model) => [managedModelKey(model.id), model]));
  const existingModels = config.models ?? {};
  const currentDefault =
    typeof config.defaultModel === 'string' && config.defaultModel.length > 0
      ? config.defaultModel
      : undefined;

  if (
    options.preserveExisting &&
    currentDefault !== undefined &&
    canPreserveDefaultModel(existingModels, currentDefault, managedModels)
  ) {
    const preservedModel = managedModels.get(currentDefault);
    return {
      modelKey: currentDefault,
      thinking: forcedThinking(
        preservedModel,
        config.defaultThinking ?? preservedModel?.supportsReasoning ?? false,
      ),
    };
  }

  return {
    modelKey: managedModelKey(firstModel.id),
    thinking: forcedThinking(firstModel, config.defaultThinking ?? firstModel.supportsReasoning),
  };
}

function canPreserveDefaultModel(
  existingModels: Record<string, ManagedKimiModelAlias | Record<string, unknown>>,
  defaultModel: string,
  managedModels: ReadonlyMap<string, ManagedKimiCodeModelInfo>,
): boolean {
  if (managedModels.has(defaultModel)) return true;
  const existing = existingModels[defaultModel];
  return isRecord(existing) && existing['provider'] !== KIMI_CODE_PROVIDER_NAME;
}

/**
 * Removes the managed provider, model aliases, and services from the config
 * and reports what was actually removed.
 */
export function clearManagedKimiCodeConfig(
  config: ManagedKimiConfigShape,
): ManagedKimiCodeCleanupResult {
  const removedProvider = Object.hasOwn(config.providers, KIMI_CODE_PROVIDER_NAME);
  delete config.providers[KIMI_CODE_PROVIDER_NAME];

  const removedModels: string[] = [];
  const models = config.models;
  if (models !== undefined) {
    for (const [key, model] of Object.entries(models)) {
      if (!isRecord(model) || model['provider'] !== KIMI_CODE_PROVIDER_NAME) continue;
      delete models[key];
      removedModels.push(key);
    }
  }

  let defaultModelCleared = false;
  if (typeof config.defaultModel === 'string' && removedModels.includes(config.defaultModel)) {
    config.defaultModel = undefined;
    defaultModelCleared = true;
  }

  const removedServices: string[] = [];
  if (config.services?.pythoughtsSearch !== undefined) {
    delete config.services.pythoughtsSearch;
    removedServices.push('pythoughtsSearch');
  }
  if (config.services?.pythoughtsFetch !== undefined) {
    delete config.services.pythoughtsFetch;
    removedServices.push('pythoughtsFetch');
  }
  if (config.services !== undefined && Object.keys(config.services).length === 0) {
    config.services = undefined;
  }

  return {
    providerName: KIMI_CODE_PROVIDER_NAME,
    removedProvider,
    removedModels,
    defaultModelCleared,
    removedServices,
  };
}

function assertPositiveContextLength(model: ManagedKimiCodeModelInfo): void {
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new Error(`Kimi Code model "${model.id}" must include a positive context_length.`);
  }
}

export async function provisionManagedKimiCodeConfigAfterLogin(
  options: ProvisionManagedKimiCodeConfigOptions<ManagedKimiConfigShape>,
): Promise<ManagedKimiCodeProvisionResult> {
  return provisionManagedKimiCodeConfig(options);
}

/**
 * Full login-completion flow: fetches models, applies the provider config via
 * the adapter, and persists it. Returns the provisioned provider summary.
 */
export async function provisionManagedKimiCodeConfig<TConfig>(
  options: ProvisionManagedKimiCodeConfigOptions<TConfig>,
): Promise<ManagedKimiCodeProvisionResult> {
  const models = await fetchManagedKimiCodeModels(options);
  const config = await options.adapter.read();
  const applied = options.adapter.apply(config, {
    models,
    baseUrl: options.baseUrl,
    oauthKey: options.oauthKey,
    oauthHost: options.oauthHost,
    preserveDefaultModel: options.preserveDefaultModel,
  });
  await options.adapter.write(config);
  return {
    providerName: KIMI_CODE_PROVIDER_NAME,
    defaultModel: applied.defaultModel,
    defaultThinking: applied.defaultThinking,
    models,
    configPath: options.adapter.configPath,
  };
}
