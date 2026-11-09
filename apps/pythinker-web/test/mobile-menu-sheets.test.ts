import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import webI18n from '../src/i18n';
import Composer from '../src/components/chat/Composer.vue';
import MentionMenu from '../src/components/chat/MentionMenu.vue';
import SlashMenu from '../src/components/chat/SlashMenu.vue';
import ModelPicker from '../src/components/settings/ModelPicker.vue';

vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: () => ({}),
  measureNaturalWidth: () => 100,
}));

const slotStub = defineComponent({ template: '<span><slot /></span>' });

describe('mobile composer and model sheets', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('opens the add menu and slash commands as bottom sheets', async () => {
    const wrapper = mount(Composer, {
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

    await wrapper.get('.composer-attach').trigger('click');
    expect(document.body.querySelector('.sheet-root .msheet-add')).not.toBeNull();
    expect(wrapper.find('.add-menu').exists()).toBe(false);

    const commandRow = [...document.body.querySelectorAll<HTMLButtonElement>('.msheet-add .am-row')]
      .find((row) => row.textContent?.includes('Commands'));
    expect(commandRow).toBeDefined();
    commandRow?.click();
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('.sheet-root .slash-menu.is-sheet')).not.toBeNull();
    wrapper.unmount();
  });

  it('removes popup framing from slash and mention lists in sheet layout', () => {
    const slash = mount(SlashMenu, {
      props: { items: [], activeIndex: 0, layout: 'sheet' },
      global: { plugins: [webI18n] },
    });
    const mention = mount(MentionMenu, {
      props: { items: [], activeIndex: 0, layout: 'sheet' },
      global: { plugins: [webI18n] },
    });

    expect(slash.get('.slash-menu').classes()).toContain('is-sheet');
    expect(mention.get('.mention-menu').classes()).toContain('is-sheet');
    slash.unmount();
    mention.unmount();
  });

  it('renders the full model picker in the mobile bottom-sheet surface', () => {
    const wrapper = mount(ModelPicker, {
      props: { models: [], current: '' },
      global: { plugins: [webI18n] },
    });

    expect(wrapper.find('.sheet-root').exists()).toBe(true);
    expect(wrapper.find('.mp--sheet').exists()).toBe(true);
    expect(wrapper.find('.ui-dialog__overlay').exists()).toBe(false);
    wrapper.unmount();
  });
});
