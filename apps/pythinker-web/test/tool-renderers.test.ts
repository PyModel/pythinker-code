import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';

import BashTool from '../src/components/chat/tool-calls/BashTool.vue';
import GenericTool from '../src/components/chat/tool-calls/GenericTool.vue';
import GlobTool from '../src/components/chat/tool-calls/GlobTool.vue';
import GoalTool from '../src/components/chat/tool-calls/GoalTool.vue';
import GrepTool from '../src/components/chat/tool-calls/GrepTool.vue';
import PlanPanel from '../src/components/chat/PlanPanel.vue';
import PlanTool from '../src/components/chat/tool-calls/PlanTool.vue';
import ReadTool from '../src/components/chat/tool-calls/ReadTool.vue';
import TodoTool from '../src/components/chat/tool-calls/TodoTool.vue';
import WaitForTool from '../src/components/chat/tool-calls/WaitForTool.vue';
import WebFetchTool from '../src/components/chat/tool-calls/WebFetchTool.vue';
import { resolveToolRenderer } from '../src/components/chat/tool-calls/toolRegistry';
import { messages } from '../src/i18n/locales';
import type { ToolCall } from '../src/types';

vi.mock('../src/components/chat/Markdown.vue', () => ({ default: { template: '<div />' } }));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

function tool(name: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: `tool-${name}`, name, arg: '{}', status: 'ok', ...overrides };
}

function mountTool(component: typeof BashTool, value: ToolCall) {
  return mount(component, { props: { tool: value }, global: { plugins: [i18n] } });
}

describe('tool renderer routing', () => {
  it('routes canonical and aliased names to specialized renderers', () => {
    const cases = [
      ['bash', BashTool], ['shell', BashTool],
      ['read', ReadTool], ['Read', ReadTool],
      ['grep', GrepTool], ['search', GrepTool], ['rg', GrepTool],
      ['glob', GlobTool], ['ls', GlobTool], ['find', GlobTool],
      ['web_fetch', WebFetchTool], ['WebFetch', WebFetchTool],
      ['todo', TodoTool], ['TodoWrite', TodoTool],
      ['exitplanmode', PlanTool], ['ExitPlanMode', PlanTool],
      ['creategoal', GoalTool], ['getgoal', GoalTool],
      ['setgoalbudget', GoalTool], ['updategoal', GoalTool], ['create_goal', GoalTool],
      ['waitfor', WaitForTool], ['WaitFor', WaitForTool],
    ] as const;

    for (const [name, renderer] of cases) expect(resolveToolRenderer(tool(name))).toBe(renderer);
    expect(resolveToolRenderer(tool('unknown-tool'))).toBe(GenericTool);
  });
});

describe('specialized tool renderers', () => {
  it('renders Bash waiting and settled output states', () => {
    const running = mountTool(BashTool, tool('bash', {
      status: 'running',
      arg: JSON.stringify({ command: 'pnpm test' }),
      defaultExpanded: true,
    }));
    expect(running.text()).toContain('Waiting for output…');

    const settled = mountTool(BashTool, tool('bash', {
      arg: JSON.stringify({ command: 'pnpm test' }),
      output: ['first line', 'second line'],
      defaultExpanded: true,
    }));
    expect(settled.text()).toContain('first line');
    expect(settled.text()).toContain('second line');
  });

  it('renders Todo rows and the item-count chip', () => {
    const wrapper = mountTool(TodoTool, tool('todo', {
      arg: JSON.stringify({ todos: [
        { content: 'Done task', status: 'completed' },
        { content: 'Active task', status: 'in_progress' },
        { content: 'Queued task', status: 'pending' },
      ] }),
      defaultExpanded: true,
    }));

    expect(wrapper.findAll('.todo-row')).toHaveLength(3);
    // Done/total chip (reference TodoTool) + thin progress bar fill.
    expect(wrapper.get('.chip').text()).toBe('1 / 3');
    expect(wrapper.get('.todo-fill').attributes('style')).toContain('width: 33.33333333333333%');
    expect(wrapper.findAll('.todo-row[data-status="done"]')).toHaveLength(1);
  });

  it('renders the Grep result-count chip', () => {
    const wrapper = mountTool(GrepTool, tool('grep', {
      arg: JSON.stringify({ pattern: 'needle', path: 'src' }),
      output: ['src/a.ts:1:needle', 'src/b.ts:2:needle'],
    }));

    expect(wrapper.get('.chip').text()).toBe('2 results');
    expect(wrapper.text()).toContain('needle in src');
  });

  it('reveals the saved Plan through its agent and tool-call ids', async () => {
    const revealSavedPlan = vi.fn().mockResolvedValue(true);
    const wrapper = mount(PlanTool, {
      props: {
        tool: tool('ExitPlanMode', { planPath: '/repo/plan.md', defaultExpanded: true }),
      },
      global: {
        plugins: [i18n],
        provide: {
          resolvePlan: () => ({
            agentId: 'main',
            toolCallId: 'tool-ExitPlanMode',
            turnId: 't1',
            source: 'interaction',
            path: '/repo/plan.md',
          }),
          revealSavedPlan,
        },
      },
    });

    expect(wrapper.text()).toContain('/repo/plan.md');
    await wrapper.get('.plan-path .ui-button').trigger('click');
    expect(revealSavedPlan).toHaveBeenCalledWith('main', 'tool-ExitPlanMode');
    expect(wrapper.emitted('openFile')).toBeUndefined();
  });

  it('reveals a path-only Plan panel through its agent and tool-call ids', async () => {
    const revealSavedPlan = vi.fn().mockResolvedValue(true);
    const wrapper = mount(PlanPanel, {
      props: {
        plan: {
          agentId: 'main',
          toolCallId: 'call_plan_panel',
          turnId: 't1',
          source: 'output',
          path: '/repo/plan.md',
        },
        revealSavedPlan,
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.get('.plan-path').text()).toBe('/repo/plan.md');
    await wrapper.get('.plan-path-only .ui-button').trigger('click');
    expect(revealSavedPlan).toHaveBeenCalledWith('main', 'call_plan_panel');
  });
});
