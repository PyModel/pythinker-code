// Message types
export {
  createAssistantMessage,
  createToolMessage,
  createUserMessage,
  extractText,
  isContentPart,
  isToolCall,
  isToolCallPart,
  mergeInPlace,
} from './message';
export type {
  AudioURLPart,
  ContentPart,
  ImageURLPart,
  Message,
  Role,
  StreamedMessagePart,
  TextPart,
  ThinkPart,
  ToolCall,
  ToolCallPart,
  VideoURLPart,
} from './message';

// Provider interfaces
export * from './provider';
export { createProvider, getModelCapability } from './providers';
export type { ProviderConfig, ProviderType } from './providers';
// Pythinker provider: exported so callers can narrow a `ChatProvider` to the Pythinker
// backend (instanceof) and apply Pythinker-specific request params (generation
// kwargs, `thinking.keep` extra body).
export { PythinkerChatProvider } from './providers/pythinker';
export type { ExtraBody, GenerationKwargs, PythinkerOptions, ThinkingConfig } from './providers/pythinker';

// Model capability matrix
export { UNKNOWN_CAPABILITY, isUnknownCapability } from './capability';
export type { ModelCapability, ModelCostRates } from './capability';

// Model catalog (models.dev-style) metadata
export {
  catalogBaseUrl,
  catalogConnectionWire,
  catalogModelToCapability,
  catalogProviderModels,
  inferWireType,
} from './catalog';
export type { Catalog, CatalogModel, CatalogModelEntry, CatalogProviderEntry } from './catalog';

// Core functions
export { generate } from './generate';
export type { GenerateCallbacks, GenerateResult } from './generate';

// Tool wire schema
export type { Tool } from './tool';

// Token usage
export { addUsage, calculateCost, emptyUsage, grandTotal, inputTotal } from './usage';
export type { TokenUsage } from './usage';

// Errors
export {
  APIConnectionError,
  APIContextOverflowError,
  APIEmptyResponseError,
  APIProviderRateLimitError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
  isContextOverflowStatusError,
  isProviderRateLimitError,
  isRetryableGenerateError,
} from './errors';

/**
 * Concrete provider adapters stay off the root barrel because their SDK type
 * graphs pollute downstream declaration bundles. Import them from subpaths:
 * `@pythoughts/kosong/providers/pythinker`,
 * `@pythoughts/kosong/providers/openai-legacy`, etc.
 */
