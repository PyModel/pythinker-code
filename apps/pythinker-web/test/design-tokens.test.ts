import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shallowMount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { nextTick, type Ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

const darkState = vi.hoisted(() => ({ current: undefined as Ref<boolean> | undefined }));

vi.mock('../src/composables/useIsDark', async () => {
  const { ref } = await import('vue');
  darkState.current = ref(true);
  return { useIsDark: () => darkState.current };
});

vi.mock('../src/composables/usePythinkerWebClient', async () => {
  const { ref } = await import('vue');
  return {
    usePythinkerWebClient: () => ({
      activeSessionId: ref(null),
      activity: ref('idle'),
      authReady: ref(false),
      initialized: ref(true),
      load: vi.fn(),
      onboarded: ref(true),
      resolveImageUrl: vi.fn(),
      sessions: ref([]),
      visibleWorkspace: ref(null),
    }),
  };
});

import App from '../src/App.vue';

const sourcePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const mappings = {
  '--bg': 'var(--dsw-alias-bg-base)',
  '--panel': 'var(--dsw-specific-sidebar-fill)',
  '--panel2': 'var(--dsw-alias-bg-layer-3)',
  '--canvas': 'var(--dsw-alias-bg-base)',
  '--ink': 'var(--dsw-alias-label-primary)',
  '--text': 'var(--dsw-alias-label-secondary)',
  '--dim': 'var(--dsw-alias-label-tertiary)',
  '--muted': 'var(--dsw-alias-label-caption)',
  '--faint': 'var(--dsw-alias-label-dimmed)',
  '--line': 'var(--dsw-alias-border-l2)',
  '--line2': 'var(--dsw-alias-border-l1)',
  '--hover': 'var(--dsw-alias-interactive-bg-hover)',
  '--blue': 'var(--dsw-alias-brand-primary-new-colorprimary-new-color)',
  '--blue2': 'var(--dsw-static-deepseek-400)',
  '--ok': 'var(--dsw-alias-state-success-secondary)',
  '--warn': 'var(--dsw-alias-state-warn-secondary)',
  '--err': 'var(--dsw-alias-state-error-secondary)',
  '--sans': 'var(--dsw-font-family)',
  '--mono': 'var(--ds-font-family-code)',
} as const;

describe('DeepSeek design tokens', () => {
  it('resolves dark mode in the inline script before the app loads', () => {
    const html = readFileSync(sourcePath('../index.html'), 'utf8');
    const scriptStart = html.indexOf('<script>');
    const scriptEnd = html.indexOf('</script>', scriptStart);

    expect(scriptStart).toBeGreaterThanOrEqual(0);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const script = html.slice(scriptStart, scriptEnd);
    expect(script).toContain('data-ds-dark-theme');
    expect(script).toContain('dataset.colorScheme');
    expect(script).toContain('prefers-color-scheme');
  });

  it('vendors the complete token sheet on :root', () => {
    const css = readFileSync(sourcePath('../src/styles/design-platform.css'), 'utf8');

    expect(css).toContain('--dsw-alias-bg-base');
    expect(css).toMatch(/:root\s*\{/);
    expect(css).not.toMatch(/^body\s*\{/m);
  });

  it('maps all app tokens to the vendored design system', () => {
    const css = readFileSync(sourcePath('../src/style.css'), 'utf8');
    const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const matches = root.match(/^\s*--(?:bg|panel2?|canvas|ink|text|dim|muted|faint|line2?|hover|blue2?|ok|warn|err|sans|mono):\s*var\(--ds(?:w)?-[^)]+\);/gm) ?? [];

    expect(css).toContain("@import './styles/design-platform.css';");
    expect(css).toContain("@import './styles/scrollbar.css';");
    expect(css).toContain("@import './styles/shiki.css';");
    expect(matches).toHaveLength(19);
    for (const [token, value] of Object.entries(mappings)) {
      expect(root).toMatch(new RegExp(`^\\s*${token}:\\s*${value.replaceAll(/[()]/g, '\\$&')};`, 'm'));
    }
  });

  it('reflects resolved dark mode on the document root', async () => {
    darkState.current!.value = true;
    const wrapper = shallowMount(App, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
      },
    });

    expect(Object.hasOwn(document.documentElement.dataset, "dsDarkTheme")).toBe(true);
    darkState.current!.value = false;
    await nextTick();
    expect(Object.hasOwn(document.documentElement.dataset, "dsDarkTheme")).toBe(false);
    wrapper.unmount();
  });
});
