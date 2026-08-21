import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import ThinkingBlock from '../src/components/chat/ThinkingBlock.vue';
import enThinking from '../src/i18n/locales/en/thinking';

const i18n = createI18n({ legacy: false, messages: { en: { thinking: enThinking } } });

function mountBlock(props: Record<string, unknown> = {}) {
  return mount(ThinkingBlock, {
    props,
    global: { plugins: [i18n] },
  });
}

/** jsdom lacks the `inert` IDL attribute, so Vue falls back to writing the
 *  literal attribute there; real browsers get the DOM property. Cover both. */
function isInert(wrapper: ReturnType<typeof mountBlock>): boolean {
  const el = wrapper.get('.think-body').element as HTMLElement;
  if ('inert' in el) return el.inert === true;
  return el.getAttribute('inert') === 'true';
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ThinkingBlock', () => {
  it('renders a collapsed settled head with the title and no time label', () => {
    const wrapper = mountBlock({ text: 'chain of thought' });

    const head = wrapper.get('.think-head');
    expect(head.text()).toContain('Thinking');
    // Settled blocks use the panel title, not the streaming label.
    expect(head.text()).not.toContain('Thinking…');
    expect(wrapper.find('.think-time').exists()).toBe(false);
    expect(isInert(wrapper)).toBe(true);
    expect(wrapper.get('button.think-head').exists()).toBe(true);
  });

  it('expands the full text inline on head click and folds back', async () => {
    const wrapper = mountBlock({ text: 'chain of thought' });

    await wrapper.get('.think-head').trigger('click');
    expect(isInert(wrapper)).toBe(false);
    expect(wrapper.get('.think-text').text()).toBe('chain of thought');
    expect(wrapper.get('.think').classes()).toContain('open');

    await wrapper.get('.think-head').trigger('click');
    expect(isInert(wrapper)).toBe(true);
  });

  it('labels the streaming state and collapses when the stream ends', async () => {
    const wrapper = mountBlock({ text: 'live', streaming: true });
    expect(wrapper.get('.think-title').text()).toBe('Thinking…');
    expect(wrapper.get('.think').classes()).toContain('streaming');

    await wrapper.setProps({ streaming: false });
    expect(wrapper.get('.think-title').text()).toBe('Thinking');
    expect(wrapper.get('.think').classes()).not.toContain('streaming');
    expect(isInert(wrapper)).toBe(true);
  });

  it('ticks a live timer from startedAtMs while streaming', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const startedAtMs = Date.now() - 7000;
    const wrapper = mountBlock({ text: 'live', streaming: true, startedAtMs });
    await nextTick();

    expect(wrapper.get('.think-time').text()).toBe('7s');

    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(wrapper.get('.think-time').text()).toBe('10s');
  });

  it('folds a block opened while streaming once the stream ends', async () => {
    const wrapper = mountBlock({ text: 'live', streaming: true });

    await wrapper.get('.think-head').trigger('click');
    expect(isInert(wrapper)).toBe(false);

    await wrapper.setProps({ streaming: false });
    expect(isInert(wrapper)).toBe(true);
    expect(wrapper.get('.think-title').text()).toBe('Thinking');
  });

  it('renders the settled duration as a faint tail fragment', () => {
    const wrapper = mountBlock({ text: 'done thinking', durationMs: 7000 });
    expect(wrapper.get('.think-time').text()).toBe('· 7s');
  });

  it('forceOpen renders a static always-open block without a toggle', () => {
    const wrapper = mountBlock({ text: 'pinned open', forceOpen: true });

    expect(wrapper.find('button.think-head').exists()).toBe(false);
    expect(wrapper.get('.think-head').classes()).toContain('is-static');
    expect(wrapper.find('.think-car').exists()).toBe(false);
    expect(isInert(wrapper)).toBe(false);
  });
});
