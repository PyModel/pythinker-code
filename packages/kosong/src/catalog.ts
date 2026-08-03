import type { ModelCapability, ModelCostRates } from './capability';
import type { ProviderType } from './providers';

/**
 * models.dev-style catalog: a public map of provider/model metadata. Callers
 * consume a snapshot of this shape to populate provider + model configuration
 * without hand-writing context windows or capabilities.
 */
export interface CatalogModelEntry {
  readonly id?: string;
  readonly name?: string;
  readonly family?: string;
  readonly limit?: { readonly context?: number; readonly output?: number };
  readonly tool_call?: boolean;
  readonly reasoning?: boolean;
  readonly reasoning_options?:
    | readonly {
        readonly type?: string;
        readonly values?: readonly unknown[];
        readonly min?: number;
        readonly max?: number;
      }[]
    | null;
  readonly interleaved?: boolean | { readonly field?: string };
  readonly modalities?: {
    readonly input?: readonly string[];
    readonly output?: readonly string[];
  };
  /** Raw models.dev rates in USD per 1,000,000 tokens. */
  readonly cost?: {
    readonly input?: number;
    readonly output?: number;
    readonly cache_read?: number;
    readonly cache_write?: number;
  };
}

export interface CatalogProviderEntry {
  readonly id?: string;
  readonly name?: string;
  /** Base URL for the provider; may be empty (some SDKs hardcode it). */
  readonly api?: string;
  /** Env var names carrying credentials — surfaced as a hint by callers. */
  readonly env?: readonly string[];
  /** models.dev SDK package id; used to infer the wire type when `type` is absent. */
  readonly npm?: string;
  /** Explicit wire type extension; inferred from `npm`/`id` when absent. */
  readonly type?: string;
  readonly models?: Record<string, CatalogModelEntry>;
}

/** Top-level catalog: `{ [providerId]: ProviderEntry }` (e.g. models.dev/api.json). */
export type Catalog = Record<string, CatalogProviderEntry>;

/** A normalized catalog model: identity plus its {@link ModelCapability}. */
export interface CatalogModel {
  readonly id: string;
  readonly name?: string;
  readonly maxOutputSize?: number;
  readonly reasoningKey?: string;
  readonly supportEfforts?: readonly string[];
  readonly alwaysThinking?: boolean;
  readonly adaptiveThinking?: boolean;
  readonly thinkingBudgets?: Readonly<Partial<Record<'high' | 'max', number>>>;
  readonly capability: ModelCapability;
}

const KNOWN_WIRE_TYPES = [
  'anthropic',
  'openai',
  'pythinker',
  'google-genai',
  'openai_responses',
  'vertexai',
] as const satisfies readonly ProviderType[];

function isWireType(value: unknown): value is ProviderType {
  return typeof value === 'string' && (KNOWN_WIRE_TYPES as readonly string[]).includes(value);
}

function hasEmbeddingMarker(value: string | undefined): boolean {
  if (value === undefined) return false;
  const lower = value.toLowerCase();
  return lower.includes('embedding') || /(?:^|[-_/])embed(?:$|[-_/])/.test(lower);
}

function isUsableChatModel(model: CatalogModelEntry): boolean {
  const outputModalities = model.modalities?.output;
  if (outputModalities !== undefined && !outputModalities.includes('text')) return false;
  return (
    !hasEmbeddingMarker(model.family) &&
    !hasEmbeddingMarker(model.id) &&
    !hasEmbeddingMarker(model.name)
  );
}

/**
 * Resolves a catalog provider entry to a supported wire type. Honors an
 * explicit `type`, otherwise infers from `npm`/`id`. Unknown providers return
 * `undefined` so callers can omit them instead of writing an invalid config.
 */
export function inferWireType(entry: CatalogProviderEntry): ProviderType | undefined {
  if (isWireType(entry.type)) return entry.type;
  const npm = (entry.npm ?? '').toLowerCase();
  const id = (entry.id ?? '').toLowerCase();
  if (npm.includes('anthropic') || id.includes('anthropic') || id.includes('claude')) {
    return 'anthropic';
  }
  if (id.includes('vertex')) return 'vertexai';
  if (npm.includes('google') || id.includes('google') || id.includes('gemini')) {
    return 'google-genai';
  }
  if (npm.includes('openai') || id.includes('openai')) return 'openai';
  return undefined;
}

