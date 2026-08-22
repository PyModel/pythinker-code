import { describe, expect, it } from 'vitest';
import {
  emptyProviderForm,
  modelsForProvider,
  toProviderCreateInput,
  toProviderUpdateInput,
  validateProviderForm,
} from './providerForm';

describe('provider form', () => {
  it('validates identity, credentials, and model context sizes', () => {
    const form = emptyProviderForm();
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('idRequired');
    form.id = 'local';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('apiKeyRequired');
    form.apiKey = 'secret';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('baseUrlRequired');
    form.baseUrl = 'https://api.example.test/v1';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('modelRequired');
    form.models[0]!.model = 'model-a';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('contextSizeRequired');
    form.models[0]!.maxContextSize = '0';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBe('contextSizeInvalid');
    form.models[0]!.maxContextSize = '128000';
    expect(validateProviderForm(form, { apiKey: true, baseUrl: true })).toBeNull();
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
});
