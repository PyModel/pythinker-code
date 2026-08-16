import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ConversationPane from '../src/components/ConversationPane.vue';
import conversationPaneSource from '../src/components/ConversationPane.vue?raw';
import type { ChatTurn, ConversationStatus } from '../src/types';

const status: ConversationStatus = {
  model: 'pythinker-test',
  modelId: 'pythinker-test',
  ctxUsed: 0,
  ctxMax: 0,
  permission: 'manual',
  branch: 'main',
  cwd: '/repo',
  isGitRepo: true,
};

const turns: ChatTurn[] = [
  { id: 'u1', role: 'user', no: 1, text: 'First prompt' },
  { id: 'a1', role: 'assistant', no: 2, text: 'First reply' },
  { id: 'u2', role: 'user', no: 3, text: 'Second prompt' },
  { id: 'a2', role: 'assistant', no: 4, text: 'Second reply preview' },
  { id: 'u3', role: 'user', no: 5, text: 'Third prompt' },
  { id: 'a3', role: 'assistant', no: 6, text: 'Third reply' },
];

function mountPane() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: { en: {} },
    missingWarn: false,
    fallbackWarn: false,
  });

  return mount(ConversationPane, {
    attachTo: document.body,
    props: {
      mobile: false,
      turns,
      tasks: [],
      status,
      betaToc: true,
      sessionLoading: false,
      running: false,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ChatHeader: true,
        ChatPane: {
          template: `
            <div>
              <div class="turn-anchor" data-turn-id="u1" />
              <div class="turn-anchor" data-turn-id="a1" />
              <div class="turn-anchor" data-turn-id="u2" />
              <div class="turn-anchor" data-turn-id="a2" />
              <div class="turn-anchor" data-turn-id="u3" />
              <div class="turn-anchor" data-turn-id="a3" />
            </div>
          `,
        },
        Composer: true,
        ChatDock: true,
        DynamicWorkflowCard: true,
      },
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelector('[data-test-conversation-toc-style]')?.remove();
});

describe('ConversationPane prompt anchors', () => {
  it('renders one anchor tick per user prompt on the left rail', () => {
    const style = document.createElement('style');
    style.dataset.testConversationTocStyle = '';
    style.textContent = conversationPaneSource.match(/\.conversation-toc \{[\s\S]*?\n\}/)?.[0] ?? '';
    document.head.append(style);
    const wrapper = mountPane();
    const ticks = wrapper.findAll('.anchor-tick');

    expect(ticks).toHaveLength(3);
    const railStyle = getComputedStyle(wrapper.get('.conversation-toc').element);
    expect(railStyle.left).toBe('16px');
    expect(railStyle.right).toBe('auto');
  });

  it('renders uniform ticks without inline width styles', () => {
    const wrapper = mountPane();
    const ticks = wrapper.findAll('.anchor-tick');

    expect(ticks.every((tick) => tick.attributes('style') === undefined)).toBe(true);
  });

  it('does not render a viewport indicator', async () => {
    const wrapper = mountPane();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.toc-viewport')).toHaveLength(0);
  });

  it('tracks the nearest user turn as the active tick', async () => {
    const wrapper = mountPane();
    await wrapper.vm.$nextTick();
    const pane = wrapper.get('.panes').element as HTMLElement;
    const anchorTops: Record<string, number> = {
      u1: 20,
      a1: 295,
      u2: 260,
      a2: 400,
      u3: 520,
      a3: 550,
    };
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 600));
    pane.querySelectorAll<HTMLElement>('.turn-anchor[data-turn-id]').forEach((anchor) => {
      const top = anchorTops[anchor.dataset.turnId ?? ''] ?? 0;
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 100, 10));
    });

    await wrapper.get('.panes').trigger('scroll');

    const activeTicks = wrapper.findAll('.anchor-tick.active');
    expect(activeTicks).toHaveLength(1);
    expect(activeTicks[0]?.attributes('aria-label')).toBe('#3 Second prompt');
  });

  it('shows the prompt and following assistant reply on hover', async () => {
    const wrapper = mountPane();

    await wrapper.get('.anchor-tick:nth-child(2)').trigger('mouseenter');

    expect(wrapper.get('.toc-tooltip').text()).toContain('Second prompt');
    expect(wrapper.get('.toc-tooltip').text()).toContain('Second reply preview');
  });

  it('keeps prompt numbers in aria labels without visible number elements', () => {
    const wrapper = mountPane();
    const ticks = wrapper.findAll('.anchor-tick');

    expect(wrapper.find('.toc-no').exists()).toBe(false);
    expect(ticks.map((tick) => tick.attributes('aria-label'))).toEqual([
      '#1 First prompt',
      '#3 Second prompt',
      '#5 Third prompt',
    ]);
  });
});