/** Returns the wire only when this runtime can configure the catalog entry with one API key. */
export function catalogConnectionWire(entry: CatalogProviderEntry): ProviderType | undefined {
  const wire = inferWireType(entry);
  const npm = entry.npm?.toLowerCase();
  if (
    (wire === 'openai' && npm !== '@ai-sdk/openai' && npm !== '@ai-sdk/openai-compatible') ||
    (wire === 'anthropic' && npm !== '@ai-sdk/anthropic')
  ) {
    return undefined;
  }
  if (wire === 'google-genai') {
    return npm === '@ai-sdk/google' && entry.api === undefined ? wire : undefined;
  }
  if (wire !== 'openai' && wire !== 'anthropic') return undefined;
  if (entry.api === undefined) {
    if (wire === 'openai' && entry.id === 'openai') return wire;
    if (wire === 'anthropic' && entry.id === 'anthropic') return wire;
    return undefined;
  }
  if (entry.api.includes('${') || !URL.canParse(entry.api)) return undefined;
  const url = new URL(entry.api);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const path = url.pathname.replace(/\/+$/, '');
  if (wire === 'openai' && path.endsWith('/chat/completions')) return undefined;
  if (wire === 'anthropic' && path.endsWith('/messages')) return undefined;
  return wire;
}

/**
 * Resolves the base URL to store for a catalog provider, adapting the catalog's
 * `api` to the wire's SDK convention.
 *
 * models.dev `api` URLs are written for the SDK named in `npm` (e.g.
 * `@ai-sdk/anthropic`), whose base already includes the `/v1` version segment.
 * We route the `anthropic` wire through the official `@anthropic-ai/sdk`, which
 * appends `/v1/messages` itself — so a catalog `api` ending in `/v1` would POST
 * to `/v1/v1/messages` (404). Strip the trailing `/v1` for anthropic. OpenAI
 * family SDKs append `/chat/completions` to a `/v1` base, so those pass through.
 */
export function catalogBaseUrl(
  entry: CatalogProviderEntry,
  wire: ProviderType,
): string | undefined {
  const api = entry.api;
  if (typeof api !== 'string' || api.length === 0) return undefined;
  if (wire === 'anthropic') return api.replace(/\/v1\/?$/, '');
  return api;
}

/** Normalizes one catalog model entry into a {@link CatalogModel}; skips invalid entries. */
export function catalogModelToCapability(
  model: CatalogModelEntry,
  wire?: ProviderType,
): CatalogModel | undefined {
  if (typeof model.id !== 'string' || model.id.length === 0) return undefined;
  const context = model.limit?.context;
  if (typeof context !== 'number' || !Number.isInteger(context) || context <= 0) return undefined;
  if (!isUsableChatModel(model)) return undefined;
  const inputs = model.modalities?.input ?? [];
  const output = model.limit?.output;
  const reasoning = catalogReasoningControls(model, wire);
  return {
    id: model.id,
    name: typeof model.name === 'string' && model.name.length > 0 ? model.name : undefined,
    maxOutputSize: typeof output === 'number' && output > 0 ? output : undefined,
    reasoningKey: catalogReasoningKey(model.interleaved),
    supportEfforts: reasoning?.supportEfforts,
    alwaysThinking: reasoning?.alwaysThinking,
    adaptiveThinking: reasoning?.adaptiveThinking,
    thinkingBudgets: reasoning?.thinkingBudgets,
    capability: {
      image_in: inputs.includes('image'),
      video_in: inputs.includes('video'),
      audio_in: inputs.includes('audio'),
      thinking: Boolean(model.reasoning),
      tool_use: model.tool_call ?? true,
      max_context_tokens: context,
      cost: catalogCostRates(model.cost),
    },
  };
}

function catalogCostRates(cost: CatalogModelEntry['cost']): ModelCostRates | undefined {
  if (cost === undefined) return undefined;
  const rates: ModelCostRates = {
    input: finiteRate(cost.input),
    output: finiteRate(cost.output),
    cacheRead: finiteRate(cost.cache_read),
    cacheWrite: finiteRate(cost.cache_write),
  };
  return Object.values(rates).some((rate) => rate !== undefined) ? rates : undefined;
}

