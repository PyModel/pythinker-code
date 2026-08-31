import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import webI18n from '../src/i18n';
import AsyncLoadFailed from '../src/components/ui/AsyncLoadFailed.vue';
import ErrorBoundary from '../src/components/ui/ErrorBoundary.vue';

const sidebarSource = readFileSync(
  join(import.meta.dirname, '../src/components/Sidebar.vue'),
  'utf8',
);

const Boom = defineComponent({
  props: { explode: { type: Boolean, default: true } },
  setup(props) {
    return () => {
      if (props.explode) throw new Error('boom');
      return h('p', { class: 'recovered' }, 'ok');
    };
  },
});

describe('ErrorBoundary', () => {
  it('replaces a crashed subtree with a recoverable panel', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let explode = true;
    const wrapper = mount(
      defineComponent({
        components: { ErrorBoundary, Boom },
        setup: () => ({ get explode() { return explode; } }),
        template: '<ErrorBoundary closable><Boom :explode="explode" /></ErrorBoundary>',
      }),
      { global: { plugins: [webI18n] } },
    );
    await nextTick();

    expect(wrapper.find('.error-boundary').exists()).toBe(true);
    expect(wrapper.get('.error-boundary-title').text()).toBe('Something went wrong');
    expect(wrapper.find('.error-boundary-close').exists()).toBe(true);
    expect(wrapper.find('.recovered').exists()).toBe(false);

    explode = false;
    await wrapper.get('.error-boundary button.ui-button').trigger('click');
    await nextTick();

    expect(wrapper.find('.error-boundary').exists()).toBe(false);
    expect(wrapper.find('.recovered').exists()).toBe(true);
    spy.mockRestore();
  });

  it('emits close from the corner button', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(
      defineComponent({
        components: { ErrorBoundary, Boom },
        template: '<ErrorBoundary closable><Boom /></ErrorBoundary>',
      }),
      { global: { plugins: [webI18n] } },
    );
    await nextTick();

    await wrapper.get('.error-boundary-close').trigger('click');
    expect(wrapper.findComponent(ErrorBoundary).emitted('close')).toHaveLength(1);
    spy.mockRestore();
  });

  it('renders the async-load copy and emits close', async () => {
    const wrapper = mount(AsyncLoadFailed, { global: { plugins: [webI18n] } });
    expect(wrapper.get('.error-boundary-title').text())
      .toBe('Failed to load. Close this view and try again.');
    await wrapper.get('.error-boundary-close').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('wraps the lazily loaded design-system overlay', () => {
    expect(sidebarSource).toMatch(
      /<ErrorBoundary[\s\S]{0,200}fullscreen[\s\S]{0,200}<DesignSystemView/u,
    );
    expect(sidebarSource).toMatch(/errorComponent: DesignSystemLoadFailed/u);
    expect(sidebarSource).toContain('h(AsyncLoadFailed, { onClose: closeDesignSystem })');
  });
});

describe('sidebar footer', () => {
  it('splits into a truncating account side and a fixed side', () => {
    expect(sidebarSource).toMatch(
      /<div class="side-footer"[^>]*>\s*<div class="side-footer-account">/u,
    );
    expect(sidebarSource).toMatch(
      /\.side-footer \{[^}]*display: flex;[^}]*\}/u,
    );
    expect(sidebarSource).toMatch(
      /\.side-footer-account \{\s*flex: 1 1 auto;\s*min-width: 0;\s*\}/u,
    );
    // The label truncates instead of pushing the fixed side out of the row.
    expect(sidebarSource).toMatch(
      /\.btn-settings-label \{[^}]*text-overflow: ellipsis;[^}]*\}/u,
    );
  });
});
