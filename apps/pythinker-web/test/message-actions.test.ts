import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ChatPane from '../src/components/ChatPane.vue';
import type { ChatTurn } from '../src/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      conversation: {
        cancel: 'Cancel',
        compactedPlain: 'Context compacted',
        compactedAuto: 'Context auto-compacted',
        compactedTokens: ' ({before} -> {after})',
        confirm: 'Confirm',
        loading: 'Loading',
        retry: 'Retry',
        retryConfirm: 'Retry last reply?',
        undo: 'Undo',
        undoConfirm: 'Undo last message?',
        undoTooltip: 'Undoing the conversation will not roll back code changes',
        viewSummary: 'View summary',
        yesterday: 'Yesterday',
      },
      filePreview: { copy: 'Copy' },
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

function mountPane(
  turns: ChatTurn[],
  props: { mobile?: boolean; running?: boolean; sending?: boolean } = {},
) {
  return mount(ChatPane, {
    props: { turns, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        Markdown: { props: ['text'], template: '<div class="markdown-stub">{{ text }}</div>' },
        ThinkingBlock: true,
        ToolCall: true,
        ActivityNotice: true,
        ActivitySpinner: true,
        MascotSprite: true,
        AgentCard: true,
        AgentGroup: true,
      },
    },
  });
}

function userTurn(id: string, no: number, text: string, skillActivation?: ChatTurn['skillActivation']): ChatTurn {
  return { id, role: 'user', no, text, skillActivation };
}

function assistantTurn(id: string, no: number, text: string): ChatTurn {
  return { id, role: 'assistant', no, text };
}

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

const finalExchange: ChatTurn[] = [
  userTurn('u1', 1, 'old prompt'),
  assistantTurn('a1', 2, 'old reply'),
  userTurn('u2', 3, 'last prompt'),
  assistantTurn('a2', 4, 'last reply'),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatPane message actions', () => {
  it.each([false, true])('renders Retry only on the final assistant run in both layouts', (mobile) => {
    const wrapper = mountPane(finalExchange, { mobile });

    expect(wrapper.findAll('.retry-btn')).toHaveLength(1);
    expect(wrapper.find('[data-turn-id="a1"] .retry-btn').exists()).toBe(false);
    expect(wrapper.find('[data-turn-id="a2"] .retry-btn').exists()).toBe(true);
  });

  it.each([
    { name: 'running', props: { running: true } },
    { name: 'sending', props: { sending: true } },
  ])('does not render Retry while $name is true', ({ props }) => {
    const idleWrapper = mountPane(finalExchange);
    expect(idleWrapper.find('.retry-btn').exists()).toBe(true);

    const wrapper = mountPane(finalExchange, props);
    expect(wrapper.find('.retry-btn').exists()).toBe(false);
  });

  it('requires confirmation before emitting regenerate', async () => {
    const wrapper = mountPane(finalExchange);
    const retry = wrapper.find('.retry-btn');
    expect(retry.exists()).toBe(true);

    await retry.trigger('click');

    expect(wrapper.emitted('regenerate')).toBeUndefined();
    expect(wrapper.find('.retry-confirm').exists()).toBe(true);

    await wrapper.find('.retry-confirm .confirm').trigger('click');

    expect(wrapper.emitted('regenerate')).toHaveLength(1);
  });

  it('cancelling Retry emits nothing and restores the button', async () => {
    const wrapper = mountPane(finalExchange);
    expect(wrapper.find('.retry-btn').exists()).toBe(true);

    await wrapper.find('.retry-btn').trigger('click');
    await wrapper.find('.retry-confirm .u-edit-confirm-btn:not(.confirm)').trigger('click');

    expect(wrapper.emitted('regenerate')).toBeUndefined();
    expect(wrapper.find('.retry-btn').exists()).toBe(true);
  });

  it.each([false, true])('copies a user turn verbatim in both layouts', async (mobile) => {
    const text = '  keep this text exactly\nwith its spaces  ';
    const writeText = mockClipboard();
    const wrapper = mountPane([userTurn('u1', 1, text)], { mobile });
    const copy = wrapper.find('.user-cpbtn');
    expect(copy.exists()).toBe(true);

    await copy.trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(text);
  });

  it.each([false, true])('shows user copy on an older user turn in both layouts', (mobile) => {
    const turns = [
      userTurn('u1', 1, 'older prompt'),
      assistantTurn('a1', 2, 'older reply'),
      userTurn('u2', 3, 'last prompt'),
    ];
    const wrapper = mountPane(turns, { mobile });

    expect(wrapper.findAll('.user-cpbtn')).toHaveLength(2);
    expect(wrapper.find('[data-user-turn-id="u1"]').exists()).toBe(true);
  });

  it.each([false, true])('skips user copy for skill activations in both layouts', (mobile) => {
    const wrapper = mountPane(
      [
        userTurn('u1', 1, 'normal prompt'),
        userTurn('skill', 2, '/review src/app.ts', { name: 'review', args: 'src/app.ts' }),
      ],
      { mobile },
    );

    expect(wrapper.find('[data-user-turn-id="u1"]').exists()).toBe(true);
    expect(wrapper.find('[data-user-turn-id="skill"]').exists()).toBe(false);
  });
});

describe('message action theme guard', () => {
  const sourceAllowlist: Array<{ path: string; colors: string[] }> = [
    { path: '../src/components/ChatPane.vue', colors: [] },
    {
      path: '../src/components/ConversationPane.vue',
      colors: [
        '#'.concat('000'),
        'rgba'.concat('(0, 0, 0, 0.28)'),
        'rgba'.concat('(0, 0, 0, 0.14)'),
        'rgba'.concat('(0, 0, 0, 0.12)'),
        'rgba'.concat('(0, 0, 0, 0.18)'),
      ],
    },
    { path: '../src/App.vue', colors: [] },
    { path: '../src/i18n/locales/en/conversation.ts', colors: [] },
    { path: './message-actions.test.ts', colors: [] },
  ];
  const colorLiteralPattern = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba)\([^)]*\)/giu;
  const darkUtilityPattern = new RegExp(['dark', ':'].join(''), 'gu');

  it('keeps touched files free of new theme literals and dark utilities', async () => {
    for (const { path, colors } of sourceAllowlist) {
      const source = await readFile(resolve(import.meta.dirname, path), 'utf8');
      expect(source.match(darkUtilityPattern) ?? [], path).toEqual([]);
      expect((source.match(colorLiteralPattern) ?? []).toSorted(), path).toEqual([...colors].toSorted());
    }
  });
});
