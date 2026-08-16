import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import MascotSprite from '../src/components/MascotSprite.vue';

afterEach(() => {
  vi.useRealTimers();
});

describe('MascotSprite', () => {
  it('renders the failed APNG without joining pose alternation', async () => {
    vi.useFakeTimers();
    const wrapper = mount(MascotSprite, { props: { state: 'failed' } });

    const src = wrapper.get('img').attributes('src');
    expect(src).toContain('mascot-failed');

    vi.advanceTimersByTime(5000);
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toBe(src);
  });

  it('alternates its APNG poses after each full play', async () => {
    vi.useFakeTimers();
    const wrapper = mount(MascotSprite, { props: { state: 'waiting' } });

    expect(wrapper.get('img').attributes('src')).toContain('mascot-laptop');

    vi.advanceTimersByTime(1800);
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toContain('mascot-review');

    vi.advanceTimersByTime(1500);
    await nextTick();
    expect(wrapper.get('img').attributes('src')).toContain('mascot-laptop');
  });
});
