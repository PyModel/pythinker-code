import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it } from 'vitest';

import ModelPicker from '../src/components/ModelPicker.vue';
import type { AppModel } from '../src/api/types';

const modelPickerSource = readFileSync(
  join(import.meta.dirname, '../src/components/ModelPicker.vue'),
  'utf8',
);

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      model: {
        allTab: 'All',
        close: 'Close',
        contextSuffix: '{size}k ctx',
        dialogLabel: 'Switch model',
        emptyNoMatch: 'No matching models',
        emptyNoModels: 'No models',
        footerHint: 'Navigate',
        loading: 'Loading',
        providerTabs: 'Model providers',
        searchPlaceholder: 'Search',
        title: 'Switch model',
        unavailable: 'Unavailable',
        capabilities: {
          label: 'Model capabilities',
          imageIn: 'Image input',
          imageOut: 'Image output',
          vision: 'Vision',
          videoIn: 'Video input',
          audioIn: 'Audio input',
          audioOut: 'Audio output',
          thinking: 'Thinking',
          alwaysThinking: 'Always thinking',
          adaptiveThinking: 'Adaptive reasoning',
          toolUse: 'Tool use',
          fastMode: 'Fast mode',
          unknown: 'Capability: {capability}',
        },
      },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const models: AppModel[] = [
  {
    id: 'pythinker/k2',
    provider: 'pythinker',
    model: 'k2',
    displayName: 'Pythinker K2',
    maxContextSize: 128000,
  },
  {
    id: 'openai/gpt-5',
    provider: 'openai',
    model: 'gpt-5',
    displayName: 'GPT-5',
    maxContextSize: 256000,
  },
  {
    id: 'openai/gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    displayName: 'GPT-4o',
    maxContextSize: 128000,
  },
];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ModelPicker provider tabs', () => {
  it('filters the fixed model list by provider tab', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: 'pythinker/k2',
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.findAll('.model-row')).toHaveLength(3);

    await wrapper.findAll('.tab-btn').find((button) => button.text() === 'openai')!.trigger('click');

    expect(wrapper.findAll('.model-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('GPT-5');
    expect(wrapper.text()).not.toContain('Pythinker K2');

    await wrapper.findAll('.tab-btn').find((button) => button.text() === 'All')!.trigger('click');

    expect(wrapper.findAll('.model-row')).toHaveLength(3);
  });
});

describe('ModelPicker dialog focus', () => {
  it('is a modal that focuses the search box and restores focus on close', async () => {
    // An opener that "owns" focus before the dialog appears.
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const wrapper = mount(ModelPicker, {
      props: { models, current: 'pythinker/k2' },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });

    const dialog = wrapper.find('.dialog');
    expect(dialog.attributes('aria-modal')).toBe('true');

    await nextTick();
    // Opening moves focus into the dialog (the search field).
    expect(document.activeElement).toBe(wrapper.find('.search-input').element);

    wrapper.unmount();
    await nextTick();
    // Closing returns focus to whoever opened it.
    expect(document.activeElement).toBe(opener);

    opener.remove();
  });
});

describe('ModelPicker starred models', () => {
  it('pins starred models to the top in the All tab', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: 'pythinker/k2',
        starredIds: ['openai/gpt-4o'],
      },
      global: { plugins: [i18n] },
    });

    const rows = wrapper.findAll('.model-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]!.text()).toContain('GPT-4o');
    expect(rows[1]!.text()).toContain('Pythinker K2');
    expect(rows[2]!.text()).toContain('GPT-5');
  });

  it('does not reorder models inside a provider tab', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: 'pythinker/k2',
        starredIds: ['openai/gpt-4o'],
      },
      global: { plugins: [i18n] },
    });

    await wrapper.findAll('.tab-btn').find((button) => button.text() === 'openai')!.trigger('click');

    const rows = wrapper.findAll('.model-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('GPT-5');
    expect(rows[1]!.text()).toContain('GPT-4o');
  });

  it('emits toggle-star when the star button is clicked without selecting the model', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: 'pythinker/k2',
        starredIds: [],
      },
      global: { plugins: [i18n] },
    });

    const starBtn = wrapper.findAll('.star-btn').find((button) =>
      button.element.closest('.model-row')?.textContent?.includes('GPT-5'),
    );
    expect(starBtn).toBeDefined();
    await starBtn!.trigger('click');

    expect(wrapper.emitted('toggle-star')).toHaveLength(1);
    expect(wrapper.emitted('toggle-star')![0]).toEqual(['openai/gpt-5']);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('keeps starred models first while searching in the All tab', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: 'pythinker/k2',
        starredIds: ['openai/gpt-5'],
      },
      global: { plugins: [i18n] },
    });

    const search = wrapper.find('.search-input');
    await search.setValue('gpt');

    const rows = wrapper.findAll('.model-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain('GPT-5');
    expect(rows[1]!.text()).toContain('GPT-4o');
  });
});

