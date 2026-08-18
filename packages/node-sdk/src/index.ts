export { PythinkerHarness } from '#/pythinker-harness';
export type { PythinkerHarnessRuntimeOptions } from '#/pythinker-harness';
export { Session } from '#/session';
export { PythinkerAuthFacade } from '#/auth';
export { createPythinkerHarness, SDKRpcClient, type SDKRpcClientOptions } from '#/sdk-rpc-client';
export {
  createPythinkerHarnessV2,
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
export { PythinkerForCodingProvider } from '#/pythinker-code-model-provider';
export type { PythinkerForCodingProviderOptions } from '#/pythinker-code-model-provider';
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
} from '@pymodel/agent-core';

// Diagnostic logging — public surface only.
// RootLogger / getRootLogger / LoggingConfig stay inside agent-core.
export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  log,
  redact,
  resolveGlobalLogPath,
  resolvePythinkerHome,
} from '@pymodel/agent-core';
export type { LogContext, LogLevel, LogPayload, Logger } from '@pymodel/agent-core';

// Host-side config helpers — safe config reader + config path resolution, used
// by hosts (e.g. the CLI's server telemetry bootstrap) that need to inspect
// config without spinning up a full PythinkerCore.
export { effectiveModelAlias, loadRuntimeConfigSafe, resolveConfigPath } from '@pymodel/agent-core';
export { limitAgentReplayByTurns } from '@pymodel/agent-core';
export { parseAgentFileText, resolveAgentPath } from '@pymodel/agent-core';
// The synthesized `[models]` alias a `[secondary_model]` recipe with patch
// fields materializes at runtime — hosts filter it out of model pickers.
export { SECONDARY_DERIVED_MODEL_ALIAS } from '@pymodel/agent-core';

// Process-wide HTTP proxy bootstrap — installed once at CLI startup so all
// outbound fetch honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
export { installGlobalProxyDispatcher } from '@pymodel/agent-core';

// Image compression — ingestion sites (e.g. the CLI's clipboard paste, the ACP
// adapter) shrink oversized images while constructing the content part, before
// it enters a prompt. Best effort: returns the original on any failure.
// Compression is never silent: buildImageCompressionCaption renders the note
// placed next to a compressed image, and persistOriginalImage keeps the
// pre-compression bytes readable (ReadMediaFile + region) for detail.
export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  compressImageForModel,
  compressBase64ForModel,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@pymodel/agent-core';
export { ImageLimits } from '@pymodel/agent-core';
export type {
  CompressImageOptions,
  CompressImageResult,
  CompressBase64Result,
  ImageCompressionCaptionInput,
  ImageCompressionTelemetry,
} from '@pymodel/agent-core';

// Experimental feature flags — types only. Resolved values come from
// `PythinkerHarness.getExperimentalFeatures()` over RPC, not from a re-exported runtime value.
export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '@pymodel/agent-core';

export type {
  PythinkerAuthCompleteFeedbackUploadInput,
  PythinkerAuthCompleteFeedbackUploadPart,
  PythinkerAuthCreateFeedbackUploadUrlInput,
  PythinkerAuthCreateFeedbackUploadUrlOk,
  PythinkerAuthCreateFeedbackUploadUrlResult,
  PythinkerAuthFeedbackUploadPart,
  PythinkerAuthLoginResult,
  PythinkerAuthLogoutResult,
  PythinkerAuthSubmitFeedbackInput,
} from '#/auth';

export * from '#/events';
export type * from '#/types';
