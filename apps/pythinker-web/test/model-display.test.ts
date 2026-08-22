// apps/pythinker-web/test/model-display.test.ts
//
// Subagent model/effort label parity with the reference client: TasksPane,
// SubagentGrid, and AgentDetailPanel resolve raw task/member model ids through
// the provided `modelDisplay` resolver (friendly displayName → model name →
// provider-prefix-stripped id) and `subagentEffort` (capitalized effort,
// hiding the degenerate on/off levels).
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import AgentDetailPanel from '../src/components/chat/AgentDetailPanel.vue';
import SubagentGrid from '../src/components/chat/SubagentGrid.vue';
import TasksPane from '../src/components/chat/TasksPane.vue';
import type { TaskItem } from '../src/types';

vi.mock('markstream-vue', () => {
  const noop = (): void => undefined;
  return {
    MarkdownRender: defineComponent({
      name: 'MarkdownRenderStub',
      props: ['content'],
      setup(props) {
        return () => String(props.content ?? '');
      },
    }),
    enableKatex: noop,
    enableMermaid: noop,
    setKaTeXWorker: noop,
    clearKaTeXWorker: noop,
    setMermaidWorker: noop,
    clearMermaidWorker: noop,
  };
});
vi.mock('markstream-vue/workers/katexRenderer.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));
vi.mock('markstream-vue/workers/mermaidParser.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      tasks: {
        running: 'running',
        stateDone: 'done',
        stateFail: 'failed',
        stateCancelled: 'cancelled',
        stop: 'stop',
      },
    },
  },
});

const resolvers = {
  modelDisplay: (modelId: string | undefined): string | undefined => {
    if (modelId === undefined || modelId.length === 0) return undefined;
    const catalog: Record<string, string> = {
      'pymodel/example-model': 'Example Model',
    };
    return (
      catalog[modelId] ??
      (modelId.includes('/') ? modelId.split('/').pop()! : modelId)
    );
  },
  subagentEffort: (effort: string | undefined): string | undefined =>
    effort !== undefined && effort.length > 0 && effort !== 'off' && effort !== 'on'
      ? effort.charAt(0).toUpperCase() + effort.slice(1)
      : undefined,
};

function mountWithResolvers(component: typeof SubagentGrid | typeof TasksPane, tasks: TaskItem[]) {
  return mount(component, {
    props: { filter: 'all', tasks },
    global: {
      plugins: [i18n],
      provide: { ...resolvers },
    },
  });
}

describe('subagent model/effort display resolvers', () => {
  const subagentTask: TaskItem = {
    id: 'task_1',
    agentId: 'agent_1',
    name: 'Inspect the implementation',
    kind: 'subagent',
    state: 'run',
    timing: 'Running · 0:01',
    model: 'pymodel/example-model',
    thinkingEffort: 'high',
  };

  it('SubagentGrid shows the friendly model name and capitalized effort', () => {
    const wrapper = mountWithResolvers(SubagentGrid, [subagentTask]);
    const label = wrapper.get('.sg-model').text();
    expect(label).toContain('Example Model');
    expect(label).toContain('High');
    expect(label).not.toContain('pymodel/');
  });

  it('TasksPane shows the friendly model and hides degenerate effort levels', () => {
    const wrapper = mountWithResolvers(TasksPane, [
      subagentTask,
      { ...subagentTask, id: 'task_2', thinkingEffort: 'off' },
    ]);
    const models = wrapper.findAll('.tp-model').map((node) => node.text());
    expect(models.some((text) => text.includes('Example Model'))).toBe(true);
    expect(models.some((text) => text === 'High')).toBe(true);
    expect(models.filter((text) => text === 'Off')).toHaveLength(0);
  });

  it('falls back to provider-stripped ids when the model is unknown', () => {
    const wrapper = mountWithResolvers(SubagentGrid, [
      { ...subagentTask, model: 'unknown-provider/mystery-model' },
    ]);
    expect(wrapper.get('.sg-model').text()).toContain('mystery-model');
  });

  it('AgentDetailPanel resolves its subtitle through the same resolvers', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const host = defineComponent({
      components: { AgentDetailPanel },
      setup() {
        return {};
      },
      template: `<AgentDetailPanel
        :member="{
          id: 'm1', name: 'Review modified files', subagentType: 'review',
          model: 'pymodel/example-model', thinkingEffort: 'high',
          phase: 'working', status: 'running', prompt: 'x'
        }"
        :turns="[]" :running="true" :loading="false" :load-error="false"
        :has-more="false" :loading-more="false" :load-more-error="false"
      />`,
    });
    // Provide at the mount root so inject() inside the panel finds them.
    const wrapper = mount(host, {
      global: {
        plugins: [i18n],
        provide: {
          modelDisplay: resolvers.modelDisplay,
          subagentEffort: resolvers.subagentEffort,
        },
        stubs: {
          ChatPane: defineComponent({ template: '<div />' }),
          markstream: true,
        },
      },
    });
    expect(wrapper.text()).toContain('review · Example Model · High');
    vi.unstubAllGlobals();
  });
});

