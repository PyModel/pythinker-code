export { renderOpenAICodexOAuthSuccessPage } from './oauth-pages';

export {
  applyOpenAICodexOAuthConfig,
  buildOpenAICodexAuthorizeUrl,
  createOpenAICodexPkcePair,
  exchangeOpenAICodexAuthorizationCode,
  extractOpenAICodexAccountId,
  fetchOpenAICodexModels,
  OPENAI_CODEX_CLI_CLIENT_VERSION,
  OPENAI_CODEX_OAUTH_PLATFORM_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OAuthAccessDeniedError,
  OPENAI_CODEX_REDIRECT_URI,
  OpenAICodexApiError,
  parseOpenAICodexAuthorizationInput,
  runOpenAICodexOAuthFlow,
  startOpenAICodexCallbackServer,
} from './openai-codex-oauth';
export type {
  ApplyOpenAICodexOAuthResult,
  OpenAICodexCallbackResult,
  FetchOpenAICodexModelsOptions,
  OpenAICodexCallbackServer,
  OpenAICodexConfigShape,
  OpenAICodexModelInfo,
  OpenAICodexPkcePair,
  OpenAICodexTokenBundle,
  RunOpenAICodexOAuthFlowOptions,
} from './openai-codex-oauth';

export type { TokenInfo, TokenInfoWire } from './types';
export { tokenFromWire, tokenToWire } from './types';
export type { TokenStorage } from './storage';
export { FileTokenStorage, resolveOAuthTokenStorageName } from './storage';

export {
  DeviceCodeExpiredError,
  DeviceOAuthApiError,
  pollForDeviceToken,
  requestDeviceCode,
  runDeviceOAuthFlow,
} from './device-oauth';
export type {
  DeviceCodeInfo,
  PollDeviceTokenOptions,
  RunDeviceOAuthFlowOptions,
} from './device-oauth';

export {
  applyKimiOAuthConfig,
  fetchKimiCodingModels,
  KIMI_CODING_BASE_URL,
  KIMI_CODING_PROVIDER_ID,
  KIMI_OAUTH_PLATFORM_ID,
  refreshKimiOAuthToken,
  runKimiOAuthFlow,
} from './kimi-oauth';
export type {
  ApplyKimiOAuthResult,
  KimiOAuthTokenBundle,
  RunKimiOAuthFlowOptions,
} from './kimi-oauth';

export {
  applyMiniMaxOAuthConfig,
  miniMaxCodingModels,
  minimaxCodingProviderId,
  minimaxOAuthPlatformId,
  minimaxRegionLabel,
  MINIMAX_OAUTH_PLATFORM_ID_CN,
  MINIMAX_OAUTH_PLATFORM_ID_GLOBAL,
  refreshMiniMaxOAuthToken,
  runMiniMaxOAuthFlow,
} from './minimax-oauth';
export type {
  ApplyMiniMaxOAuthResult,
  MiniMaxOAuthTokenBundle,
  MiniMaxRegion,
  RunMiniMaxOAuthFlowOptions,
} from './minimax-oauth';

export {
  assertPythinkerHostIdentity,
  createPythinkerDefaultHeaders,
  createPythinkerDeviceId,
  createPythinkerUserAgent,
  PYTHINKER_CODE_CUSTOM_HEADERS_ENV,
  PYTHINKER_CODE_PLATFORM,
  parsePythinkerCodeCustomHeaders,
  readPythinkerDeviceId,
  replaceUserAgentProduct,
} from './identity';
export type { PythinkerHostIdentity, PythinkerIdentityOptions } from './identity';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
  removeOpenPlatformConfig,
} from './open-platform';
export type { ApplyOpenPlatformResult, OpenPlatformDefinition } from './open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  fetchCustomRegistry,
  removeCustomRegistryProvider,
} from './custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistrySource,
  FetchCustomRegistryOptions,
} from './custom-registry';

export {
  parseModelProtocol,
  parseStringArray,
  parseSupportsThinkingType,
  parseThinkEfforts,
} from './provider-config';
export type {
  ModelAlias,
  ModelAliasOverrides,
  ModelProtocol,
  OAuthRef,
  OAuthRefInput,
  ProviderConfig,
  ProviderModelInfo,
  PythinkerConfigShape,
  SecondaryModelShape,
  ServiceConfig,
  ServicesConfig,
  SupportsThinkingType,
  ThinkingShape,
} from './provider-config';

export { refreshProviderModels } from './refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshResult,
} from './refreshProviderModels';

export type { OAuthTokenTransactionOptions } from './oauth-token-transaction';
export { OAuthTokenTransaction } from './oauth-token-transaction';

export {
  PYTHINKER_REGION_PROFILES,
  pythinkerCdnContentUrl,
  pythinkerRegionProfile,
  pythinkerRegionSchema,
  resolvePythinkerRegion,
} from './region';
export type { PythinkerRegion, PythinkerRegionProfile, ResolvePythinkerRegionOptions } from './region';

export {
  DeviceCodeTimeoutError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from './errors';

export type BearerTokenProvider = {
  getAccessToken(options?: { readonly force?: boolean; readonly signal?: AbortSignal }): Promise<string>;
};

export type OAuthRefreshOutcome =
  | { readonly kind: 'refreshed'; readonly success?: true }
  | { readonly kind: 'cached'; readonly success?: true }
  | { readonly kind: 'failed'; readonly success?: false; readonly error?: unknown; readonly reason?: string }
  | { readonly success: true }
  | { readonly success: false; readonly reason?: string };

export type ManagedPythinkerCodeModelInfo = import("./provider-config.js").ProviderModelInfo;

export type ManagedPythinkerConfigShape = import("./provider-config.js").PythinkerConfigShape & Record<string, unknown>;
export type DeviceAuthorization = {
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly userCode: string;
  readonly expiresIn?: number;
  readonly interval?: number;
};

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${String(days)}d`);
  if (hours) parts.push(`${String(hours)}h`);
  if (minutes) parts.push(`${String(minutes)}m`);
  if (secs && parts.length === 0) parts.push(`${String(secs)}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}
export function isManagedPythinkerCodeBaseUrl(baseUrl?: string): boolean {
  if (baseUrl === undefined || baseUrl.length === 0) return false;
  try {
    const candidate = normalizeBaseUrl(baseUrl);
    if (candidate === undefined) return false;
    const custom = process.env['CUSTOM_API_BASE_URL'];
    if (custom === undefined || custom.length === 0) return false;
    return normalizeBaseUrl(custom) === candidate;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}
export type ManagedQuota = {
  readonly entries?: readonly ManagedQuotaEntry[];
  readonly extraUsage?: any;
  readonly rows?: any;
  readonly usages?: any;
  readonly [key: string]: any;
};
export type ManagedQuotaEntry = {
  readonly name?: string;
  readonly used?: number;
  readonly limit?: number;
  readonly usedRatio?: number;
  readonly resetAt?: string | number;
  readonly [key: string]: any;
};
