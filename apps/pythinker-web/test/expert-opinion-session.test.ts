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
  { id: 'provider/lead', provider: 'Provider A', model: 'Lead Model', maxContextSize: 128000, capabilities: ['tool_use'] },
  { id: 'provider/peer', provider: 'Provider B', model: 'Peer Model', maxContextSize: 128000, capabilities: ['tool_use'] },
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
    fusionLead: { requestedModelId: 'provider/lead', effectiveModelId: 'provider/lead' },
    peer: { requestedModelId: 'provider/peer', effectiveModelId: 'provider/peer' },
  },
  opening: {
    lead: { role: 'fusion_lead', stage: 'opening', state: 'completed', text: 'Fusion Lead opening', partial: false },
    peer: { role: 'peer', stage: 'opening', state: 'completed', text: 'Peer Expert opening', partial: false },
  },
  review: {
    lead: { role: 'fusion_lead', stage: 'review', state: 'completed', text: 'Fusion Lead review of Peer Expert', partial: false },
    peer: { role: 'peer', stage: 'review', state: 'completed', text: 'Peer Expert review of Fusion Lead', partial: false },
  },
  fusion: { role: 'fusion_lead', stage: 'fusion', state: 'completed', text: 'Raw fusion', partial: false },
  result: {
    answer: 'Consolidated answer',
    notes: { consensus: [], divergence: [], uncertainty: [] },
  },
  usage: { complete: true, requestCount: 5, providerAttemptCount: 5 },
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

describe('Expert Talk session transcript', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the complete exchange inline and replaces the duplicate assistant answer', () => {
    const wrapper = mountPane();

    expect(wrapper.findAll('.expert-opinion-exchange')).toHaveLength(1);
    expect(wrapper.text()).toContain('Fusion Lead opening');
    expect(wrapper.text()).toContain('Peer Expert opening');
    expect(wrapper.text()).toContain('Fusion Lead review of Peer Expert');
    expect(wrapper.text()).toContain('Peer Expert review of Fusion Lead');
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

});
