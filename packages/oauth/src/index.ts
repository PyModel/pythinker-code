export { OAuthConnectionError, OAuthError, OAuthUnauthorizedError } from './errors';

export {
  renderOAuthErrorPage,
  renderOAuthSuccessPage,
  renderOpenAICodexOAuthSuccessPage,
} from './oauth-pages';

export {
  assertPythinkerHostIdentity,
  createPythinkerDefaultHeaders,
  createPythinkerDeviceId,
  createPythinkerUserAgent,
  PYTHINKER_CODE_PLATFORM,
  readPythinkerDeviceId,
} from './identity';
export type { PythinkerHostIdentity, PythinkerIdentityOptions } from './identity';

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
  OPENAI_CODEX_REDIRECT_URI,
  OpenAICodexApiError,
  parseOpenAICodexAuthorizationInput,
  runOpenAICodexOAuthFlow,
  startOpenAICodexCallbackServer,
} from './openai-codex-oauth';
export type {
  ApplyOpenAICodexOAuthResult,
  FetchOpenAICodexModelsOptions,
  OpenAICodexCallbackServer,
  OpenAICodexPkcePair,
  OpenAICodexTokenBundle,
  RunOpenAICodexOAuthFlowOptions,
} from './openai-codex-oauth';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OPENAI_CODEX_OAUTH_LOGIN,
  OpenPlatformApiError,
  parseSupportsThinkingType,
  removeOpenPlatformConfig,
} from './open-platform';
export type {
  ApplyOpenPlatformResult,
  LoginPlatformProviderType,
  OpenPlatformDefinition,
  PlatformConfigShape,
  PlatformModelAlias,
  PlatformModelInfo,
  PlatformProviderConfig,
  SupportsThinkingType,
} from './open-platform';

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
} from './custom-registry';
