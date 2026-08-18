import type { PythinkerConfig, ModelAlias } from '@pymodel/agent-core';
import {
  catalogBaseUrl,
  catalogProviderModels,
  inferWireType,
  resolveCatalogImport,
  type Catalog,
  type CatalogImportInvalidReason,
  type CatalogImportResolution,
  type CatalogModel,
  type CatalogProviderEntry,
  type ModelCapability,
  type ProviderType,
} from '@pymodel/kosong';

export { catalogBaseUrl, catalogProviderModels, inferWireType, resolveCatalogImport };
export type { CatalogImportInvalidReason, CatalogImportResolution };
export type { Catalog, CatalogModel, CatalogProviderEntry };

export const DEFAULT_CATALOG_URL = 'https://models.dev/api.json';

export class CatalogFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface FetchCatalogOptions {
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly userAgent?: string;
}

/**
 * Fetches a models.dev-style catalog. Public endpoint, no credentials needed.
 * `userAgent` identifies the host product (e.g. `pythinker-code-cli/1.2.3`); when
 * omitted the request falls back to the runtime default (`User-Agent: node`).
 */
export async function fetchCatalog(
  url: string,
  options: FetchCatalogOptions = {},
): Promise<Catalog> {
  const { signal, fetchImpl = fetch, userAgent } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (userAgent !== undefined) headers['User-Agent'] = userAgent;
  const res = await fetchImpl(url, { headers, signal });
  if (!res.ok) {
    throw new CatalogFetchError(`Failed to fetch catalog (HTTP ${res.status}).`, res.status);
  }
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Unexpected catalog response from ${url}.`);
  }
  return payload as Catalog;
}

function capabilityToStrings(capability: ModelCapability): string[] | undefined {
  const caps: string[] = [];
  if (capability.image_in) caps.push('image_in');
  if (capability.video_in) caps.push('video_in');
  if (capability.audio_in) caps.push('audio_in');
  if (capability.thinking) caps.push('thinking');
  if (capability.tool_use) caps.push('tool_use');
  if (capability.dynamically_loaded_tools === true) caps.push('dynamically_loaded_tools');
  return caps.length > 0 ? caps : undefined;
}

/** Builds a pythinker-code model alias from a normalized catalog model. */
export function catalogModelToAlias(providerId: string, model: CatalogModel): ModelAlias {
  const caps = capabilityToStrings(model.capability);
  return {
    provider: providerId,
    model: model.id,
    maxContextSize: model.capability.max_context_tokens,
    maxInputSize: model.capability.max_input_tokens,
    maxOutputSize: model.maxOutputSize,
    // A model that always reasons advertises `always_thinking` instead of
    // `thinking`, so the UI locks thinking on and offers no off option.
    capabilities:
      model.alwaysThinking === true
        ? caps?.map((cap) => (cap === 'thinking' ? 'always_thinking' : cap))
        : caps,
    displayName: model.name,
    reasoningKey: model.reasoningKey,
    supportEfforts: model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
    offEffort: model.offEffort,
    protocol: model.protocol,
    baseUrl: model.baseUrl,
  };
}

export interface ApplyCatalogProviderOptions {
  readonly providerId: string;
  readonly catalogUrl?: string;
  readonly wire: ProviderType;
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly models: readonly CatalogModel[];
  readonly selectedModelId: string;
  readonly thinking?: boolean;
  readonly effort?: string;
}

/**
 * Parses an optional pruned models.dev catalog string — typically the
 * `__PYTHINKER_CODE_BUILT_IN_CATALOG__` constant injected by tsdown at build
 * time. Returns `undefined` when the argument is missing or invalid.
 */
export function loadBuiltInCatalog(text?: string): Catalog | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  try {
    return JSON.parse(text) as Catalog;
  } catch {
    return undefined;
  }
}

/**
 * Writes a catalog-selected provider and its model aliases into `config` and
 * marks it the default. Model metadata (context, output limit, capabilities)
 * comes from the catalog, so the user does not hand-write it. Returns the
 * default model key.
 *
 * NOTE: the same-provider cleanup below mutates the passed-in `config` only.
 * It clears stale aliases on disk solely when the caller overwrites the whole
 * config. Callers persisting via `setConfig` — a deep-merge patch that cannot
 * delete keys — must call `removeProvider` first, or removed aliases reappear
 * after the merge.
 */
export function applyCatalogProvider(
  config: PythinkerConfig,
  options: ApplyCatalogProviderOptions,
): { defaultModel: string } {
  config.providers[options.providerId] = {
    type: options.wire,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    source: { kind: 'modelsDev', url: options.catalogUrl ?? DEFAULT_CATALOG_URL },
  };

  const models = config.models ?? {};
  for (const [key, alias] of Object.entries(models)) {
    if (alias.provider === options.providerId) delete models[key];
  }
  for (const model of options.models) {
    models[`${options.providerId}/${model.id}`] = catalogModelToAlias(options.providerId, model);
  }
  config.models = models;

  const defaultModel = `${options.providerId}/${options.selectedModelId}`;
  config.defaultModel = defaultModel;
  if (options.thinking !== undefined || options.effort !== undefined) {
    config.thinking = {
      ...config.thinking,
      ...(options.thinking === undefined ? {} : { enabled: options.thinking }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
    };
  }
  return { defaultModel };
}

export interface CatalogProviderStore {
  ensureConfigFile(): Promise<void>;
  getConfig(options?: { readonly reload?: boolean }): Promise<PythinkerConfig>;
  replaceConfigSections(sections: Record<string, unknown>): Promise<void>;
}

export interface ImportCatalogProviderOptions {
  readonly providerId: string;
  readonly entry: CatalogProviderEntry;
  readonly catalogUrl?: string;
  readonly apiKey: string;
  readonly defaultModel?: string;
  readonly thinking?: boolean;
  readonly effort?: string;
}

export interface ImportCatalogProviderResult {
  readonly models: readonly CatalogModel[];
  readonly defaultModel: string | undefined;
}

export class CatalogProviderError extends Error {}

export async function importCatalogProvider(
  store: CatalogProviderStore,
  options: ImportCatalogProviderOptions,
): Promise<ImportCatalogProviderResult> {
  const providerId = options.providerId.trim();
  const apiKey = options.apiKey.trim();
  if (providerId.length === 0) throw new CatalogProviderError('Provider id cannot be empty.');
  if (apiKey.length === 0) {
    throw new CatalogProviderError(`Provider "${providerId}" needs an API key.`);
  }

  const resolution = resolveCatalogImport(options.entry);
  if (resolution.kind !== 'ok') {
    throw new CatalogProviderError(`Provider "${providerId}" is not available for direct import.`);
  }
  const models = catalogProviderModels(options.entry);
  if (models.length === 0) {
    throw new CatalogProviderError(`Provider "${providerId}" lists no usable models.`);
  }
  if (
    options.defaultModel !== undefined &&
    !models.some((model) => model.id === options.defaultModel)
  ) {
    throw new CatalogProviderError(
      `Model "${options.defaultModel}" is not offered by provider "${providerId}".`,
    );
  }

  await store.ensureConfigFile();
  const current = await store.getConfig({ reload: true });
  const next: PythinkerConfig = {
    ...current,
    providers: { ...current.providers },
    models: { ...current.models },
  };
  const selectedModelId = options.defaultModel ?? models[0]!.id;
  applyCatalogProvider(next, {
    providerId,
    catalogUrl: options.catalogUrl,
    wire: resolution.wire,
    baseUrl: resolution.baseUrl,
    apiKey,
    models,
    selectedModelId,
    thinking: options.thinking,
    effort: options.effort,
  });
  if (options.defaultModel === undefined) next.defaultModel = current.defaultModel;

  await store.replaceConfigSections({
    providers: next.providers,
    models: next.models,
    defaultModel: next.defaultModel,
    ...(next.thinking === undefined ? {} : { thinking: next.thinking }),
  });
  return { models, defaultModel: next.defaultModel };
}
