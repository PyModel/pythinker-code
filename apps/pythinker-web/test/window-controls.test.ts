import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/composables/usePythinkerWebClient', () => ({
  usePythinkerWebClient: vi.fn(),
}));

import App from '../src/App.vue';
import { usePythinkerWebClient } from '../src/composables/usePythinkerWebClient';
import enApp from '../src/i18n/locales/en/app';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { app: enApp } },
  missingWarn: false,
  fallbackWarn: false,
});

function mountApp() {
  vi.mocked(usePythinkerWebClient).mockReturnValue({
    resolveImageUrl: vi.fn(),
    initialized: ref(true),
    authReady: ref(false),
    activity: ref('idle'),
    activeSessionId: ref(null),
    onboarded: ref(true),
    warnings: ref([]),
    dismissWarning: vi.fn(),
    load: vi.fn(),
  } as never);

  return mount(App, {
    global: {
      plugins: [i18n],
      stubs: { PythinkerLogo: true, WarningToasts: true },
    },
  });
}

afterEach(() => {
  delete document.documentElement.dataset.desktopPlatform;
  delete window.pythinkerDesktop;
  window.history.replaceState(null, '', '/');
});

describe('macOS window controls', () => {
  it('renders only on darwin and closes through the desktop bridge', async () => {
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    document.documentElement.dataset.desktopPlatform = 'darwin';
    Object.defineProperty(window, 'pythinkerDesktop', {
      configurable: true,
      value: { closeWindow },
    });

    const darwinApp = mountApp();
    const controls = darwinApp.findAll('button.window-control');

    expect(controls).toHaveLength(3);
    expect(controls.map((control) => control.attributes('aria-label'))).toEqual([
      'Close',
      'Minimize',
      'Zoom',
    ]);
    await darwinApp.get('button[aria-label="Close"]').trigger('click');
    expect(closeWindow).toHaveBeenCalledOnce();
    darwinApp.unmount();

    delete document.documentElement.dataset.desktopPlatform;
    const browserApp = mountApp();
    expect(browserApp.findAll('button.window-control')).toHaveLength(0);
    browserApp.unmount();
  });
});