describe('copy menu keyboard and focus behavior', () => {
  const member = {
    id: 'm1',
    name: 'Review modified files',
    subagentType: 'review',
    model: 'pymodel/example-model',
    thinkingEffort: 'high',
    phase: 'working' as const,
    status: 'running' as const,
    prompt: 'Review the current changes',
  };

  function mountPanelWithMenu() {
    return mount(AgentDetailPanel, {
      props: {
        member,
        turns: [],
        running: true,
        loading: false,
        loadError: false,
        hasMore: false,
        loadingMore: false,
        loadMoreError: false,
      },
      global: {
        plugins: [i18n],
        provide: { modelDisplay: resolvers.modelDisplay, subagentEffort: resolvers.subagentEffort },
        attachTo: document.body,
      },
    });
  }

  function copyTrigger(wrapper: ReturnType<typeof mountPanelWithMenu>) {
    return wrapper.find('button[aria-haspopup="menu"]');
  }

  it('teleports the open menu to body and focuses its first item', async () => {
    const wrapper = mountPanelWithMenu();
    await copyTrigger(wrapper).trigger('click');
    await nextTick();
    // Menu lives under document.body (teleported), not inside the panel root.
    const teleported = document.body.querySelector(':scope > .agent-panel .copy-menu');
    expect(teleported).toBeNull();
    const menu = document.body.querySelector('.copy-menu');
    expect(menu).not.toBeNull();
    expect(document.activeElement?.classList.contains('ui-menu-item')).toBe(true);
    wrapper.unmount();
  });

  it('opens on ArrowDown from the trigger with focus landing on a menu item', async () => {
    const wrapper = mountPanelWithMenu();
    await copyTrigger(wrapper).trigger('keydown.down');
    await nextTick();
    expect(copyTrigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(document.activeElement?.classList.contains('ui-menu-item')).toBe(true);
    wrapper.unmount();
  });

  it('cycles focus with ArrowDown/ArrowUp inside the menu without leaving it', async () => {
    const wrapper = mountPanelWithMenu();
    await copyTrigger(wrapper).trigger('click');
    await nextTick();
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.copy-menu .ui-menu-item'));
    expect(items.length).toBeGreaterThanOrEqual(3);
    // First item is focused after open; ArrowUp wraps to the last item.
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    expect(document.activeElement).toBe(items.at(-1));
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(items[0]);
    wrapper.unmount();
  });

  it('closes when focusout leaves both trigger and menu', async () => {
    const wrapper = mountPanelWithMenu();
    await copyTrigger(wrapper).trigger('click');
    await nextTick();
    expect(document.body.querySelector('.copy-menu')).not.toBeNull();
    // Simulate focus moving to an unrelated element outside the pair.
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    const menuEl = document.body.querySelector('.copy-menu')!;
    menuEl.dispatchEvent(new FocusEvent('focusout', { relatedTarget: outside, bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('.copy-menu')).toBeNull();
    outside.remove();
    wrapper.unmount();
  });

  it('does not leak menu listeners when the member switches mid-open', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const wrapper = mountPanelWithMenu();
    const trigger = copyTrigger(wrapper);
    // Kick off the open; its continuation resumes after the nextTick await.
    const opening = trigger.trigger('click');
    // The member switch closes the menu inside that window.
    void wrapper.setProps({ member: { ...member, id: 'm2' } });
    await opening;
    await nextTick();
    expect(document.body.querySelector('.copy-menu')).toBeNull();
    const added = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    const removed = removeSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(removed.length).toBeGreaterThanOrEqual(added.length);
    addSpy.mockRestore();
    removeSpy.mockRestore();
    wrapper.unmount();
  });
});
