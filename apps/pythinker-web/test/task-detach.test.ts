import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentTool from '../src/components/chat/tool-calls/AgentTool.vue';
import BashTool from '../src/components/chat/tool-calls/BashTool.vue';
import ConversationPane from '../src/components/chat/ConversationPane.vue';
import { DaemonPythinkerWebApi } from '../src/api/daemon/client';
import { messages } from '../src/i18n/locales';
import type { TaskItem, ToolCall } from '../src/types';

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
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

function tool(name: string, over: Partial<ToolCall> = {}): ToolCall {
  return { id: `tool-${name}`, name, arg: '{}', status: 'running', ...over };
}

function mountTool(
  component: typeof BashTool | typeof AgentTool,
  value: ToolCall,
  detachable: boolean | undefined,
) {
  return mount(component, {
    props: { tool: value },
    global: {
      plugins: [i18n],
      provide: detachable === null ? {} : { resolveDetachableTask: () => detachable },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('move a running tool call to the background', () => {
  it('offers the Bash row a To background button while it runs', async () => {
    const wrapper = mountTool(BashTool, tool('bash'), undefined);
    const button = wrapper.get('button.tl-detach');
    expect(button.attributes('aria-label')).toBe('To background');

    await button.trigger('click');
    expect(wrapper.emitted('detach')).toEqual([['tool-bash']]);
  });

  it('hides the Bash button when the task is already in the background', () => {
    const wrapper = mountTool(BashTool, tool('bash'), false);
    expect(wrapper.find('button.tl-detach').exists()).toBe(false);
  });

  it('hides the Bash button once the command has finished', () => {
    const wrapper = mountTool(BashTool, tool('bash', { status: 'ok' }), undefined);
    expect(wrapper.find('button.tl-detach').exists()).toBe(false);
  });

  it('offers the Agent card the same button and names its status', async () => {
    const wrapper = mountTool(
      AgentTool,
      tool('agent', { arg: JSON.stringify({ description: 'work', prompt: 'go' }) }),
      undefined,
    );
    const button = wrapper.get('.detach');
    expect(button.attributes('aria-label')).toBe('To background');
    expect(wrapper.get('.status').attributes('aria-label')).toBe('Running');

    await button.trigger('click');
    expect(wrapper.emitted('detach')).toEqual([['tool-agent']]);
  });

  it('never offers to background an Agent that already runs in the background', () => {
    const wrapper = mountTool(
      AgentTool,
      tool('agent', { arg: JSON.stringify({ prompt: 'go', run_in_background: true }) }),
      undefined,
    );
    expect(wrapper.find('.detach').exists()).toBe(false);
  });
});

describe('detachable-task predicate', () => {
  function probe(tasks: TaskItem[]): boolean | undefined {
    const wrapper = mount(ConversationPane, {
      props: {
        turns: [],
        tasks,
        status: { model: 'm', modelId: 'm', ctxUsed: 0, ctxMax: 100, permission: 'manual' },
      },
      global: { plugins: [i18n], stubs: { ChatPane: true, teleport: true } },
    });
    // The predicate reaches the tool rows through provide/inject; read it off
    // the pane's own provides so the probe does not depend on ChatPane's
    // rendering conditions.
    const provides = wrapper.vm.$ .provides as Record<string, unknown>;
    const resolve = provides['resolveDetachableTask'] as
      | ((id: string) => boolean | undefined)
      | undefined;
    expect(resolve).toBeTypeOf('function');
    const result = resolve?.('parent-tool');
    wrapper.unmount();
    return result;
  }

  function task(over: Partial<TaskItem>): TaskItem {
    return { id: 't1', name: 'x', kind: 'bash', state: 'run', timing: '', ...over };
  }

  it('reports unknown when no task belongs to the tool call', () => {
    expect(probe([])).toBeUndefined();
  });

  it('reports detachable for a running foreground task', () => {
    expect(probe([task({ parentToolCallId: 'parent-tool' })])).toBe(true);
  });

  it('matches a task keyed by the tool call id itself, not only by parent', () => {
    expect(probe([task({ id: 'parent-tool' })])).toBe(true);
    expect(probe([task({ id: 'parent-tool', runInBackground: true })])).toBe(false);
  });

  it('reports not detachable once the task runs in the background', () => {
    expect(probe([task({ parentToolCallId: 'parent-tool', runInBackground: true })])).toBe(false);
  });

  it('reports not detachable once the task has finished', () => {
    expect(probe([task({ parentToolCallId: 'parent-tool', state: 'done' })])).toBe(false);
  });
});

describe('detachTask API client', () => {
  it('posts the detach action for the session task', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 0, msg: 'ok', data: { detached: true, status: 'running' }, request_id: 'r' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const api = new DaemonPythinkerWebApi({
      serverHttpUrl: 'http://example.test:58627',
      clientId: 'web_test',
      clientName: 'pythinker-code-web',
      clientVersion: '0.1.1',
      clientUiMode: 'web',
    });
    const result = await api.detachTask('sess 1', 'task/1');

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/sessions/sess%201/tasks/task%2F1:detach');
    expect(init.method).toBe('POST');
    expect(result).toEqual({ detached: true, status: 'running' });
  });
});

describe('detach plumbing', () => {
  const read = (path: string): string =>
    readFileSync(join(import.meta.dirname, path), 'utf8');

  it('carries the tool row detach event up to the client', () => {
    expect(read('../src/components/chat/ChatPane.vue'))
      .toContain("@detach=\"emit('detachTask', $event)\"");
    expect(read('../src/components/chat/ConversationPane.vue'))
      .toContain("@detach-task=\"emit('detachTask', $event)\"");
    expect(read('../src/App.vue'))
      .toContain("@detach-task=\"client.detachTask($event)\"");
    expect(read('../src/composables/usePythinkerWebClient.ts'))
      .toContain('detachTask: workspaceState.detachTask,');
  });
});
