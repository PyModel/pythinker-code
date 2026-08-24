import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import ProviderSetupForm from '../src/components/ProviderSetupForm.vue';
import { messages } from '../src/i18n/locales';

const i18n = createI18n({ legacy: false, locale: 'en', messages });

describe('ProviderSetupForm', () => {
  it('offers catalog providers and submits a selected API key model', async () => {
    const wrapper = mount(ProviderSetupForm, {
      global: { plugins: [i18n] },
      props: {
        catalog: [
          { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude', name: 'Claude' }] },
          { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
        ],
      },
    });

    expect(wrapper.findAll('[data-provider-option]').map((option) => option.text()))
      .toEqual(['Anthropic', 'DeepSeek']);
    await wrapper.get('[data-provider-select]').setValue('deepseek');
    await wrapper.get('[data-api-key]').setValue('sk-local');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('add')).toEqual([[{
      providerId: 'deepseek',
      apiKey: 'sk-local',
      defaultModel: 'deepseek-chat',
    }]]);
  });

  it('offers only providers with a supported wire type', () => {
    const wrapper = mount(ProviderSetupForm, {
      global: { plugins: [i18n] },
      props: {
        catalog: [
          { id: 'pythinker', name: 'Pythinker', models: [{ id: 'managed' }] },
          { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5' }] },
        ],
      },
    });

    expect(wrapper.findAll('[data-provider-option]').map((option) => option.attributes('value')))
      .toEqual(['openai']);
  });
});
