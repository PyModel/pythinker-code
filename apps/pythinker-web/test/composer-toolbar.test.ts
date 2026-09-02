import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import webI18n from '../src/i18n';
import Composer from '../src/components/chat/Composer.vue';
import { expertTalkContextKey } from '../src/composables/expertTalkContext';
import SelectionActionBar from '../src/components/chat/SelectionActionBar.vue';

vi.mock('@chenglou/pretext', () => ({
  prepareWithSegments: () => ({}),
  measureNaturalWidth: () => 100,
}));

let toolbarObserver: ResizeObserverCallback | undefined;

const slotStub = defineComponent({
  props: ['text'],
  template: '<span :data-tooltip="text"><slot /></span>',
});

const openExpertOpinion = vi.fn();
const cancelActiveExpertTalk = vi.fn(() => false);
const expertTalkControlStub = defineComponent({
  setup(_props, { expose }) {
    expose({
      available: true,
      openDialog: openExpertOpinion,
      activate: openExpertOpinion,
      cancelActive: cancelActiveExpertTalk,
    });
  },
  template: '<span />',
});

describe('selection action bar', () => {
  it('adds selected panel text to the composer payload', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const source = document.createElement('div');
    source.className = 'pt-body';
    source.textContent = 'selected text';
    document.body.append(source);
    const range = document.createRange();
    range.selectNodeContents(source);
    range.getBoundingClientRect = () =>
      ({ left: 100, bottom: 80, width: 120, height: 20 }) as DOMRect;
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const wrapper = mount(SelectionActionBar, {
      attachTo: document.body,
      props: { enabled: true, panelSource: 'src/example.ts' },
      global: { plugins: [webI18n], stubs: { Icon: true, teleport: true } },
    });

    document.dispatchEvent(new Event('selectionchange'));
    await nextTick();
    await wrapper.findAll('.sab-action')[1]!.trigger('click');

    expect(wrapper.emitted('add')).toEqual([[
      { quote: 'selected text', comment: undefined, source: 'src/example.ts' },
    ]]);
    wrapper.unmount();
    source.remove();
    selection.removeAllRanges();
    vi.unstubAllGlobals();
  });

  it('consumes Escape without closing another document-level surface', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const source = document.createElement('div');
    source.className = 'pt-body';
    source.textContent = 'selected text';
    document.body.append(source);
    const range = document.createRange();
    range.selectNodeContents(source);
    range.getBoundingClientRect = () =>
      ({ left: 100, bottom: 80, width: 120, height: 20 }) as DOMRect;
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const wrapper = mount(SelectionActionBar, {
      attachTo: document.body,
      props: { enabled: true },
      global: { plugins: [webI18n], stubs: { Icon: true, teleport: true } },
    });
    document.dispatchEvent(new Event('selectionchange'));
    await nextTick();
    expect(wrapper.find('.sab').exists()).toBe(true);

    const laterHandler = vi.fn();
    document.addEventListener('keydown', laterHandler, true);
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escape);
    await nextTick();

    expect(escape.defaultPrevented).toBe(true);
    expect(laterHandler).not.toHaveBeenCalled();
    expect(wrapper.find('.sab').exists()).toBe(false);
    document.removeEventListener('keydown', laterHandler, true);
    wrapper.unmount();
    source.remove();
    selection.removeAllRanges();
    vi.unstubAllGlobals();
  });
});

