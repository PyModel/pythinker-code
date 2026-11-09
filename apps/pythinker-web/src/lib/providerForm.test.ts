import { describe, expect, it } from 'vitest';
import {
  collectProviderFormErrors,
  emptyProviderForm,
  hasProviderFormErrors,
  modelsForProvider,
  toProviderCreateInput,
  toProviderUpdateInput,
} from './providerForm';

describe('provider form', () => {
  const required = { apiKey: true, baseUrl: true };

  it('reports every failing field at once, addressed by field', () => {
    const form = emptyProviderForm();
    const errors = collectProviderFormErrors(form, required);
    expect(errors.id).toBe('idRequired');
    expect(errors.apiKey).toBe('apiKeyRequired');
    expect(errors.baseUrl).toBe('baseUrlRequired');
    expect(errors.models[0]).toEqual({
      model: 'modelRequired',
      maxContextSize: 'contextSizeRequired',
    });
    expect(hasProviderFormErrors(errors)).toBe(true);
  });

  it('validates identity, credentials, and model context sizes', () => {
    const form = emptyProviderForm();
    expect(collectProviderFormErrors(form, required).id).toBe('idRequired');
    form.id = 'not/valid';
    expect(collectProviderFormErrors(form, required).id).toBe('idInvalid');
    form.id = 'local';
    expect(collectProviderFormErrors(form, required).id).toBeUndefined();
    form.apiKey = 'secret';
    form.baseUrl = 'https://api.example.test/v1';
    form.models[0]!.model = 'model-a';
    expect(collectProviderFormErrors(form, required).models[0]).toEqual({
      maxContextSize: 'contextSizeRequired',
    });
    form.models[0]!.maxContextSize = '0';
    expect(collectProviderFormErrors(form, required).models[0]).toEqual({
      maxContextSize: 'contextSizeInvalid',
    });
    form.models[0]!.maxContextSize = '99999999999999999999';
    expect(collectProviderFormErrors(form, required).models[0]).toEqual({
      maxContextSize: 'contextSizeInvalid',
    });
    form.models[0]!.maxContextSize = '128000';
    expect(hasProviderFormErrors(collectProviderFormErrors(form, required))).toBe(false);
  });

  it('blames only the incomplete row, so its siblings still save', () => {
    const form = emptyProviderForm();
    form.id = 'local';
    form.apiKey = 'secret';
    form.baseUrl = 'https://api.example.test/v1';
    form.models = [
      { model: 'good-a', maxContextSize: '128000', displayName: '' },
      { model: 'incomplete', maxContextSize: '', displayName: '' },
      { model: 'good-b', maxContextSize: '256000', displayName: '' },
    ];
    const errors = collectProviderFormErrors(form, required);
    expect(Object.keys(errors.models)).toEqual(['1']);
    expect(errors.models[1]).toEqual({ maxContextSize: 'contextSizeRequired' });
  });

  it('normalizes manual create and edit payloads', () => {
    const form = {
      id: ' local ',
      type: 'openai' as const,
      apiKey: ' secret ',
      baseUrl: ' https://api.example.test/v1 ',
      models: [{ model: ' model-a ', maxContextSize: '128000', displayName: ' Model A ' }],
    };
    expect(toProviderCreateInput(form)).toEqual({
      id: 'local',
      type: 'openai',
      apiKey: 'secret',
      baseUrl: 'https://api.example.test/v1',
      models: [{ model: 'model-a', maxContextSize: 128000, displayName: 'Model A' }],
    });
    expect(toProviderUpdateInput(
      { ...form, id: 'renamed', apiKey: '' },
      {
        id: 'local', type: 'openai', hasApiKey: true, status: 'connected', models: ['model-a'],
      },
      false,
      'local/model-a',
    )).toEqual({
      newId: 'renamed',
      type: 'openai',
      apiKey: undefined,
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'model-a',
      models: [{ model: 'model-a', maxContextSize: 128000, displayName: 'Model A' }],
    });
  });

  it('loads editable model rows from config aliases', () => {
    const provider = {
      id: 'local', type: 'openai', hasApiKey: true, status: 'connected' as const, models: ['model-a'],
    };
    expect(modelsForProvider(provider, {
      'local/model-a': {
        provider: 'local', model: 'model-a', maxContextSize: 128000, displayName: 'Model A',
      },
      'other/model-b': { provider: 'other', model: 'model-b', maxContextSize: 1000 },
    })).toEqual([{ model: 'model-a', maxContextSize: '128000', displayName: 'Model A' }]);
  });

  it('falls back to the catalog aliases when the config has no rows for the provider', () => {
    const provider = {
      id: 'local', type: 'openai', hasApiKey: true, status: 'connected' as const, models: ['local/model-a', 'bare-b'],
    };
    expect(modelsForProvider(provider, {})).toEqual([
      { model: 'model-a', maxContextSize: '', displayName: '' },
      { model: 'bare-b', maxContextSize: '', displayName: '' },
    ]);
    expect(modelsForProvider(provider, undefined)).toHaveLength(2);
  });
});
