import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

  it('hides the expiry warning at five minutes and shows it at four minutes fifty-nine seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    try {
      const boundary = mountCard(question(new Date(Date.now() + 5 * 60_000).toISOString()));
      const soon = mountCard(question(new Date(Date.now() + 4 * 60_000 + 59_000).toISOString()));

      expect(boundary.find('.qexpires').exists()).toBe(false);
      expect(soon.find('.qexpires').exists()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores Enter while minimized', async () => {
    const wrapper = mountCard(question(new Date(Date.now() + 20 * 60_000).toISOString()));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const answerCount = wrapper.emitted('answer')?.length ?? 0;

    expect(answerCount).toBe(1);

    await wrapper.find('.qmin').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(wrapper.emitted('answer')).toHaveLength(answerCount);
  });
});
