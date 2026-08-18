import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import ThinkingIndicator from '../src/components/ui/ThinkingIndicator.vue';
import { usePageTitle } from '../src/composables/usePageTitle';

describe('thinking indicator', () => {
  it('renders the exact shared Braille mark', () => {
    const wrapper = mount(ThinkingIndicator);

    expect(wrapper.text()).toBe('⣷');
    expect(wrapper.attributes('role')).toBe('status');
  });

  it('uses the same mark in the running page title', async () => {
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

    expect(document.title).toBe('⣷ Pythinker Code Web');
    wrapper.unmount();
  });
});
