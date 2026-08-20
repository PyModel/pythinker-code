import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import DynamicWorkflowPanel from '../src/components/DynamicWorkflowPanel.vue';
import type { TaskItem } from '../src/types';

const panelSource = readFileSync(
  resolve(import.meta.dirname, '../src/components/DynamicWorkflowPanel.vue'),
  'utf8',
);
const dockSource = readFileSync(
  resolve(import.meta.dirname, '../src/components/chat/ChatDock.vue'),
  'utf8',
);

const tasks: TaskItem[] = [
  {
    id: 'worker_3',
    name: 'Inspect test coverage',
    kind: 'subagent',
    state: 'run',
    phase: 'working',
    subagentType: 'explore',
    dynamicWorkflowIndex: 3,
    timing: 'Running · 2:15',
    output: ['Read 4 files', 'Inspecting the test files'],
  },
  {
    id: 'worker_1',
    name: 'Review the API',
    kind: 'subagent',
    state: 'done',
    phase: 'completed',
    subagentType: 'review',
    dynamicWorkflowIndex: 1,
    timing: 'Done · 14s',
    output: ['Review complete'],
  },
];

function mountPanel() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        tasks: {
          dockSubagent: 'Dynamic Workflow',
          workflowRecent: 'Recent',
          workflowRunning: 'Running',
          workflowDone: 'Done',
          workflowAll: 'All',
          workflowFilterLabel: 'Workflow activity filter',
          workflowOpenWorker: 'Open activity for {name}',
          workflowPhaseWorking: 'working',
          workflowPhaseCompleted: 'done',
          emptyTasks: 'No workflow activity',
          running: 'running',
          stop: 'stop',
        },
      },
    },
  });
  return mount(DynamicWorkflowPanel, {
    props: { tasks },
    global: { plugins: [i18n] },
  });
}

describe('DynamicWorkflowPanel', () => {
  it('uses an opaque surface over the conversation', () => {
    const panelRule = panelSource.match(/(?:^|\n)\.dw-panel\s*\{([^}]*)\}/u)?.[1] ?? '';
    const dockPanelRule = dockSource.match(/(?:^|\n)\.dock-work-panel\s*\{([^}]*)\}/u)?.[1] ?? '';
    expect(panelRule).toMatch(/background:\s*var\(--bg\);/u);
    expect(dockPanelRule).toMatch(/background:\s*var\(--color-menu-bg-frost\);/u);
    expect(dockSource).toContain('<SubagentGrid');
    expect(dockSource).not.toContain('transition: opacity 0.16s ease');
  });

  it('shows live activity, filters workers, and opens the selected worker', async () => {
    const wrapper = mountPanel();

    expect(wrapper.get('.dw-panel-title').text()).toBe('Dynamic Workflow');
    expect(wrapper.get('.dw-panel-count').text()).toBe('1 running');
    expect(wrapper.findAll('.dw-card')).toHaveLength(2);
    expect(wrapper.text()).toContain('03');
    expect(wrapper.text()).toContain('Inspecting the test files');
    expect(wrapper.text()).toContain('Running · 2:15');

    await wrapper.get('[data-filter="running"]').trigger('click');
    expect(wrapper.findAll('.dw-card')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('Review the API');

    await wrapper.get('.dw-card-open').trigger('click');
    expect(wrapper.emitted('open')).toEqual([['worker_3']]);

    await wrapper.get('.dw-card-cancel').trigger('click');
    expect(wrapper.emitted('cancel')).toEqual([['worker_3']]);

    await wrapper.get('[data-filter="done"]').trigger('click');
    expect(wrapper.findAll('.dw-card')).toHaveLength(1);
    expect(wrapper.text()).toContain('Review complete');
  });
});
