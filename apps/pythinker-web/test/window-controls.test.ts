import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WindowControls from '../src/components/WindowControls.vue';

const windowControlsSource = readFileSync(
  join(import.meta.dirname, '../src/components/WindowControls.vue'),
  'utf8',
);
const settingsPaneSource = readFileSync(
  join(import.meta.dirname, '../src/components/settings/SettingsPane.vue'),
  'utf8',
);

function pixels(source: string, pattern: RegExp): number {
  const value = source.match(pattern)?.[1];
  if (value === undefined) throw new Error(`Missing CSS value: ${pattern.source}`);
  return Number(value);
}

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
  delete document.documentElement.dataset['desktopPlatform'];
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'pythinkerDesktop');
});

describe('WindowControls', () => {
  it('stays out of the browser and macOS chrome', () => {
    expect(mountControls().find('.window-controls').exists()).toBe(false);

    document.documentElement.dataset['desktopPlatform'] = 'darwin';
    expect(mountControls().find('.window-controls').exists()).toBe(false);
  });

  it('drives the desktop window from the Windows caption buttons', async () => {
    document.documentElement.dataset['desktopPlatform'] = 'win32';
    const bridge = {
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

  it('reserves the full Windows control cluster in the settings pane', () => {
    const buttonWidth = pixels(windowControlsSource, /\.wc\s*\{[^}]*width:\s*(\d+)px;/su);
    const gap = pixels(windowControlsSource, /\.window-controls\s*\{[^}]*gap:\s*(\d+)px;/su);
    const inset = pixels(windowControlsSource, /\.window-controls\s*\{[^}]*right:\s*(\d+)px;/su);
    const paneReserve = pixels(
      settingsPaneSource,
      /data-desktop-platform='win32'[^}]*padding-right:\s*(\d+)px;/su,
    );

    expect(paneReserve).toBe(buttonWidth * 3 + gap * 2 + inset);
  });
});
