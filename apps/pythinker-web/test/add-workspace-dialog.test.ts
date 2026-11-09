import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AddWorkspaceDialog from '../src/components/dialogs/AddWorkspaceDialog.vue';
import { messages } from '../src/i18n/locales';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('AddWorkspaceDialog', () => {
  it('makes the selected folder and add action clear', async () => {
    const browseFs = vi.fn(async (path?: string) => ({
      path: path ?? '/projects/sample',
      parent: '/projects',
      entries: [
        { name: 'src', path: '/projects/sample/src', isDir: true },
      ],
    }));
    const wrapper = mount(AddWorkspaceDialog, {
      attachTo: document.body,
      props: {
        browseFs,
        getFsHome: vi.fn(async () => ({ home: '/projects', recentRoots: [] })),
        defaultPath: '/projects/sample',
      },
      global: { plugins: [i18n], stubs: { teleport: true } },
    });
    await flushPromises();

    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.text()).toContain('Add workspace');
    expect(wrapper.get('.crumb.last').text()).toBe('sample');

    await wrapper.get('.ui-button--primary').trigger('click');
    expect(wrapper.emitted('add')).toEqual([['/projects/sample']]);
  });
});
