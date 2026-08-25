import { mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import webI18n from '../src/i18n';
import Composer from '../src/components/chat/Composer.vue';

vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: () => ({}),
  measureNaturalWidth: () => 100,
}));

let toolbarObserver: ResizeObserverCallback | undefined;

const slotStub = defineComponent({
  props: ['text'],
  template: '<span :data-tooltip="text"><slot /></span>',
});

describe('Composer toolbar overflow valves', () => {
  beforeEach(() => {
    toolbarObserver = undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(element: Element): void {
          if (element.classList.contains('toolbar')) toolbarObserver = this.callback;
        }
        disconnect(): void {}
      },
    );
  });

  it('uses actual model overflow before hiding permission text or the model name', async () => {
    const wrapper = mount(Composer, {
      props: {
        status: {
          model: 'A very long model name',
          modelId: 'model-1',
          ctxUsed: 10,
          ctxMax: 100,
          permission: 'manual',
          branch: 'main',
          cwd: '/workspace',
          isGitRepo: true,
        },
        models: [{
          id: 'model-1',
          provider: 'provider',
          model: 'A very long model name',
          maxContextSize: 100,
        }],
      },
      global: {
        plugins: [webI18n],
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          Icon: true,
          IconButton: slotStub,
          MentionMenu: true,
          SegmentedControl: true,
          SlashMenu: true,
          Spinner: true,
          Tooltip: slotStub,
        },
      },
    });
    await nextTick();

    let toolbarWidth = 210;
    const toolbar = wrapper.get('.toolbar').element as HTMLElement;
    const modelName = wrapper.get('.mp-name').element as HTMLElement;
    toolbar.getBoundingClientRect = () => ({ width: toolbarWidth }) as DOMRect;
    Object.defineProperties(modelName, {
      clientWidth: { configurable: true, get: () => 40 },
      scrollWidth: { configurable: true, get: () => 180 },
    });
    modelName.getBoundingClientRect = () => ({ width: 40 }) as DOMRect;

    expect(toolbarObserver).toBeDefined();
    toolbarObserver?.([], {} as ResizeObserver);
    await nextTick();
    await nextTick();

    expect(wrapper.get('.composer-card').classes()).toContain('labels-collapsed');
    expect(wrapper.get('.model-pill').classes()).toContain('icon-only');
    expect(wrapper.find('.mp-name').exists()).toBe(false);
    expect(wrapper.get('.model-pill').attributes('aria-label')).toContain('A very long model name');

    toolbarWidth = 400;
    toolbarObserver?.([], {} as ResizeObserver);
    await nextTick();
    await nextTick();

    expect(wrapper.get('.composer-card').classes()).not.toContain('labels-collapsed');
    expect(wrapper.get('.model-pill').classes()).not.toContain('icon-only');
    expect(wrapper.get('.perm-pill-label').text()).toBe('Manual');
  });

  it('opens thinking effort separately from the model list', async () => {
    const wrapper = mount(Composer, {
      props: {
        status: {
          model: 'Example model',
          modelId: 'model-1',
          ctxUsed: 10,
          ctxMax: 100,
          permission: 'manual',
          branch: 'main',
          cwd: '/workspace',
          isGitRepo: true,
        },
        thinking: 'high',
        models: [{
          id: 'model-1',
          provider: 'provider',
          model: 'Example model',
          maxContextSize: 100,
          capabilities: ['thinking', 'always_thinking'],
          supportEfforts: ['low', 'high', 'max'],
          defaultEffort: 'high',
        }],
      },
      global: {
        plugins: [webI18n],
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          Icon: true,
          IconButton: slotStub,
          MentionMenu: true,
          SlashMenu: true,
          Spinner: true,
          Tooltip: slotStub,
        },
      },
    });
    await nextTick();

    expect(wrapper.get('.model-pill').text()).not.toContain('high');
    await wrapper.get('.model-pill').trigger('click');
    expect(wrapper.find('.model-dropdown').exists()).toBe(true);
    expect(wrapper.find('.model-dropdown .md-thinking').exists()).toBe(false);

    await wrapper.get('.thinking-pill').trigger('click');
    expect(wrapper.find('.model-dropdown').exists()).toBe(false);
    expect(wrapper.find('.thinking-dropdown').exists()).toBe(true);
    const max = wrapper.findAll('.thinking-dropdown [role="tab"]')
      .find((tab) => tab.text() === 'Max');
    await max!.trigger('click');

    expect(wrapper.emitted('setThinking')?.at(-1)).toEqual(['max']);
  });
});
