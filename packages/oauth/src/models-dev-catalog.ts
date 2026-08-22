import {
  catalogProviderModels,
  type CatalogModel,
  type CatalogProviderEntry,
} from '@pymodel/kosong';

import { readApiErrorMessage } from './api-error';
import type { ManagedPythinkerModelAlias } from './managed-pythinker-code';
import { isRecord } from './utils';

/**
 * models.dev directory documents are public and large, so refresh treats a
 * `modelsDev` source differently from a private api.json registry: entries
 * are never auto-added as new providers, and the stored provider record
 * (wire, endpoint, credentials) is never rewritten — only model aliases sync.
 */
export const MODELS_DEV_CATALOG_URL = 'https://models.dev/api.json';

/** Remote-owned alias fields written by {@link modelsDevProviderAliases}. */
export const MODELS_DEV_MODEL_FIELDS: ReadonlySet<string> = new Set([
  'provider',
  'model',
  'maxContextSize',
  'maxInputSize',
  'maxOutputSize',
  'capabilities',
  'displayName',
  'reasoningKey',
  'supportEfforts',
  'offEffort',
  'protocol',
  'baseUrl',
]);

export interface ModelsDevSource {
  readonly url: string;
}

export class ModelsDevCatalogError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ModelsDevCatalogError';
    this.status = status;
  }
}

export function parseModelsDevSource(source: unknown): ModelsDevSource | undefined {
  if (!isRecord(source)) return undefined;
  if (source['kind'] !== 'modelsDev') return undefined;
  const url = source['url'];
  if (typeof url !== 'string' || url.length === 0) return undefined;
  return { url };
}

function capabilityToStrings(capability: CatalogModel['capability']): string[] | undefined {
  const caps: string[] = [];
  if (capability.image_in) caps.push('image_in');
  if (capability.video_in) caps.push('video_in');
  if (capability.audio_in) caps.push('audio_in');
  if (capability.thinking) caps.push('thinking');
  if (capability.tool_use) caps.push('tool_use');
  if (capability.dynamically_loaded_tools === true) caps.push('dynamically_loaded_tools');
  return caps.length > 0 ? caps : undefined;
}

/**
 * Normalizes one catalog entry into refreshed aliases keyed by
 * `${providerId}/${modelId}`, mirroring the field set the catalog importers
 * write. Optional fields are assigned only when upstream declares them so a
 * refresh never clobbers a stored value with an implicit undefined. Returns
 * an empty record when the entry is unusable (not an object or no importable
 * models); callers treat that as "nothing known upstream".
 */
export function modelsDevProviderAliases(
  providerId: string,
  entry: unknown,
): Record<string, ManagedPythinkerModelAlias> {
  if (!isRecord(entry)) return {};
  const models = catalogProviderModels(entry as CatalogProviderEntry);
  const out: Record<string, ManagedPythinkerModelAlias> = {};
  for (const model of models) {
    const caps = capabilityToStrings(model.capability);
    const capabilities =
      model.alwaysThinking === true
        ? caps?.map((cap) => (cap === 'thinking' ? 'always_thinking' : cap))
        : caps;
    const alias: ManagedPythinkerModelAlias = {
      provider: providerId,
      model: model.id,
      maxContextSize: model.capability.max_context_tokens,
    };
    if (model.capability.max_input_tokens !== undefined) {
      alias.maxInputSize = model.capability.max_input_tokens;
    }
    if (model.maxOutputSize !== undefined) alias.maxOutputSize = model.maxOutputSize;
    if (capabilities !== undefined) alias.capabilities = [...capabilities];
    if (model.name !== undefined) alias.displayName = model.name;
    if (model.reasoningKey !== undefined) alias.reasoningKey = model.reasoningKey;
    if (model.supportEfforts !== undefined) alias.supportEfforts = [...model.supportEfforts];
    if (model.offEffort !== undefined) alias.offEffort = model.offEffort;
    if (model.protocol !== undefined) alias.protocol = model.protocol;
    if (model.baseUrl !== undefined) alias.baseUrl = model.baseUrl;
    out[`${providerId}/${model.id}`] = alias;
  }
  return out;
}

/**
 * Fetches a models.dev-style catalog document keyed by top-level provider id.
 * The directory needs no credentials, so no Authorization header is sent even
 * when the configured provider carries one.
 */
export async function fetchModelsDevCatalog(
  url: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; userAgent?: string } = {},
): Promise<Record<string, unknown>> {
  const { signal, fetchImpl = fetch, userAgent } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (userAgent !== undefined) headers['User-Agent'] = userAgent;

  const response = await fetchImpl(url, { headers, ...(signal !== undefined ? { signal } : {}) });
  if (!response.ok) {
    throw new ModelsDevCatalogError(
      await readApiErrorMessage(response, `Failed to fetch models.dev catalog at ${url} (HTTP ${response.status}).`),
      response.status,
    );
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload)) {
    throw new ModelsDevCatalogError(`Unexpected models.dev response at ${url}: expected a JSON object.`, 200);
  }
  return payload;
}