describe('ModelPicker capability badges', () => {
  it('renders one badge per capability instead of a comma-separated string', () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models: [{
          ...models[0]!,
          capabilities: ['image_in', 'thinking'],
        }],
        current: models[0]!.id,
      },
      global: { plugins: [i18n] },
    });

    const row = wrapper.get('.model-row');
    expect(row.findAll('.cap-badge')).toHaveLength(2);
    expect(row.get('.caps').attributes('role')).toBe('group');
    expect(row.find('.caps').text()).not.toContain(',');
    expect(row.findAll('.cap-badge svg')).toHaveLength(2);
    expect(row.findAll('.cap-badge').map((badge) => badge.attributes('role'))).toEqual([
      'img',
      'img',
    ]);
    expect(row.find('[data-capability="image_in"]').attributes('title')).toBe('Image input');
    expect(row.find('[data-capability="thinking"]').attributes('title')).toBe('Thinking');
  });

  it('keeps an unrecognised capability visible as text', () => {
    const unknownCapability = 'future_capability';
    const wrapper = mount(ModelPicker, {
      props: {
        models: [{
          ...models[0]!,
          capabilities: [unknownCapability],
        }],
        current: models[0]!.id,
      },
      global: { plugins: [i18n] },
    });

    const badge = wrapper.get('.cap-badge.is-unknown');
    expect(badge.text()).toBe(unknownCapability);
    expect(badge.attributes('title')).toBe(`Capability: ${unknownCapability}`);
  });

  it('distinguishes adaptive reasoning from an explicit thinking capability', () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models: [
          { ...models[0]!, capabilities: ['thinking'] },
          { ...models[1]!, adaptiveThinking: true },
        ],
        current: models[0]!.id,
      },
      global: { plugins: [i18n] },
    });

    const explicitThinking = wrapper.findAll('.model-row')[0]!;
    const adaptive = wrapper.findAll('.model-row')[1]!;
    expect(explicitThinking.find('[data-capability="thinking"]').attributes('title')).toBe('Thinking');
    expect(adaptive.find('[data-capability="adaptive-thinking"]').attributes('title')).toBe('Adaptive reasoning');
    expect(adaptive.find('[data-capability="thinking"]').exists()).toBe(false);
    // Row 0 is the current model, so a bare `path` would match its checkmark.
    expect(explicitThinking.find('[data-capability="thinking"] path').attributes('d')).not.toBe(
      adaptive.find('[data-capability="adaptive-thinking"] path').attributes('d'),
    );
  });
});

describe('ModelPicker sizing and source guards', () => {
  it('derives row and search-field sizes from the UI font token', () => {
    const rule = (selector: string): string =>
      modelPickerSource.match(new RegExp(`\\.${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'u'))?.[1] ?? '';
    const rowRule = rule('model-row');
    const searchRule = rule('search-input');

    expect(rowRule).toContain('height: calc(var(--ui-font-size) + 18px);');
    expect(rowRule).toContain('font-size: calc(var(--ui-font-size) - 1px);');
    expect(rowRule).toContain('padding: 0 8px;');
    expect(rowRule).toContain('border-radius: var(--r-md);');
    expect(rowRule).toContain('content-visibility: auto;');
    expect(rowRule).toContain('contain-intrinsic-size: calc(var(--ui-font-size) + 18px);');
    expect(searchRule).toContain('height: calc(var(--ui-font-size) + 13px);');
    expect(searchRule).toContain('font-size: calc(var(--ui-font-size) - 1px);');
    expect(modelPickerSource).toContain('Default 14px: 14 + 18 = 32px; 14 - 1 = 13px.');
  });

  it('keeps the model picker free of dark utilities and new color literals', () => {
    expect(modelPickerSource).not.toMatch(/\bdark:/u);

    const colorLiteral = /#[\da-f]{3,8}|rgba?\s*\(/iu;
    const colorLines = modelPickerSource.split('\n').filter((line) => colorLiteral.test(line));
    expect(colorLines).toHaveLength(3);
    expect(colorLines[0]).toMatch(/Light only/u);
    expect(colorLines[1]).toMatch(/background:/u);
    expect(colorLines[2]).toMatch(/box-shadow:/u);
  });
});

describe('ModelPicker search and keyboard selection', () => {
  it('narrows search results and moves selection with arrow keys', async () => {
    const wrapper = mount(ModelPicker, {
      props: {
        models,
        current: models[0]!.id,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.find('.search-input').setValue('gpt');
    expect(wrapper.findAll('.model-row')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('Pythinker K2');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await nextTick();

    const rows = wrapper.findAll('.model-row');
    expect(rows[0]!.classes()).not.toContain('is-selected');
    expect(rows[1]!.classes()).toContain('is-selected');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(wrapper.emitted('select')).toEqual([['openai/gpt-4o']]);
  });
});
