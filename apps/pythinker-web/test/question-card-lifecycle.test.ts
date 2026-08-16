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
        expiresSoon: 'Expires in {minutes} min',
        expiresSoonSeconds: 'Expires in less than a minute',
      },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const mounted: ReturnType<typeof mount>[] = [];

function question(expiresAt: string): UIQuestion {
  return {
    questionId: 'qreq_1',
    sessionId: 'sess_1',
    expiresAt,
    questions: [
      {
        id: 'q1',
        question: 'Pick one',
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
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

describe('QuestionCard lifecycle', () => {
  it('does not dismiss when Escape is pressed', () => {
    const wrapper = mountCard(question(new Date(Date.now() + 20 * 60_000).toISOString()));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(wrapper.emitted('dismiss')).toBeUndefined();
  });

  it('shows an expiry warning within five minutes and hides it at twenty minutes', () => {
    const soon = mountCard(question(new Date(Date.now() + 2 * 60_000).toISOString()));
    const later = mountCard(question(new Date(Date.now() + 20 * 60_000).toISOString()));

    expect(soon.find('.qexpires').text()).toBe('Expires in 2 min');
    expect(later.find('.qexpires').exists()).toBe(false);
  });
});
