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

export function validateProviderForm(
  value: ProviderFormValue,
  requirements: { apiKey?: boolean; baseUrl?: boolean } = {},
): ProviderFormError | null {
  const id = value.id.trim();
  if (id === '') return 'idRequired';
  if (!providerIdPattern.test(id)) return 'idInvalid';
  if (requirements.apiKey === true && value.apiKey.trim() === '') return 'apiKeyRequired';
  if (requirements.baseUrl === true && value.baseUrl.trim() === '') return 'baseUrlRequired';
  if (value.models.length === 0) return 'modelRequired';
  for (const model of value.models) {
    if (model.model.trim() === '') return 'modelRequired';
    const context = model.maxContextSize.trim();
    if (context === '') return 'contextSizeRequired';
    if (!/^\d+$/.test(context) || Number(context) < 1) return 'contextSizeInvalid';
  }
  return null;
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
