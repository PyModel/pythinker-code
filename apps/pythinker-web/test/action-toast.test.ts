import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActionToast from '../src/components/ui/ActionToast.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { dismiss: 'Dismiss' } } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionToast', () => {
  it('auto-dismisses after its duration and pauses while hovered', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ActionToast, {
      props: { duration: 1000, dismissToken: 'archive' },
      slots: { default: 'Session archived' },
      global: { plugins: [i18n] },
    });

    await vi.advanceTimersByTimeAsync(400);
    await wrapper.get('.ui-action-toast').trigger('pointerenter');
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    await wrapper.get('.ui-action-toast').trigger('pointerleave');
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.emitted('dismiss')).toEqual([['archive']]);
  });
});
