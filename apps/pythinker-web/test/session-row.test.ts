import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it } from 'vitest';

import SessionRow from '../src/components/SessionRow.vue';
import enSidebar from '../src/i18n/locales/en/sidebar';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { sidebar: enSidebar } },
});

const session = {
  id: 's1',
  title: 'Ship the release',
  time: '2h',
  updatedAt: '2026-08-20T09:07:00.000Z',
};

async function openKebabMenu() {
  const wrapper = mount(SessionRow, {
    props: { session: session as never },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  await wrapper.find('.kebab').trigger('click');
  await nextTick();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SessionRow kebab menu', () => {
  it('labels the timestamp instead of showing a bare date', async () => {
    const wrapper = await openKebabMenu();
    const stamp = document.body.querySelector('.menu-time')?.textContent?.trim() ?? '';
    expect(stamp).toContain('Last updated:');
    expect(stamp).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    wrapper.unmount();
  });
});
