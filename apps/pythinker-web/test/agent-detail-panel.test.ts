import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import AgentDetailPanel from '../src/components/chat/AgentDetailPanel.vue';
import type { AgentMember } from '../src/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { preview: 'Preview' }, thinking: { close: 'Close' } } },
});

function member(outputLines: string[]): AgentMember {
  return {
    id: 'agent_1',
    name: 'Review modified files',
    subagentType: 'review',
    phase: 'working',
    status: 'running',
    prompt: 'Review the current changes',
    outputLines,
  };
}

describe('AgentDetailPanel', () => {
  it('groups streamed agent output by tool call and folds long output', async () => {
    const wrapper = mount(AgentDetailPanel, {
      props: {
        member: member([
          'Calling Bash: pnpm test',
          ...Array.from({ length: 10 }, (_, index) => `test line ${index + 1}`),
          'Calling Read: src/App.vue',
          'Read complete',
        ]),
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.findAll('.ap-group')).toHaveLength(2);
    expect(wrapper.findAll('.ap-call').map((call) => call.text())).toEqual([
      '▶ Calling Bash: pnpm test',
      '▶ Calling Read: src/App.vue',
    ]);
    expect(wrapper.text()).toContain('… (3 more)');
    expect(wrapper.text()).not.toContain('test line 6');

    await wrapper.get('.ap-fold').trigger('click');

    expect(wrapper.text()).toContain('test line 6');

    await wrapper.setProps({
      member: member(['Calling Bash: pnpm test', 'streamed update']),
    });

    expect(wrapper.text()).toContain('streamed update');
  });
});
