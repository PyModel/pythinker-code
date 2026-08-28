import { mount } from '@vue/test-utils';
import { createI18n, type I18n } from 'vue-i18n';
import { defineComponent } from 'vue';
import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentDetailPanel from '../src/components/chat/AgentDetailPanel.vue';
import type { AgentMember, ChatTurn } from '../src/types';

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
      thinking: { close: 'Close' },
      tasks: {
        copy: 'Copy',
        copyCommand: 'Copy command',
        copyOutput: 'Copy output',
        copyAll: 'Copy all',
        transcriptLoadError: 'Failed to load this sub agent’s conversation.',
      },
      tools: {
        dynamic_workflow: {
          phaseWorking: 'Working',
          phaseCompleted: 'Completed',
        },
      },
    },
  },
});

const member: AgentMember = {
  id: 'agent_1',
  name: 'Review modified files',
  subagentType: 'review',
  model: 'secondary/model',
  thinkingEffort: 'high',
  phase: 'working',
  status: 'running',
  prompt: 'Review the current changes',
};

const turns: ChatTurn[] = [
  {
    id: 'turn_1_input',
    role: 'user',
    no: 1,
    text: 'Review the current changes',
  },
  {
    id: 'turn_1_output',
    role: 'assistant',
    no: 2,
    text: 'I inspected the implementation.',
    tools: [
      {
        id: 'tool_1',
        name: 'Read',
        arg: '{"path":"src/App.vue"}',
        status: 'ok',
        output: ['Read complete'],
      },
    ],
  },
];

type ModelResolvers = {
  modelDisplay?: (modelId: string | undefined) => string | undefined;
  subagentEffort?: (effort: string | undefined) => string | undefined;
};

function mountPanel(options: { member?: AgentMember; turns?: ChatTurn[]; loadError?: boolean; provide?: ModelResolvers } = {}) {
  return mount(AgentDetailPanel, {
    props: {
      member: options.member ?? member,
      turns: options.turns ?? turns,
      running: true,
      loading: false,
      loadError: options.loadError ?? false,
      hasMore: false,
      loadingMore: false,
      loadMoreError: false,
    },
    global: { plugins: [i18n as I18n], provide: options.provide ?? {} },
  });
}

describe('AgentDetailPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
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

  it('renders the selected subagent transcript and execution tools', () => {
    const wrapper = mountPanel({
      provide: {
        modelDisplay: (modelId) => (modelId === 'secondary/model' ? 'Secondary Model' : modelId),
        subagentEffort: (effort) => (effort === 'high' ? 'High' : effort),
      },
    });

    expect(wrapper.text()).toContain('Review modified files');
    // The subtitle resolves through the provided model/effort resolvers.
    expect(wrapper.text()).toContain('review · Secondary Model · High');
    expect(wrapper.text()).toContain('Review the current changes');
    expect(wrapper.text()).toContain('I inspected the implementation.');
    expect(wrapper.text()).toContain('Read');
  });

  it('shows task output as a fallback when the transcript request fails', () => {
    const wrapper = mountPanel({ turns: [], loadError: true });

    expect(wrapper.text()).toContain('Failed to load this sub agent’s conversation.');
    expect(wrapper.text()).toContain('Review the current changes');
  });

  it('shrinks a long header title before the Close control', () => {
    const path = [
      'src/components/ui/PanelHeader.vue',
      'apps/pythinker-web/src/components/ui/PanelHeader.vue',
    ].find(existsSync);
    if (path === undefined) throw new Error('PanelHeader.vue was not found');
    const source = readFileSync(path, 'utf8');
    const titleRule = /\.ui-panel-header__title\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const closeRule = /\.ui-panel-header__close\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';

    expect(titleRule).toMatch(/flex:\s*0 1 auto/);
    expect(titleRule).toMatch(/min-width:\s*0/);
    expect(titleRule).toMatch(/overflow:\s*hidden/);
    expect(titleRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(titleRule).toMatch(/white-space:\s*nowrap/);
    expect(closeRule).toMatch(/flex:\s*none/);
  });

  it('keeps the Close control out of the wrapping content row', () => {
    const path = [
      'src/components/ui/PanelHeader.vue',
      'apps/pythinker-web/src/components/ui/PanelHeader.vue',
    ].find(existsSync);
    if (path === undefined) throw new Error('PanelHeader.vue was not found');
    const source = readFileSync(path, 'utf8');
    const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? '';
    const mainStart = template.indexOf('class="ui-panel-header__main"');
    expect(mainStart).toBeGreaterThan(-1);
    const mainEnd = template.indexOf('</div>', mainStart);
    const closeStart = template.indexOf('ui-panel-header__close');
    expect(mainEnd).toBeGreaterThan(-1);
    expect(closeStart).toBeGreaterThan(mainEnd);

    const wrapRule = /\.ui-panel-header\.wrap\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const wrapMainRule = /\.ui-panel-header\.wrap \.ui-panel-header__main\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    expect(wrapRule).not.toMatch(/flex-wrap/);
    expect(wrapRule).toMatch(/align-items:\s*flex-start/);
    expect(wrapMainRule).toMatch(/flex-wrap:\s*wrap/);
  });

  it('lets the ToolRow trailing chip truncate instead of covering the title', () => {
    const path = [
      'src/components/chat/ToolRow.vue',
      'apps/pythinker-web/src/components/chat/ToolRow.vue',
    ].find(existsSync);
    if (path === undefined) throw new Error('ToolRow.vue was not found');
    const source = readFileSync(path, 'utf8');
    const textRule = /\.bh-text\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const rtRule = /\n\.rt\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const chipRule = /:slotted\(\.chip\)\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';

    expect(textRule).toMatch(/overflow:\s*hidden/);
    expect(rtRule).toMatch(/min-width:\s*0/);
    expect(rtRule).not.toMatch(/flex:\s*none/);
    expect(chipRule).toMatch(/min-width:\s*0/);
    expect(chipRule).toMatch(/text-overflow:\s*ellipsis/);
    expect(chipRule).not.toMatch(/flex:\s*none/);
  });
});
