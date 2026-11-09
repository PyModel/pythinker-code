import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import webI18n from '../src/i18n';
import QuestionCard from '../src/components/chat/QuestionCard.vue';
import ResizeHandle from '../src/components/ResizeHandle.vue';
import type { UIQuestion } from '../src/types';

vi.mock('markstream-vue', () => {
  const noop = (): void => undefined;
  return {
    MarkdownRender: defineComponent({
      name: 'MarkdownRenderStub',
      props: ['content'],
      setup(props) {
        return () => String(props.content ?? '');
      },
    }),
    enableKatex: noop,
    enableMermaid: noop,
    setKaTeXWorker: noop,
    clearKaTeXWorker: noop,
    setMermaidWorker: noop,
    clearMermaidWorker: noop,
  };
});
vi.mock('markstream-vue/workers/katexRenderer.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));
vi.mock('markstream-vue/workers/mermaidParser.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));

afterEach(() => {
  window.localStorage.clear();
});

function mountHandle(reverse = false) {
  return mount(ResizeHandle, {
    props: { storageKey: `test-rh-${reverse}`, defaultWidth: 300, min: 200, max: 500, reverse },
    global: { plugins: [webI18n] },
  });
}

describe('ResizeHandle keyboard operation', () => {
  it('exposes the separator as a focusable, valued control', () => {
    const wrapper = mountHandle();
    const handle = wrapper.get('.rh');

    expect(handle.attributes('tabindex')).toBe('0');
    expect(handle.attributes('aria-valuenow')).toBe('300');
    expect(handle.attributes('aria-valuemin')).toBe('200');
    expect(handle.attributes('aria-valuemax')).toBe('500');
    wrapper.unmount();
  });

  it('resizes with the arrow keys and takes a larger step with Shift', async () => {
    const wrapper = mountHandle();
    const handle = wrapper.get('.rh');

    await handle.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([316]);

    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([300]);

    await handle.trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([348]);
    wrapper.unmount();
  });

  it('inverts the arrow direction on a reversed handle', async () => {
    const wrapper = mountHandle(true);

    await wrapper.get('.rh').trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([284]);
    wrapper.unmount();
  });

  it('ignores keys that are not a horizontal arrow', async () => {
    const wrapper = mountHandle();
    await wrapper.get('.rh').trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.emitted('update:width')).toHaveLength(1);
    wrapper.unmount();
  });
});

function question(over: Partial<UIQuestion['questions'][number]> = {}): UIQuestion {
  return {
    questionId: 'q1',
    sessionId: 'sess_1',
    questions: [
      {
        id: 'i1',
        question: 'Pick one',
        options: [{ id: 'a', label: 'Option A' }],
        allowOther: true,
        otherLabel: 'Something else',
        ...over,
      },
    ],
  };
}

describe('QuestionCard other row', () => {
  it('describes the free-text answer beside the label', () => {
    const wrapper = mount(QuestionCard, {
      props: { question: question({ otherDescription: 'Describe it in your own words' }) },
      global: { plugins: [webI18n] },
    });

    const other = wrapper.get('.qopt-text-other');
    expect(other.get('.qopt-label').text()).toBe('Something else');
    expect(other.get('.qopt-desc').text()).toBe('Describe it in your own words');
    // The label block only takes the width it needs, leaving the row to the input.
    expect(wrapper.find('.qopt-text-other + .other-input').exists()).toBe(true);
    wrapper.unmount();
  });

  it('omits the description line when the question carries none', () => {
    const wrapper = mount(QuestionCard, {
      props: { question: question() },
      global: { plugins: [webI18n] },
    });

    expect(wrapper.get('.qopt-text-other').find('.qopt-desc').exists()).toBe(false);
    wrapper.unmount();
  });
});
