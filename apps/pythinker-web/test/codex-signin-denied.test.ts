import { mount } from '@vue/test-utils';
import { ref, readonly } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import webI18n from '../src/i18n';

const phase = ref<string>('cancelled');

vi.mock('../src/composables/useCodexLogin', () => ({
  useCodexLogin: () => ({
    phase: readonly(phase),
    busy: ref(false),
    authorizeUrl: ref(null),
    error: ref(null),
    start: vi.fn(),
    cancel: vi.fn(),
    submitRedirect: vi.fn(),
  }),
}));
vi.mock('../src/composables/usePythinkerWebClient', () => ({
  usePythinkerWebClient: () => ({
    refreshRuntimeState: vi.fn(),
    authReady: ref(true),
  }),
}));

const CodexSignIn = (await import('../src/components/settings/CodexSignIn.vue')).default;

describe('Codex sign-in denial', () => {
  it('names a cancelled sign-in instead of silently offering the button again', async () => {
    phase.value = 'cancelled';
    const wrapper = mount(CodexSignIn, { global: { plugins: [webI18n] } });

    expect(wrapper.get('.codex-signin__denied').text()).toBe('Sign-in cancelled');
    expect(wrapper.find('[data-testid="codex-signin-start"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows no denial line on a fresh, untouched form', () => {
    phase.value = 'idle';
    const wrapper = mount(CodexSignIn, { global: { plugins: [webI18n] } });

    expect(wrapper.find('.codex-signin__denied').exists()).toBe(false);
    wrapper.unmount();
  });
});
