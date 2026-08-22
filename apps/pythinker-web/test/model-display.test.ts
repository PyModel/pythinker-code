// apps/pythinker-web/test/model-display.test.ts
//
// Subagent model/effort label parity with the reference client: TasksPane,
// SubagentGrid, and AgentDetailPanel resolve raw task/member model ids through
// the provided `modelDisplay` resolver (friendly displayName → model name →
// provider-prefix-stripped id) and `subagentEffort` (capitalized effort,
// hiding the degenerate on/off levels).
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';

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
import AgentDetailPanel from '../src/components/chat/AgentDetailPanel.vue';
import SubagentGrid from '../src/components/chat/SubagentGrid.vue';
import TasksPane from '../src/components/chat/TasksPane.vue';
import type { TaskItem } from '../src/types';

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
