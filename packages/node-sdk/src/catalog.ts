import type { PythinkerConfig, ModelAlias } from '@pythoughts/agent-core';
import {
  catalogBaseUrl,
  catalogConnectionWire,
  catalogProviderModels,
  inferWireType,
  type Catalog,
  type CatalogModel,
  type CatalogProviderEntry,
  type ModelCapability,
  type ProviderType,
} from '@pythoughts/kosong';

export { catalogBaseUrl, catalogConnectionWire, catalogProviderModels, inferWireType };
export type { Catalog, CatalogModel, CatalogProviderEntry };

export const DEFAULT_CATALOG_URL = 'https://models.dev/api.json';

export class CatalogFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Fetches a models.dev-style catalog. Public endpoint, no credentials needed. */
export async function fetchCatalog(
  url: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Catalog> {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    throw new CatalogFetchError(`Failed to fetch catalog (HTTP ${res.status}).`, res.status);
  }
  const payload: unknown = await res.json();
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error(`Unexpected catalog response from ${url}.`);
  }
  // Drop entries that are not objects instead of casting the payload whole. A
  // `null` entry reaches `catalogConnectionWire` and throws well past the
  // caller's fallback, which turns one malformed record into a dead login.
  const entries = Object.entries(payload).filter(
    ([, entry]) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
  return Object.fromEntries(entries) as Catalog;
}

function capabilityToStrings(
  capability: ModelCapability,
  alwaysThinking: boolean | undefined,
): string[] | undefined {
  const caps: string[] = [];
  if (capability.image_in) caps.push('image_in');
  if (capability.video_in) caps.push('video_in');
  if (capability.audio_in) caps.push('audio_in');
  if (capability.thinking) caps.push('thinking');
  if (capability.tool_use) caps.push('tool_use');
  if (alwaysThinking === true) caps.push('always_thinking');
  return caps.length > 0 ? caps : undefined;
}

/** Builds a pythinker-code model alias from a normalized catalog model. */
export function catalogModelToAlias(providerId: string, model: CatalogModel): ModelAlias {
  return {
    provider: providerId,
    model: model.id,
    maxContextSize: model.capability.max_context_tokens,
    maxOutputSize: model.maxOutputSize,
    capabilities: capabilityToStrings(model.capability, model.alwaysThinking),
    supportEfforts: model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
    thinkingBudgets:
      model.thinkingBudgets === undefined ? undefined : { ...model.thinkingBudgets },
    displayName: model.name,
    reasoningKey: model.reasoningKey,
    adaptiveThinking: model.adaptiveThinking,
  };
}

export interface ApplyCatalogProviderOptions {
  readonly providerId: string;
  readonly catalogUrl?: string;
  readonly wire: ProviderType;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiKeyEnvVar?: string;
  readonly models: readonly CatalogModel[];
  readonly selectedModelId: string;
  readonly thinking: boolean;
  /** The effort level the user picked; only the on/off bit persists without it. */
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
    apiKeyEnvVar: options.apiKeyEnvVar,
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
  config.defaultThinking = options.thinking;
  // defaultThinking is a boolean, so without this the picked level is lost and
  // the session reopens at 'high' regardless of what the user chose. 'off' is
  // written too rather than skipped: `setConfig` deep-merges and cannot delete a
  // key, so skipping it would leave a previous login's effort on disk.
  if (options.effort !== undefined) {
    config.thinking = { ...config.thinking, effort: options.effort };
  }
  return { defaultModel };
}

export interface CatalogProviderStore {
  ensureConfigFile(): Promise<void>;
  getConfig(): Promise<PythinkerConfig>;
  removeProvider(providerId: string): Promise<PythinkerConfig>;
  setConfig(patch: Partial<PythinkerConfig>): Promise<PythinkerConfig>;
}

export interface ImportCatalogProviderOptions {
  readonly providerId: string;
  readonly entry: CatalogProviderEntry;
  readonly catalogUrl?: string;
  /** Literal key, written into config.toml. Mutually exclusive with `apiKeyEnvVar`. */
  readonly apiKey?: string;
  /** Name of an environment variable the key is read from at connection time. */
  readonly apiKeyEnvVar?: string;
  /** Alias to make the default model, as a bare catalog model id. */
  readonly defaultModel?: string;
}

export interface ImportCatalogProviderResult {
  readonly models: readonly CatalogModel[];
  readonly defaultModel: string | undefined;
}

export class CatalogProviderError extends Error {}

/**
 * Writes one catalog provider and its models into the persisted config.
 *
 * Re-importing a configured provider has to drop its stale aliases first, and
 * `removeProvider` clears any default pointing at them — so the defaults are
 * snapshotted up front and restored afterwards, but only while they still
 * resolve against the refreshed catalog. A default left pointing at a model the
 * catalog no longer lists would break the next session.
 */
export async function importCatalogProvider(
  store: CatalogProviderStore,
  options: ImportCatalogProviderOptions,
): Promise<ImportCatalogProviderResult> {
  const { providerId, entry } = options;
  const wire = catalogConnectionWire(entry);
  if (wire === undefined) {
    throw new CatalogProviderError(
      `Provider "${providerId}" cannot be configured with a single API key.`,
    );
  }

  const apiKey = options.apiKey?.trim();
  const apiKeyEnvVar = options.apiKeyEnvVar?.trim();
  if ((apiKey ?? '').length === 0 && (apiKeyEnvVar ?? '').length === 0) {
    throw new CatalogProviderError(`Provider "${providerId}" needs an API key.`);
  }

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    throw new CatalogProviderError(`Provider "${providerId}" lists no usable models.`);
  }
  if (options.defaultModel !== undefined && !models.some((m) => m.id === options.defaultModel)) {
    throw new CatalogProviderError(
      `Model "${options.defaultModel}" is not offered by provider "${providerId}".`,
    );
  }

  await store.ensureConfigFile();
  let config = await store.getConfig();
  const previousDefaultProvider = config.defaultProvider;
  const previousDefaultModel = config.defaultModel;
  const previousDefaultThinking = config.defaultThinking;

  if (config.providers[providerId] !== undefined) {
    config = await store.removeProvider(providerId);
  }

  const useEnvVar = (apiKey ?? '').length === 0;
  applyCatalogProvider(config, {
    providerId,
    catalogUrl: options.catalogUrl ?? DEFAULT_CATALOG_URL,
    wire,
    baseUrl: catalogBaseUrl(entry, wire),
    apiKey: useEnvVar ? undefined : apiKey,
    apiKeyEnvVar: useEnvVar ? apiKeyEnvVar : undefined,
    models,
    selectedModelId: options.defaultModel ?? '',
    thinking: false,
  });

  if (options.defaultModel === undefined) {
    const stillResolves =
      previousDefaultModel !== undefined && config.models?.[previousDefaultModel] !== undefined;
    config.defaultModel = stillResolves ? previousDefaultModel : undefined;
  }
  config.defaultProvider =
    previousDefaultProvider !== undefined && config.providers[previousDefaultProvider] !== undefined
      ? previousDefaultProvider
      : undefined;
  config.defaultThinking = previousDefaultThinking;

  await store.setConfig({
    providers: config.providers,
    models: config.models,
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  return { models, defaultModel: config.defaultModel };
}
