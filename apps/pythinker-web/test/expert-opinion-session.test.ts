import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppExpertTalkRun, AppModel } from '../src/api/types';
import ChatPane from '../src/components/chat/ChatPane.vue';
import webI18n from '../src/i18n';
import type { ChatTurn } from '../src/types';

vi.mock('markstream-vue', () => ({
  MarkdownRender: defineComponent({
    props: ['content'],
    setup(props) {
      return () => String(props.content ?? '');
    },
  }),
  enableKatex: vi.fn(),
  enableMermaid: vi.fn(),
  setKaTeXWorker: vi.fn(),
  clearKaTeXWorker: vi.fn(),
  setMermaidWorker: vi.fn(),
  clearMermaidWorker: vi.fn(),
}));
vi.mock('markstream-vue/workers/katexRenderer.worker?worker&type=module', () => ({
  default: class { terminate(): void {} },
}));
vi.mock('markstream-vue/workers/mermaidParser.worker?worker&type=module', () => ({
  default: class { terminate(): void {} },
}));

const models: AppModel[] = [
  { id: 'provider/architect', provider: 'Provider A', model: 'Architect Model', maxContextSize: 128000, capabilities: ['tool_use'] },
  { id: 'provider/builder', provider: 'Provider B', model: 'Builder Model', maxContextSize: 128000, capabilities: ['tool_use'] },
];

const run: AppExpertTalkRun = {
  runId: 'run-1',
  sessionId: 'session-1',
  turnId: 1,
  promptId: 'prompt-1',
  state: 'completed',
  stage: 'terminal',
  createdAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:08.000Z',
  bindings: {
    fusionLead: { requestedModelId: 'provider/architect', effectiveModelId: 'provider/architect' },
    peer: { requestedModelId: 'provider/builder', effectiveModelId: 'provider/builder' },
  },
  opening: {
    lead: { role: 'fusion_lead', stage: 'opening', state: 'completed', text: 'Architect opening', partial: false },
    peer: { role: 'peer', stage: 'opening', state: 'completed', text: 'Builder opening', partial: false },
  },
  review: {
    lead: { role: 'fusion_lead', stage: 'review', state: 'completed', text: 'Architect review of Builder', partial: false },
  },
  fusion: { role: 'fusion_lead', stage: 'fusion', state: 'completed', text: 'Raw fusion', partial: false },
  result: {
    answer: 'Consolidated answer',
    notes: { consensus: [], divergence: [], uncertainty: [] },
  },
  usage: { complete: true, requestCount: 4, providerAttemptCount: 4 },
  revision: 6,
};

function turns(promptId = 'prompt-1'): ChatTurn[] {
  return [
    { id: 'u1', promptId, role: 'user', no: 1, text: 'Compare these choices' },
    { id: 'a1', promptId, role: 'assistant', no: 2, text: 'Consolidated answer' },
  ];
}

function mountPane(promptId = 'prompt-1') {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  return mount(ChatPane, {
    props: {
      turns: turns(promptId),
      expertTalkRuns: [run],
      expertTalkModels: models,
      turnActive: false,
      working: false,
    },
    global: { plugins: [webI18n] },
  });
}

describe('Discussion session transcript', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the complete exchange inline and replaces the duplicate assistant answer', () => {
    const wrapper = mountPane();

    expect(wrapper.findAll('.expert-opinion-exchange')).toHaveLength(1);
    expect(wrapper.text()).toContain('Architect opening');
    expect(wrapper.text()).toContain('Builder opening');
    expect(wrapper.text()).toContain('Architect review of Builder');
    expect(wrapper.text()).not.toContain('Builder review of Architect');
    expect(wrapper.text()).toContain('Consolidated answer');
    expect(wrapper.findAll('.a-msg')).toHaveLength(0);
  });

  it('matches a restored transcript by the durable turn id', () => {
    const wrapper = mountPane('t1');

    expect(wrapper.findAll('.expert-opinion-exchange')).toHaveLength(1);
  });

  it('passes Build from Fusion into the conversation composer handoff', async () => {
    const wrapper = mountPane();

    await wrapper.get('[data-testid="expert-opinion-build"]').trigger('click');
    expect(wrapper.emitted('buildExpertTalk')).toEqual([['Consolidated answer']]);
  });

  it('shows a static waiting mascot while Discussion pauses for an action', async () => {
    const wrapper = mountPane();
    const waitingRun: AppExpertTalkRun = {
      ...run,
      state: 'waiting',
      stage: 'review',
      fusion: undefined,
      result: undefined,
    };

    await wrapper.setProps({
      turns: [turns()[0]!],
      expertTalkRuns: [waitingRun],
      working: true,
    });

    expect(wrapper.get('.wi-label').text()).toBe('Waiting…');
    expect(wrapper.get('.wi-label').classes()).not.toContain('ui-shimmer');
    expect(wrapper.get('.wi-mascot img').attributes('src')).toContain('mascot-idle');
  });
});
