import type {
  AppConfig,
  AppProvider,
  CatalogProviderWireType,
  ProviderCreateInput,
  ProviderModelInput,
  ProviderUpdateInput,
} from '../api/types';

export const providerTypes: CatalogProviderWireType[] = [
  'pythinker',
  'openai',
  'openai_responses',
  'anthropic',
  'google-genai',
  'vertexai',
];

export interface ProviderModelFormValue {
  model: string;
  maxContextSize: string;
  displayName: string;
}

export interface ProviderFormValue {
  id: string;
  type: CatalogProviderWireType;
  apiKey: string;
  baseUrl: string;
  models: ProviderModelFormValue[];
}

export type ProviderFormError =
  | 'idRequired'
  | 'idInvalid'
  | 'apiKeyRequired'
  | 'baseUrlRequired'
  | 'modelRequired'
  | 'contextSizeRequired'
  | 'contextSizeInvalid';

const providerIdPattern = /^[\p{L}\p{N}][\p{L}\p{N}\-_ ]*$/u;

export function emptyProviderModel(): ProviderModelFormValue {
  return { model: '', maxContextSize: '', displayName: '' };
}

export function emptyProviderForm(): ProviderFormValue {
  return {
    id: '',
    type: 'openai',
    apiKey: '',
    baseUrl: '',
    models: [emptyProviderModel()],
  };
}

export function modelsForProvider(
  provider: AppProvider,
  models: AppConfig['models'],
): ProviderModelFormValue[] {
  const result: ProviderModelFormValue[] = [];
  for (const value of Object.values(models ?? {})) {
    if (value === null || typeof value !== 'object') continue;
    const model = value as Record<string, unknown>;
    if (model['provider'] !== provider.id) continue;
    result.push({
      model: typeof model['model'] === 'string' ? model['model'] : '',
      maxContextSize: typeof model['maxContextSize'] === 'number' ? String(model['maxContextSize']) : '',
      displayName: typeof model['displayName'] === 'string' ? model['displayName'] : '',
    });
  }
  return result;
}

/** Validation failures for one model row, keyed by the field that failed. */
export interface ProviderModelRowErrors {
  model?: ProviderFormError;
  maxContextSize?: ProviderFormError;
}

/** Every validation failure in a provider form, addressed by field.
 *
 *  Field-scoped rather than a single message so the form can clear exactly the
 *  error the user just fixed, and so one incomplete model row reports against
 *  that row instead of blocking the whole provider with an unattributed
 *  message. */
export interface ProviderFormErrors {
  id?: ProviderFormError;
  apiKey?: ProviderFormError;
  baseUrl?: ProviderFormError;
  /** Keyed by row index — the only stable handle while ids are being typed. */
  models: Record<number, ProviderModelRowErrors>;
  /** Set when the form carries no model rows at all. */
  modelsEmpty?: ProviderFormError;
}

/** Collect every validation failure at once, rather than stopping at the first. */
export function collectProviderFormErrors(
  value: ProviderFormValue,
  requirements: { apiKey?: boolean; baseUrl?: boolean } = {},
): ProviderFormErrors {
  const errors: ProviderFormErrors = { models: {} };
  const id = value.id.trim();
  if (id === '') errors.id = 'idRequired';
  else if (!providerIdPattern.test(id)) errors.id = 'idInvalid';
  if (requirements.apiKey === true && value.apiKey.trim() === '') errors.apiKey = 'apiKeyRequired';
  if (requirements.baseUrl === true && value.baseUrl.trim() === '') {
    errors.baseUrl = 'baseUrlRequired';
  }
  if (value.models.length === 0) errors.modelsEmpty = 'modelRequired';
  value.models.forEach((model, index) => {
    const row: ProviderModelRowErrors = {};
    if (model.model.trim() === '') row.model = 'modelRequired';
    const context = model.maxContextSize.trim();
    const contextSize = Number(context);
    if (context === '') row.maxContextSize = 'contextSizeRequired';
    else if (!/^\d+$/.test(context) || !Number.isSafeInteger(contextSize) || contextSize < 1) {
      row.maxContextSize = 'contextSizeInvalid';
    }
    if (row.model !== undefined || row.maxContextSize !== undefined) errors.models[index] = row;
  });
  return errors;
}

export function hasProviderFormErrors(errors: ProviderFormErrors): boolean {
  return (
    errors.id !== undefined ||
    errors.apiKey !== undefined ||
    errors.baseUrl !== undefined ||
    errors.modelsEmpty !== undefined ||
    Object.keys(errors.models).length > 0
  );
}

function normalizeModels(models: ProviderModelFormValue[]): ProviderModelInput[] {
  return models.map((model) => ({
    model: model.model.trim(),
    maxContextSize: Number(model.maxContextSize.trim()),
    displayName: model.displayName.trim() || undefined,
  }));
}

export function toProviderCreateInput(value: ProviderFormValue): ProviderCreateInput {
  return {
    id: value.id.trim(),
    type: value.type,
    apiKey: value.apiKey.trim() || undefined,
    baseUrl: value.baseUrl.trim() || undefined,
    models: normalizeModels(value.models),
  };
}

export function toProviderUpdateInput(
  value: ProviderFormValue,
  provider: AppProvider,
  includeBlankApiKey: boolean,
  existingDefaultModel?: string,
): ProviderUpdateInput {
  const models = normalizeModels(value.models);
  const configuredDefault = existingDefaultModel?.includes('/')
    ? existingDefaultModel.slice(existingDefaultModel.indexOf('/') + 1)
    : existingDefaultModel;
  return {
    newId: value.id.trim() !== provider.id ? value.id.trim() : undefined,
    type: value.type,
    apiKey: value.apiKey.trim() || (includeBlankApiKey ? '' : undefined),
    baseUrl: value.baseUrl.trim() || undefined,
    defaultModel: configuredDefault && models.some((model) => model.model === configuredDefault)
      ? configuredDefault
      : undefined,
    models,
  };
}
