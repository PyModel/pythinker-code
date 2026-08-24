// apps/pythinker-web/test/continue-turn.test.ts
//
// Failed-turn recovery: the banner's
// "Continue" button must submit a FIXED "Continue" prompt (i18n key
// conversation.turnFailedResumeText) with no attachments — never a re-send of
// the user's own last message, which would repeat its instructions and side
// effects.
import { mount } from '@vue/test-utils';
import { createI18n, type I18n } from 'vue-i18n';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ChatPane from '../src/components/chat/ChatPane.vue';
import type { ChatTurn } from '../src/types';

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
      conversation: {
        turnFailed: 'Model request failed — this turn was interrupted',
        turnFailedMaxSteps: 'Step limit reached — this turn was interrupted',
        turnFailedResume: 'Continue',
        turnFailedResumeText: 'Continue',
        undoTooltip: 'Undo',
        activatedSkill: 'Activated {name}',
        userMessage: { expand: 'Expand', collapse: 'Collapse' },
      },
      composer: {
        queueLabel: 'Queue',
        queuePending: '{n} waiting to send',
        queueSteer: 'Send into the running turn',
        queueDragTitle: 'Drag to reorder',
        editQueued: 'Edit queued message',
        queuedAttachments: '{n} attachments',
        remove: 'Remove',
      },
      filePreview: { copy: 'Copy' },
    },
  },
});

const turns: ChatTurn[] = [
  { id: 'u1', role: 'user', no: 1, text: 'delete everything in /tmp' },
  {
    id: 'a1',
    role: 'assistant',
    no: 2,
    text: '',
    tools: [{ id: 'tool_1', name: 'Bash', arg: '{}', status: 'error', output: ['boom'] }],
  },
];

function mountPane() {
  return mount(ChatPane, {
    props: {
      turns,
      turnActive: false,
      working: false,
      lastTurnReason: 'failed',
      turnErrorKind: 'error',
    },
    global: { plugins: [i18n as I18n] },
  });
}

describe('failed-turn recovery (ChatPane)', () => {
  it('submits the fixed Continue prompt, not the last user message', async () => {
    const wrapper = mountPane();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    await wrapper.find('.turn-failed button').trigger('click');
    const emitted = wrapper.emitted('continueTurn');
    expect(emitted).toEqual([['Continue']]);
    // Guard against regression to the old resubmission behavior: the emitted
    // text must not be the user's prior prompt.
    expect(emitted![0]![0]).not.toBe('delete everything in /tmp');
    vi.unstubAllGlobals();
  });

  it('renders the max-steps banner variant and still submits the fixed prompt', async () => {
    const wrapper = mount(ChatPane, {
      props: {
        turns,
        turnActive: false,
        working: false,
        lastTurnReason: 'failed',
        turnErrorKind: 'max_steps',
      },
      global: { plugins: [i18n as I18n] },
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    expect(wrapper.find('.tf-title').text()).toContain('Step limit reached');
    await wrapper.find('.turn-failed button').trigger('click');
    expect(wrapper.emitted('continueTurn')).toEqual([['Continue']]);
    vi.unstubAllGlobals();
  });
});

describe('queued prompts and skill turns (ChatPane)', () => {
  it('offers steer only on the first queued prompt', async () => {
    const wrapper = mount(ChatPane, {
      props: {
        turns: [],
        queued: [
          { id: 'q_1', text: 'first', attachmentCount: 0 },
          { id: 'q_2', text: 'second', attachmentCount: 0 },
        ],
      },
      global: { plugins: [i18n as I18n] },
    });

    expect(wrapper.findAll('.q-send')).toHaveLength(1);
    await wrapper.find('.q-send').trigger('click');
    expect(wrapper.emitted('steerQueued')).toEqual([[0]]);
  });

  it('renders a reversible skill activation as a normal user-turn pill', () => {
    const wrapper = mount(ChatPane, {
      props: {
        turns: [
          {
            id: 'u_skill',
            role: 'user',
            no: 1,
            text: 'focus on errors',
            skillActivation: { name: 'code-review', args: 'focus on errors' },
          },
        ],
        working: false,
      },
      global: { plugins: [i18n as I18n] },
    });

    expect(wrapper.find('.mention-skill').text()).toBe('code-review');
    expect(wrapper.find('.u-text').text()).toContain('focus on errors');
    expect(wrapper.find('.u-edit').exists()).toBe(true);
    expect(wrapper.find('.skill-act').exists()).toBe(false);
  });

  it('keeps plugin commands as cards and non-revivable skill turns locked', () => {
    const skillPill = '[code-review](pythinker-code://skill/code-review)';
    const wrapper = mount(ChatPane, {
      props: {
        turns: [
          {
            id: 'u_skill',
            role: 'user',
            no: 1,
            text: skillPill,
            skillActivation: { name: 'code-review', args: skillPill },
          },
          {
            id: 'u_plugin',
            role: 'user',
            no: 2,
            text: 'args',
            pluginCommand: { pluginId: 'tools', commandName: 'run', args: 'args' },
          },
        ],
        working: false,
      },
      global: { plugins: [i18n as I18n] },
    });

    expect(wrapper.findAll('.skill-act')).toHaveLength(1);
    expect(wrapper.find('.skill-act').text()).toContain('/tools:run');
    expect(wrapper.find('.u-edit').exists()).toBe(false);
  });
});
