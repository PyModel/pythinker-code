import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import webI18n from '../src/i18n';
import Composer from '../src/components/chat/Composer.vue';
import Menu from '../src/components/ui/Menu.vue';
import Tooltip from '../src/components/ui/Tooltip.vue';

vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: () => ({}),
  measureNaturalWidth: () => 100,
}));

const slotStub = defineComponent({ template: '<span><slot /></span>' });

const wrappers: VueWrapper[] = [];

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('menu tooltip ownership', () => {
  it('hides an outside tooltip when a menu opens', async () => {
    vi.useFakeTimers();
    wrappers.push(mount(Tooltip, {
      props: { text: 'Outside tooltip' },
      slots: { default: '<button class="outside-trigger">Outside</button>' },
      attachTo: document.body,
    }));

    document.querySelector<HTMLElement>('.outside-trigger')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(150);
    await nextTick();
    expect(document.body.querySelector('.ui-tip__bubble')).not.toBeNull();

    wrappers.push(mount(Menu, { attachTo: document.body }));
    await nextTick();

    expect(document.body.querySelector('.ui-tip__bubble')).toBeNull();
  });

  it('still shows a tooltip owned by the open menu', async () => {
    vi.useFakeTimers();
    wrappers.push(mount(defineComponent({
      components: { Menu, Tooltip },
      template: '<Menu><Tooltip text="Menu tooltip"><button class="menu-trigger">Menu item</button></Tooltip></Menu>',
    }), { attachTo: document.body }));

    document.querySelector<HTMLElement>('.menu-trigger')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(150);
    await nextTick();

    expect(document.body.querySelector('.ui-tip__bubble')?.textContent).toContain('Menu tooltip');
  });

  it('hides an outside tooltip when a custom Composer menu opens', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    wrappers.push(mount(Tooltip, {
      props: { text: 'Outside tooltip' },
      slots: { default: '<button class="outside-trigger">Outside</button>' },
      attachTo: document.body,
    }));
    const composer = mount(Composer, {
      attachTo: document.body,
      global: {
        plugins: [webI18n],
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          Icon: true,
          IconButton: slotStub,
          SegmentedControl: true,
          Spinner: true,
          Tooltip: slotStub,
        },
      },
    });
    wrappers.push(composer);

    document.querySelector<HTMLElement>('.outside-trigger')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(150);
    await nextTick();
    expect(document.body.querySelector('.ui-tip__bubble')).not.toBeNull();

    await composer.get('.composer-attach').trigger('click');
    await nextTick();

    expect(document.body.querySelector('.ui-tip__bubble')).toBeNull();
  });
});
