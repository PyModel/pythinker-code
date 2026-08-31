import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import webI18n from '../src/i18n';
import Composer from '../src/components/chat/Composer.vue';
import AttachmentChip from '../src/components/chat/AttachmentChip.vue';
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

describe('attachment media preview', () => {
  it('keeps the preview open while the pointer crosses from the pill to its actions', async () => {
    vi.useFakeTimers();
    const wrapper = mount(AttachmentChip, {
      attachTo: document.body,
      props: {
        kind: 'image',
        name: 'example.png',
        url: 'data:image/png;base64,AAAA',
      },
      global: { plugins: [webI18n] },
    });
    wrappers.push(wrapper);

    await wrapper.get('.att-chip').trigger('mouseenter');
    await nextTick();
    const tip = document.body.querySelector<HTMLElement>('.att-tip');
    expect(tip).not.toBeNull();

    await wrapper.get('.att-chip').trigger('mouseleave');
    tip!.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(150);
    expect(document.body.querySelector('.att-tip')).not.toBeNull();

    document.body.querySelector<HTMLButtonElement>('.att-tip-open')?.click();
    expect(wrapper.emitted('activate')).toHaveLength(1);

    tip!.dispatchEvent(new MouseEvent('mouseleave'));
    await vi.advanceTimersByTimeAsync(121);
    expect(document.body.querySelector('.att-tip')).toBeNull();
  });
});
