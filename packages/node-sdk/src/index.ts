export { PythinkerHarness } from '#/pythinker-harness';
export type { PythinkerHarnessRuntimeOptions } from '#/pythinker-harness';
export { Session } from '#/session';
export { createPythinkerHarness, SDKRpcClient, type SDKRpcClientOptions } from '#/sdk-rpc-client';
export { runPythinkerMcpServer, type PythinkerMcpServerOptions } from '#/mcp-server';
export {
  createPythinkerConfigRpc,
  PythinkerConfigRpcClient,
  type PythinkerConfigRpc,
  type PythinkerConfigValidationIssue,
  type PythinkerConfigValidationPathSegment,
  type ResolvePythinkerConfigPathInput,
  type ValidatePythinkerConfigTomlInput,
} from '#/config-rpc';
export {
  SDKRpcClientBase,
  type SetSessionDynamicWorkflowModeRpcInput,
  type SetSessionFastModeRpcInput,
} from '#/rpc';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogConnectionWire,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  CatalogProviderError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  importCatalogProvider,
  inferWireType,
  loadBuiltInCatalog,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogModel,
  CatalogProviderEntry,
  CatalogProviderStore,
  ImportCatalogProviderOptions,
  ImportCatalogProviderResult,
} from '#/catalog';

export {
  renderSavedWorkflowSkill,
  resolveWorkflowSizeGuideline,
  savedWorkflowSkillDir,
  savedWorkflowSkillName,
  writeSavedWorkflowSkill,
} from '@pythoughts/agent-core';
export type { SavedWorkflow, SavedWorkflowScope, WorkflowSizeGuideline } from '@pythoughts/agent-core';
export { buildSkillSlashCommands, isUserActivatableSkill } from '#/skill-commands';
export type { SkillSlashCommand, SkillSlashCommands } from '#/skill-commands';

// Multi-provider login flows behind the LoginUi port, shared by every surface
// (CLI, TUI, VS Code extension).
export { formatErrorMessage, formatErrorPayload } from '#/error-format';
export {
  buildPlatformOptions,
  resolvePlatformOption,
  type PlatformOption,
} from '#/login/platform-options';
export {
  CATALOG_PLATFORM_VALUE_PREFIX,
  catalogProviderIdFromPlatformValue,
} from '#/login/platform-values';
export { connectCatalogProvider, runLogin } from '#/login/flows';
export { managedModelToAlias } from '#/login/model-alias';
export {
  CANONICAL_EFFORT_ORDER,
  coerceEffortForModel,
  DEFAULT_SUPPORTED_EFFORTS,
  effortLevelsForModel,
  thinkingAvailability,
  type ThinkingAvailability,
} from '#/thinking-levels';
export type {
  ApiKeyPromptOptions,
  LoginProgressSpinnerHandle,
  LoginUi,
  PlatformSelection,
} from '#/login/types';

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
} from '@pythoughts/agent-core';

// Diagnostic logging — public surface only.
// RootLogger / getRootLogger / LoggingConfig stay inside agent-core.
export {
  enableDiagnosticDebugLogging,
  flushDiagnosticLogs,
  log,
  redact,
  resolveGlobalLogPath,
  resolvePythinkerHome,
} from '@pythoughts/agent-core';
export type { LogContext, LogLevel, LogPayload, Logger } from '@pythoughts/agent-core';

// Host-side config helpers — safe config reader + config path resolution, used
// by hosts (e.g. the CLI's server telemetry bootstrap) that need to inspect
// config without spinning up a full PythinkerCore.
export { loadRuntimeConfigSafe, resolveConfigPath } from '@pythoughts/agent-core';

// Process-wide HTTP proxy bootstrap — installed once at CLI startup so all
// outbound fetch honors HTTP_PROXY / HTTPS_PROXY / NO_PROXY.
export { installGlobalProxyDispatcher } from '@pythoughts/agent-core';
export { findExistingRg, type RgResolution } from '@pythoughts/agent-core';
export { limitAgentReplayByTurns } from '@pythoughts/agent-core';

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
} from '@pythoughts/agent-core';


export * from '#/events';
export type * from '#/types';
