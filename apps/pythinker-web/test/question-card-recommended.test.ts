import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it } from 'vitest';

import QuestionCard from '../src/components/QuestionCard.vue';
import type { UIQuestion } from '../src/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      question: {
        title: 'Question',
        step: '{current}/{total}',
        prev: 'Prev',
        next: 'Next',
        expand: 'Expand',
        minimize: 'Minimize',
        otherDefault: 'Other',
        submit: 'Submit',
        dismiss: 'Dismiss',
        notes: 'Notes',
        notesPlaceholder: 'Add notes on this option',
      },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const mounted: ReturnType<typeof mount>[] = [];

function question(overrides: Partial<UIQuestion['questions'][number]> = {}): UIQuestion {
  return {
    questionId: 'qreq_1',
    sessionId: 'sess_1',
    questions: [
      {
        id: 'q1',
        question: 'Pick one',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', recommended: true },
        ],
        ...overrides,
      },
    ],
  };
}

function mountCard(input: UIQuestion) {
  const wrapper = mount(QuestionCard, {
    props: { question: input },
    global: {
      plugins: [i18n],
      stubs: {
        Markdown: {
          props: ['text'],
          template: '<pre class="markdown-stub">{{ text }}</pre>',
        },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('QuestionCard recommended defaults', () => {
  it('preselects the recommended single-select option so Enter submits it', async () => {
    const wrapper = mountCard(question());
    const options = wrapper.findAll('.qopt');

    expect(options[1]!.classes()).toContain('selected');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(wrapper.emitted('answer')?.[0]?.[1]).toMatchObject({
      answers: {
        q1: { kind: 'single', optionId: 'b' },
      },
    });
  });

  it('preselects all recommended multi-select options', () => {
    const wrapper = mountCard(question({
      multiSelect: true,
      options: [
        { id: 'a', label: 'A', recommended: true },
        { id: 'b', label: 'B', description: 'recommended' },
        { id: 'c', label: 'C' },
      ],
    }));

    expect(wrapper.findAll('.qopt').map((option) => option.classes().includes('selected'))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('shows the selected option preview and suppresses Other', async () => {
    const wrapper = mountCard(question({
      allowOther: true,
      options: [
        { id: 'a', label: 'A', preview: 'Preview A' },
        { id: 'b', label: 'B', preview: 'Preview B', recommended: true },
      ],
    }));

    expect(wrapper.find('.qpreview').text()).toContain('Preview B');
    expect(wrapper.find('.other-input').exists()).toBe(false);

    await wrapper.findAll('.qopt')[0]!.trigger('click');
    expect(wrapper.find('.qpreview').text()).toContain('Preview A');
    expect(wrapper.find('.qpreview').text()).not.toContain('Preview B');
  });

  it('submits the selected preview and trimmed notes as annotations', async () => {
    const wrapper = mountCard(question({
      options: [
        { id: 'a', label: 'A', preview: 'Preview A' },
        { id: 'b', label: 'B', preview: 'Preview B', recommended: true },
      ],
    }));

    await wrapper.find('.qnotes-input').setValue('  Prefer this layout.  ');
    await wrapper.find('.qbtn.pri').trigger('click');

    expect(wrapper.emitted('answer')?.[0]?.[1]).toMatchObject({
      annotations: {
        'Pick one': {
          preview: 'Preview B',
          notes: 'Prefer this layout.',
        },
      },
    });
  });
});