describe('Composer toolbar overflow valves', () => {
  beforeEach(() => {
    openExpertOpinion.mockClear();
    cancelActiveExpertTalk.mockReset();
    cancelActiveExpertTalk.mockReturnValue(false);
    toolbarObserver = undefined;
    window.localStorage.clear();
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

  it('opens Discussion from the add menu', async () => {
    const wrapper = mount(Composer, {
      attachTo: document.body,
      global: {
        plugins: [webI18n],
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          ExpertTalkControl: expertTalkControlStub,
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

    await wrapper.get('.composer-attach').trigger('click');
    const row = wrapper.findAll('.am-row').find((candidate) =>
      candidate.text().includes('Discussion')
    );
    expect(row?.text()).toContain('Use two models for the next message');
    await row!.trigger('click');

    expect(openExpertOpinion).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it.each([
    ['armed', { activation: { state: 'armed', armId: 'arm-1' } }, undefined],
    ['running', { activation: { state: 'idle' } }, { state: 'running' }],
  ])('names the model pill Discussion while the pair is %s', async (_label, status, run) => {
    const wrapper = mount(Composer, {
      attachTo: document.body,
      props: {
        status: { model: 'Session Model', modelId: 'provider/session', ctxUsed: 0, ctxMax: 1000, permission: 'manual', branch: '', cwd: '/tmp', isGitRepo: false },
      },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: { status: ref(status), run: ref(run) } },
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          ExpertTalkControl: expertTalkControlStub,
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

    const pill = wrapper.get('.model-pill');
    expect(pill.classes()).toContain('is-discussion');
    expect(pill.text()).toContain('Discussion');
    expect(pill.text()).not.toContain('Session Model');
    await pill.trigger('click');

    expect(openExpertOpinion).toHaveBeenCalledOnce();
    expect(wrapper.find('.model-dropdown').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes an open model dropdown when Discussion becomes engaged', async () => {
    const status = ref<{ activation: { state: string; armId?: string } }>({ activation: { state: 'idle' } });
    const wrapper = mount(Composer, {
      attachTo: document.body,
      props: {
        status: { model: 'Session Model', modelId: 'provider/session', ctxUsed: 0, ctxMax: 1000, permission: 'manual', branch: '', cwd: '/tmp', isGitRepo: false },
        models: [{ id: 'provider/session', provider: 'provider', model: 'Session Model', maxContextSize: 1000 }],
      },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: { status, run: ref(undefined) } },
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          ExpertTalkControl: expertTalkControlStub,
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

    await wrapper.get('.model-pill').trigger('click');
    expect(wrapper.find('.model-dropdown').exists()).toBe(true);

    status.value = { activation: { state: 'armed', armId: 'arm-1' } };
    await nextTick();

    expect(wrapper.find('.model-dropdown').exists()).toBe(false);
    wrapper.unmount();
  });

  it('names the model pill after the session model when Discussion is idle', async () => {
    const wrapper = mount(Composer, {
      props: {
        status: { model: 'Session Model', modelId: 'provider/session', ctxUsed: 0, ctxMax: 1000, permission: 'manual', branch: '', cwd: '/tmp', isGitRepo: false },
      },
      global: {
        plugins: [webI18n],
        provide: {
          [expertTalkContextKey as symbol]: { status: ref({ activation: { state: 'idle' } }), run: ref(undefined) },
        },
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          ExpertTalkControl: expertTalkControlStub,
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

    const pill = wrapper.get('.model-pill');
    expect(pill.classes()).not.toContain('is-discussion');
    expect(pill.text()).toContain('Session Model');
    wrapper.unmount();
  });

  it.each(['/discussion', '/expert-talk', '/expert-opinion'])(
    'opens Discussion when %s is typed',
    async (command) => {
      const wrapper = mount(Composer, {
        global: {
          plugins: [webI18n],
          stubs: {
            AttachmentChip: true,
            CapabilityMenu: true,
            ContextRing: true,
            ExpertTalkControl: expertTalkControlStub,
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
      const input = wrapper.get('textarea');

      await input.setValue(command);
      await input.trigger('keydown', { key: 'Enter' });
      await nextTick();

      expect(openExpertOpinion).toHaveBeenCalledOnce();
      expect(wrapper.emitted('submit')).toBeUndefined();
      wrapper.unmount();
    },
  );

  it('uses Escape to cancel an active Expert Talk run', async () => {
    cancelActiveExpertTalk.mockReturnValueOnce(true);
    const wrapper = mount(Composer, {
      global: {
        plugins: [webI18n],
        stubs: {
          AttachmentChip: true,
          CapabilityMenu: true,
          ContextRing: true,
          ExpertTalkControl: expertTalkControlStub,
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

    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' });

    expect(cancelActiveExpertTalk).toHaveBeenCalledOnce();
    wrapper.unmount();
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

  it('opens thinking effort separately and closes it with Escape', async () => {
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

    await wrapper.get('.thinking-pill').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.thinking-dropdown').exists()).toBe(false);

    await wrapper.get('.thinking-pill').trigger('click');
    const max = wrapper.findAll('.thinking-dropdown [role="tab"]')
      .find((tab) => tab.text() === 'Max');
    await max!.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.thinking-dropdown').exists()).toBe(false);

    await wrapper.get('.thinking-pill').trigger('click');
    const reopenedMax = wrapper.findAll('.thinking-dropdown [role="tab"]')
      .find((tab) => tab.text() === 'Max');
    await reopenedMax!.trigger('click');

    expect(wrapper.emitted('setThinking')?.at(-1)).toEqual(['max']);
  });

  it('hides the compact chip then the model pill only when the row actually clips', async () => {
    const wrapper = mount(Composer, {
      props: {
        status: {
          model: 'A very long model name',
          modelId: 'model-1',
          // >=80% context so the /compact chip is on screen to be given up.
          ctxUsed: 90,
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
    const row = wrapper.get('.toolbar-right').element as HTMLElement;
    const modelPill = wrapper.get('.model-pill').element as HTMLElement;
    const modelName = wrapper.get('.mp-name').element as HTMLElement;
    toolbar.getBoundingClientRect = () => ({ width: toolbarWidth }) as DOMRect;
    Object.defineProperties(modelName, {
      clientWidth: { configurable: true, get: () => 40 },
      scrollWidth: { configurable: true, get: () => 180 },
    });
    modelName.getBoundingClientRect = () => ({ width: 40 }) as DOMRect;
    row.getBoundingClientRect = () => ({ left: 100, width: toolbarWidth }) as DOMRect;
    // The pill starts clipped past the row's own left edge; once the row has
    // room again it sits inside it.
    let clipped = true;
    modelPill.getBoundingClientRect = () =>
      ({ left: clipped ? 0 : 120, width: 50 }) as DOMRect;

    expect(wrapper.find('.compact-chip').exists()).toBe(true);

    toolbarObserver?.([], {} as ResizeObserver);
    for (let i = 0; i < 6; i++) await nextTick();

    expect(wrapper.get('.composer-card').classes()).toContain('labels-collapsed');
    expect(wrapper.get('.model-pill').classes()).toContain('icon-only');
    expect(wrapper.get('.compact-chip').classes()).toContain('gone');
    expect(wrapper.get('.model-pill').classes()).toContain('model-gone');

    clipped = false;
    toolbarWidth = 400;
    toolbarObserver?.([], {} as ResizeObserver);
    for (let i = 0; i < 16; i++) await nextTick();

    // Stages 3 and 4 release on width alone; stages 1 and 2 are covered above.
    expect(wrapper.get('.model-pill').classes()).not.toContain('model-gone');
    expect(wrapper.get('.compact-chip').classes()).not.toContain('gone');
  });

  it('does not advance past the model pill glyph while nothing is clipped', async () => {
    const wrapper = mount(Composer, {
      props: {
        status: {
          model: 'A very long model name',
          modelId: 'model-1',
          ctxUsed: 90,
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

    const toolbar = wrapper.get('.toolbar').element as HTMLElement;
    const row = wrapper.get('.toolbar-right').element as HTMLElement;
    const modelName = wrapper.get('.mp-name').element as HTMLElement;
    toolbar.getBoundingClientRect = () => ({ width: 210 }) as DOMRect;
    Object.defineProperties(modelName, {
      clientWidth: { configurable: true, get: () => 40 },
      scrollWidth: { configurable: true, get: () => 180 },
    });
    modelName.getBoundingClientRect = () => ({ width: 40 }) as DOMRect;
    row.getBoundingClientRect = () => ({ left: 0, width: 210 }) as DOMRect;

    toolbarObserver?.([], {} as ResizeObserver);
    for (let i = 0; i < 6; i++) await nextTick();

    expect(wrapper.get('.model-pill').classes()).toContain('icon-only');
    expect(wrapper.get('.compact-chip').classes()).not.toContain('gone');
    expect(wrapper.get('.model-pill').classes()).not.toContain('model-gone');
  });

  it('warns instead of dispatching arguments to a no-argument command', async () => {
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
          MentionMenu: true,
          SegmentedControl: true,
          SlashMenu: true,
          Spinner: true,
          Tooltip: slotStub,
        },
      },
    });

    const input = wrapper.get('textarea');
    await input.setValue('/clear later');
    await input.trigger('keydown', { key: 'Enter' });
    await nextTick();

    expect(wrapper.emitted('command')).toBeUndefined();
    expect(input.element.value).toBe('/clear later');
    expect(document.body.textContent).toContain('/clear takes no arguments');
    wrapper.unmount();
  });

  it('submits a selected quote with its source and comment', async () => {
    const wrapper = mount(Composer, {
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

    wrapper.vm.insertQuote({ quote: 'selected text', comment: 'check this', source: 'src/example.ts' });
    await nextTick();

    expect(wrapper.get('.quote-chip').text()).toContain('selected text');
    await wrapper.get('.send').trigger('click');

    expect(wrapper.emitted('submit')?.at(-1)).toEqual([{
      text: 'From src/example.ts:\n> selected text\ncheck this',
      attachments: [],
    }]);
    expect(wrapper.find('.quote-chip').exists()).toBe(false);
  });

});
