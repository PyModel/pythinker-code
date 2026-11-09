import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';

import ThinkingIndicator from '../src/components/ui/ThinkingIndicator.vue';
import { usePageTitle } from '../src/composables/usePageTitle';
import { BRAILLE_SPINNER_FRAMES, BRAILLE_SPINNER_FRAME_MS } from '../src/lib/brailleSpinner';

describe('thinking indicator', () => {
  it('renders the shared Braille animation frames', () => {
    const wrapper = mount(ThinkingIndicator);

    expect(wrapper.findAll('.ui-thinking-indicator__frame').map((frame) => frame.text())).toEqual(
      BRAILLE_SPINNER_FRAMES,
    );
    expect(wrapper.attributes('role')).toBe('status');
  });

  it('keeps one stable mark in the running page title without a timer', async () => {
    vi.useFakeTimers();
    const running = ref(false);
    const showAuthGate = ref(false);
    const Harness = defineComponent({
      setup() {
        usePageTitle({ running, showAuthGate });
        return () => null;
      },
    });
    const wrapper = mount(Harness, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
      },
    });

    running.value = true;
    await nextTick();

    expect(document.title).toBe('• Pythinker Code Web');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(BRAILLE_SPINNER_FRAME_MS);
    await nextTick();
    expect(document.title).toBe('• Pythinker Code Web');
    wrapper.unmount();
    vi.useRealTimers();
  });
});