function finiteRate(rate: number | undefined): number | undefined {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 ? rate : undefined;
}

const SUPPORTED_REASONING_EFFORTS = new Set([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function catalogReasoningControls(
  model: CatalogModelEntry,
  wire: ProviderType | undefined,
): Pick<
  CatalogModel,
  'supportEfforts' | 'alwaysThinking' | 'adaptiveThinking' | 'thinkingBudgets'
> | undefined {
  if (model.reasoning !== true || model.reasoning_options === undefined) return undefined;
  const options = model.reasoning_options;
  if (!Array.isArray(options)) return undefined;
  if (options.length === 0) return { supportEfforts: [], alwaysThinking: true };

  const effort = options.find((option) => option.type === 'effort');
  if (effort !== undefined) {
    const values: readonly unknown[] = Array.isArray(effort.values) ? effort.values : [];
    const supportEfforts = [
      ...new Set(
        values
          .map((value: unknown): string | undefined =>
            value === null ? 'none' : typeof value === 'string' ? value : undefined,
          )
          .filter(
            (value: string | undefined): value is string =>
              value !== undefined && SUPPORTED_REASONING_EFFORTS.has(value),
          ),
      ),
    ];
    return { supportEfforts, alwaysThinking: !supportEfforts.includes('none') };
  }

  const budget = options.find((option) => option.type === 'budget_tokens');
  if (budget !== undefined) {
    const declaredMax =
      typeof budget.max === 'number' && Number.isFinite(budget.max) ? budget.max : 31_999;
    const output = model.limit?.output;
    const outputMax =
      typeof output === 'number' && Number.isFinite(output) ? output - 1 : 31_999;
    const maximum = Math.floor(Math.min(declaredMax, outputMax, 31_999));
    if (maximum <= 0) return { supportEfforts: [], alwaysThinking: true };
    const declaredMin =
      typeof budget.min === 'number' && Number.isFinite(budget.min)
        ? Math.max(0, Math.ceil(budget.min))
        : 0;
    const high = Math.min(Math.max(declaredMin, Math.floor((maximum + 1) / 2)), maximum);
    const thinkingBudgets = { high, max: maximum };
    if (wire === 'anthropic') {
      return {
        supportEfforts: ['high', 'max'],
        alwaysThinking: true,
        adaptiveThinking: false,
        thinkingBudgets,
      };
    }
    if (wire === 'google-genai' || wire === 'vertexai') {
      return { supportEfforts: ['high', 'max'], alwaysThinking: true, thinkingBudgets };
    }
    return { supportEfforts: [], alwaysThinking: true };
  }

  if (options.some((option) => option.type === 'toggle')) {
    if (wire === 'anthropic') {
      return {
        supportEfforts: ['none', 'high'],
        alwaysThinking: false,
        adaptiveThinking: true,
      };
    }
    if (wire === 'google-genai' || wire === 'vertexai') {
      return { supportEfforts: ['none', 'high'], alwaysThinking: false };
    }
    return { supportEfforts: [], alwaysThinking: true };
  }

  return undefined;
}

function catalogReasoningKey(interleaved: CatalogModelEntry['interleaved']): string | undefined {
  // models.dev allows `interleaved: true` as "general support" — read it as
  // the default `reasoning_content` field so providers without an explicit
  // field name (e.g. some openai-compatible gateways) still round-trip.
  if (interleaved === true) return 'reasoning_content';
  if (typeof interleaved !== 'object' || interleaved === null) return undefined;
  const field = interleaved.field?.trim();
  return field !== undefined && field.length > 0 ? field : undefined;
}

/** Extracts the valid, normalized models from a catalog provider entry. */
export function catalogProviderModels(entry: CatalogProviderEntry): CatalogModel[] {
  const models = entry.models ?? {};
  const wire = inferWireType(entry);
  return Object.values(models)
    .map((model) => catalogModelToCapability(model, wire))
    .filter((model): model is CatalogModel => model !== undefined);
}
