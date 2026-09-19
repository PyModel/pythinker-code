export { PythinkerHarness } from '#/pythinker-harness';
export type { PythinkerHarnessRuntimeOptions } from '#/pythinker-harness';
export { Session } from '#/session';
export { PythinkerAuthFacade } from '#/auth';
export {
  createPythinkerHarness,
  SDKRpcClientV2,
  type SDKRpcClientV2Options,
} from '#/sdk-rpc-client-v2';
export {
  createPythinkerConfigRpc,
  PythinkerConfigRpcClient,
  type PythinkerConfigRpc,
  type PythinkerConfigValidationIssue,
  type PythinkerConfigValidationPathSegment,
  type ResolvePythinkerConfigPathInput,
  type ValidatePythinkerConfigTomlInput,
} from '#/config-rpc';
export { SDKRpcClientBase } from '#/rpc';
export { removeProviderFromConfig } from '#/v2/config-mapper';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  loadBuiltInCatalog,
  resolveCatalogImport,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogImportInvalidReason,
  CatalogImportResolution,
  CatalogModel,
  CatalogProviderEntry,
  FetchCatalogOptions,
} from '#/catalog';

export {
  ErrorCodes,
  PythinkerError,
  type PythinkerErrorCode,
  type PythinkerErrorInfo,
  type PythinkerErrorOptions,
  type PythinkerErrorPayload,
  PYTHINKER_ERROR_INFO,
  fromPythinkerErrorPayload,
  isPythinkerError,
  toPythinkerErrorPayload,
} from '#/errors';

export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  log,
  redact,
  resolveGlobalLogPath,
} from '#/logging/index';
export { resolvePythinkerHome } from '@pymodel/agent-core-v2';
export type { LogContext, LogLevel, LogPayload, Logger } from '#/logging/index';

export { effectiveModelAlias, loadRuntimeConfigSafe } from '#/config/index';
export { resolveConfigPath } from '@pymodel/agent-core-v2';
export { limitAgentReplayByTurns } from '#/replay';
export { parseAgentFileText, resolveAgentPath } from '@pymodel/agent-core-v2';
export { SECONDARY_DERIVED_MODEL_ALIAS } from '#/config/index';
export { PRIMARY_SUBAGENT_MODEL_CHOICE } from '@pymodel/agent-core-v2/session/subagent/configSection';

export { installGlobalProxyDispatcher } from '#/proxy';

export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@pymodel/agent-core-v2';
export { compressBase64ForModel, compressImageForModel, ImageLimits } from '#/image';
export type {
  CompressImageOptions,
  CompressImageResult,
  CompressBase64Result,
  ImageCompressionCaptionInput,
  ImageCompressionTelemetry,
} from '#/image';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '#/flag';

export {
  buildDaemonFileUrl,
  buildMediaPathTag,
  isDaemonFileUrl,
  matchSingleMediaPathTag,
  parseDaemonFileUrl,
} from '@pymodel/agent-core-v2/agent/media/mediaRef';
export type {
  DaemonFileRef,
  MediaKind,
} from '@pymodel/agent-core-v2/agent/media/mediaRef';


export * from '#/events';
export type * from '#/types';

export { coerceEffortForModel, effortLevelsForModel, thinkingAvailability, CANONICAL_EFFORT_ORDER, DEFAULT_SUPPORTED_EFFORTS } from '#/thinking-levels';

export { buildPlatformOptions, isOAuthPlatformId, catalogProviderIdFromPlatformValue } from '#/login/platform-options';
export type { PlatformOption, PlatformSelection } from '#/login/platform-options';

export { buildSkillSlashCommands, isUserActivatableSkill } from '#/skill-commands';
export type { SkillSlashCommand, SkillSlashCommands } from '#/skill-commands';

export { CatalogProviderError, importCatalogProvider } from '#/catalog';


export { runLogin } from '#/login/flows';
export { createPythinkerHarness as createPythinkerHarnessV2 } from '#/sdk-rpc-client-v2';
export { formatErrorMessage } from '#/error-format';
