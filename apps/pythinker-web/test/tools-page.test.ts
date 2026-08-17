import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import type { AppTool } from '../src/api/types';
import ToolsPage from '../src/components/settings/pages/ToolsPage.vue';
import { messages } from '../src/i18n/locales';

const tools: AppTool[] = [
  { name: 'Read', description: 'Read files', inputSchema: {}, source: 'builtin' },
  { name: 'Write', description: 'Write files', inputSchema: {}, source: 'builtin' },
  { name: 'Glob', description: 'Find files', inputSchema: {}, source: 'builtin' },
];

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages,
  missingWarn: false,
  fallbackWarn: false,
});

function mountPage(props: Record<string, unknown> = {}) {
  return mount(ToolsPage, {
    props: {
      sessionId: 'session_1',
      tools,
      toolsLoading: false,
      ...props,
    },
    global: { plugins: [i18n] },
  });
}

describe('ToolsPage', () => {
  it('keeps every tool enabled by default without emitting on mount', () => {
    const wrapper = mountPage();

    expect(wrapper.findAll('.listing-row')).toHaveLength(tools.length);
    expect(wrapper.findAll('button.switch').map((button) => button.attributes('aria-checked')))
      .toEqual(['true', 'true', 'true']);
    expect(wrapper.emitted('setTools')).toBeUndefined();
  });

  it('emits the full remaining selection once when a tool is turned off', async () => {
    const wrapper = mountPage({ enabledTools: ['Read', 'Write', 'Glob'] });

    await wrapper.findAll('button.switch')[0]!.trigger('click');

    expect(wrapper.emitted('setTools')).toEqual([[['Write', 'Glob']]]);
  });

  it('enable all emits every tool name', async () => {
    const wrapper = mountPage({ enabledTools: ['Read'] });

    await wrapper.get('.actions .act').trigger('click');

    expect(wrapper.emitted('setTools')).toEqual([[tools.map((tool) => tool.name)]]);
  });
});
