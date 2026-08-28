// apps/pythinker-web/test/model-display.test.ts
//
// Subagent model/effort labels: TasksPane,
// SubagentGrid, and AgentDetailPanel resolve raw task/member model ids through
// the provided `modelDisplay` resolver (friendly displayName → model name →
// provider-prefix-stripped id) and `subagentEffort` (capitalized effort,
// hiding the degenerate on/off levels).
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import AgentDetailPanel from '../src/components/chat/AgentDetailPanel.vue';
import AgentTool from '../src/components/chat/tool-calls/AgentTool.vue';
import DynamicWorkflowTool from '../src/components/chat/tool-calls/DynamicWorkflowTool.vue';
import SubagentGrid from '../src/components/chat/SubagentGrid.vue';
import TasksPane from '../src/components/chat/TasksPane.vue';
import type { DynamicWorkflowMember } from '../src/composables/dynamicWorkflowGroups';
import type { ChatTurn } from '../src/types';
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

const { copyTextToClipboard } = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(async () => true),
}));
vi.mock('../src/lib/clipboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  copyTextToClipboard,
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    en: {
      tasks: {
        running: 'running',
        stateDone: 'done',
        stateFail: 'failed',
        stateCancelled: 'cancelled',
        stop: 'stop',
        copy: 'Copy',
        expand: 'Expand',
        collapse: 'Collapse',
      },
    },
  },
});

const resolvers = {
  modelDisplay: (modelId: string | undefined): string | undefined => {
    if (modelId === undefined || modelId.length === 0) return undefined;
    const catalog: Record<string, string> = {
      'example.test/example-model': 'Example Model',
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
    model: 'example.test/example-model',
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
          model: 'example.test/example-model', thinkingEffort: 'high',
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

  it('AgentTool shows resolved model and effort in its inline metadata', () => {
    const wrapper = mount(AgentTool, {
      props: {
        tool: {
          id: 'tool_1',
          name: 'Agent',
          arg: JSON.stringify({ description: 'Inspect UI', run_in_background: false }),
          status: 'running',
        },
      },
      global: {
        plugins: [i18n],
        provide: {
          resolveAgentModel: () => ({ display: 'Example Model', effort: 'High' }),
          resolveAgentTaskId: () => 'task_1',
        },
      },
    });

    expect(wrapper.get('.chip').text()).toContain('Example Model · High');
  });

  it('DynamicWorkflowTool shows only shared model and effort metadata', async () => {
    const members = ref<DynamicWorkflowMember[]>([
      {
        id: 'agent_1',
        name: 'First',
        phase: 'working' as const,
        dynamicWorkflowIndex: 0,
        model: 'example.test/example-model',
        thinkingEffort: 'high',
      },
      {
        id: 'agent_2',
        name: 'Second',
        phase: 'working' as const,
        dynamicWorkflowIndex: 1,
        model: 'example.test/example-model',
        thinkingEffort: 'high',
      },
    ]);
    const wrapper = mount(DynamicWorkflowTool, {
      props: {
        tool: {
          id: 'workflow_1',
          name: 'AgentDynamicWorkflow',
          arg: JSON.stringify({ description: 'Inspect both surfaces', items: [{}, {}] }),
          status: 'running',
        },
      },
      global: {
        plugins: [i18n],
        provide: {
          resolveDynamicWorkflowMembers: () => members.value,
          modelDisplay: resolvers.modelDisplay,
          subagentEffort: resolvers.subagentEffort,
        },
        stubs: { Tooltip: true },
      },
    });

    expect(wrapper.get('.routing-sub').text()).toContain('Example Model · High');
    expect(wrapper.get('.routing-sub').attributes('data-state')).toBe('override');
    expect(wrapper.findAll('.mmeta').map((node) => node.text())).toEqual(['Example Model · High', 'Example Model · High']);

    members.value[1].thinkingEffort = 'medium';
    await nextTick();
    expect(wrapper.get('.routing-sub').attributes('data-state')).toBe('mixed');
    expect(wrapper.findAll('.routing-bd')).toHaveLength(2);

    members.value[1] = {
      id: 'agent_2',
      name: 'Second',
      phase: 'working',
      dynamicWorkflowIndex: 1,
    };
    await nextTick();
    expect(wrapper.get('.routing-sub').attributes('data-state')).toBe('override');
    expect(wrapper.findAll('.mmeta').map((node) => node.text())).toEqual(['Example Model · High']);
  });
});

describe('agent detail transcript copy', () => {
  const member = {
    id: 'm1',
    name: 'Review modified files',
    subagentType: 'review',
    model: 'example.test/example-model',
    thinkingEffort: 'high',
    phase: 'working' as const,
    status: 'running' as const,
    prompt: 'Review the current changes',
  };

  function mountPanel(turns: ChatTurn[] = []) {
    return mount(AgentDetailPanel, {
      props: {
        member,
        turns,
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

  it('offers one copy action, with no bespoke dropdown', () => {
    const wrapper = mountPanel();

    expect(wrapper.find('button[aria-haspopup="menu"]').exists()).toBe(false);
    expect(document.body.querySelector('.copy-menu')).toBeNull();
    const copy = wrapper.findAll('button').filter((b) => b.attributes('aria-label') === 'Copy');
    expect(copy).toHaveLength(1);
    wrapper.unmount();
  });

  it('routes the copy action through the turn list when there is a transcript', async () => {
    copyTextToClipboard.mockClear();
    const turns: ChatTurn[] = [
      { id: 't1', role: 'user', no: 1, text: 'hello' },
      { id: 't2', role: 'assistant', no: 2, text: 'world' },
    ];
    const wrapper = mountPanel(turns);

    await wrapper.findAll('button')
      .find((b) => b.attributes('aria-label') === 'Copy')!
      .trigger('click');
    await flushPromises();

    // The conversation-level path labels each turn; the raw prompt/output
    // fallback never does.
    const copied = copyTextToClipboard.mock.calls.at(-1)?.[0] as string;
    expect(copied).toContain('**User**');
    expect(copied).toContain('**Assistant**');
    wrapper.unmount();
  });
});
