import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createI18n, type I18n } from 'vue-i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PinnedSessionList from '../src/components/PinnedSessionList.vue';
import type { Session } from '../src/types';

const sessions: Session[] = Array.from({ length: 5 }, (_, index) => ({
  id: `session-${index}`,
  title: `Session ${index}`,
  time: 'now',
  busy: false,
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      sidebar: {
        pinned: 'Pinned',
        collapsePinned: 'Collapse pinned',
        expandPinned: 'Expand pinned',
        resizePinnedAria: 'Resize pinned sessions',
      },
    },
  },
});

function mountList(collapsed = false) {
  return mount(PinnedSessionList, {
    props: {
      sessions,
      activeId: '',
      collapsed,
      pendingBySession: {},
      unreadBySession: {},
    },
    global: {
      plugins: [i18n as I18n],
      stubs: {
        SessionRow: defineComponent({ template: '<div class="se">row</div>' }),
        IconButton: defineComponent({ template: '<button><slot /></button>' }),
        Icon: true,
      },
    },
  });
}

describe('PinnedSessionList', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  it('resizes vertically and persists the chosen height', async () => {
    const wrapper = mountList();
    await nextTick();
    const handle = wrapper.get('.pinned-resize');
    const before = Number(handle.attributes('aria-valuenow'));

    await handle.trigger('keydown', { key: 'ArrowDown' });

    expect(Number(handle.attributes('aria-valuenow'))).toBe(before + 16);
    expect(wrapper.get('.pinned-rows').attributes('style')).toContain(`max-height: ${before + 16}px`);
    expect(localStorage.getItem('pythinker-web.sidebar-pinned-height')).toBe(String(before + 16));
  });

  it('shows scroll-edge fades only where more rows exist', async () => {
    const wrapper = mountList();
    await nextTick();
    const rows = wrapper.get('.pinned-rows');
    Object.defineProperties(rows.element, {
      scrollTop: { configurable: true, value: 20 },
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });

    await rows.trigger('scroll');

    expect(wrapper.get('.pinned-rows-wrap').classes()).toEqual(
      expect.arrayContaining(['scrolled', 'more-below']),
    );
  });

  it('removes the rows and divider when collapsed', () => {
    const wrapper = mountList(true);

    expect(wrapper.find('.pinned-rows').exists()).toBe(false);
    expect(wrapper.find('.pinned-resize').exists()).toBe(false);
  });
});
