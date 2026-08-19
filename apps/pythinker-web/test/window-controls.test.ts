import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WindowControls from '../src/components/WindowControls.vue';

function mountControls() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: { en: {} },
    missingWarn: false,
    fallbackWarn: false,
  });
  return mount(WindowControls, { global: { plugins: [i18n] } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'pythinkerDesktop');
});

describe('WindowControls', () => {
  it('stays out of the browser and macOS chrome', () => {
    expect(mountControls().find('.window-controls').exists()).toBe(false);

    Object.defineProperty(window, 'pythinkerDesktop', {
      value: { platform: 'darwin' },
      configurable: true,
    });
    expect(mountControls().find('.window-controls').exists()).toBe(false);
  });

  it('drives the desktop window from the Windows caption buttons', async () => {
    const bridge = {
      platform: 'win32',
      minimizeWindow: vi.fn(async () => {}),
      toggleMaximizeWindow: vi.fn(async () => {}),
      closeWindow: vi.fn(async () => {}),
    };
    Object.defineProperty(window, 'pythinkerDesktop', { value: bridge, configurable: true });

    const wrapper = mountControls();
    await wrapper.get('.wc-min').trigger('click');
    await wrapper.get('.wc-max').trigger('click');
    await wrapper.get('.wc-close').trigger('click');

    expect(bridge.minimizeWindow).toHaveBeenCalledTimes(1);
    expect(bridge.toggleMaximizeWindow).toHaveBeenCalledTimes(1);
    expect(bridge.closeWindow).toHaveBeenCalledTimes(1);
    // Close sits on the trailing edge, where a Windows user reaches for it.
    expect(wrapper.findAll('.wc').at(-1)!.classes()).toContain('wc-close');
  });
});
