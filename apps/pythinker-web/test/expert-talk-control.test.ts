import { flushPromises, mount } from '@vue/test-utils';
import { computed, effectScope, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExpertTalkControl from '../src/components/chat/ExpertTalkControl.vue';
import ExpertTalkExchange from '../src/components/chat/ExpertTalkExchange.vue';
import SecondaryModelPicker from '../src/components/settings/SecondaryModelPicker.vue';
import type { AppExpertTalkRun, AppExpertTalkStatus } from '../src/api/types';
import { useExpertTalkState } from '../src/composables/client/useExpertTalkState';
import { expertTalkContextKey } from '../src/composables/expertTalkContext';
import { useDiscussionPreferences } from '../src/composables/useDiscussionPreferences';
import webI18n from '../src/i18n';
import { STORAGE_KEYS } from '../src/lib/storage';

const { api, copyTextToClipboard } = vi.hoisted(() => ({
  api: {
    getExpertTalkStatus: vi.fn(),
    getExpertTalkRun: vi.fn(),
    listExpertTalkRuns: vi.fn(),
    configureExpertTalk: vi.fn(),
    armExpertTalk: vi.fn(),
  },
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));
vi.mock('../src/lib/clipboard', () => ({ copyTextToClipboard }));
vi.mock('../src/components/chat/Markdown.vue', () => ({
  default: {
    props: ['text'],
    template: '<div class="markdown-stub">{{ text }}</div>',
  },
}));

function status() {
  return {
    feature: 'enabled' as const,
    resourceVersion: '1',
    config: null,
    activation: { state: 'idle' as const },
    pairValidation: { state: 'unknown' as const },
  };
}

describe('ExpertTalkControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(STORAGE_KEYS.discussionPair);
    useDiscussionPreferences().setShowReasoning(true);
    api.listExpertTalkRuns.mockResolvedValue({ runs: [] });
  });

  it('saves a model pair without arming the next message', async () => {
    api.getExpertTalkStatus.mockResolvedValue(status());
    api.configureExpertTalk.mockResolvedValue({
      ...status(),
      resourceVersion: '2',
      config: {
        fusionLeadModelId: 'provider/lead',
        peerModelId: 'provider/peer',
        fusionLeadThinkingEffort: 'max',
        peerThinkingEffort: 'low',
      },
    });
    api.armExpertTalk.mockResolvedValue({
      ...status(),
      resourceVersion: '2',
      config: {
        fusionLeadModelId: 'provider/lead',
        peerModelId: 'provider/peer',
      },
      activation: { state: 'armed', armId: 'arm-1' },
    });
    const scope = effectScope();
    const state = scope.run(() => useExpertTalkState(
      computed(() => 'session-1'),
      computed(() => true),
      vi.fn(),
    ))!;
    await flushPromises();

    const pair = {
      fusionLeadModelId: 'provider/lead',
      peerModelId: 'provider/peer',
      fusionLeadThinkingEffort: 'max',
      peerThinkingEffort: 'low',
    };
    await state.configurePair(pair);

    expect(api.configureExpertTalk).toHaveBeenCalledWith(
      'session-1',
      pair,
      '1',
    );
    expect(api.armExpertTalk).not.toHaveBeenCalled();
    expect(state.preferredPair.value).toEqual(pair);

    await state.useForNextMessage(pair);

    expect(api.armExpertTalk).toHaveBeenCalledWith('session-1', '2');
    scope.stop();
  });

  it('saves the Discussion preference without an active session', async () => {
    const scope = effectScope();
    const state = scope.run(() => useExpertTalkState(
      computed(() => ''),
      computed(() => true),
      vi.fn(),
    ))!;
    const pair = {
      fusionLeadModelId: 'provider/lead',
      peerModelId: 'provider/peer',
      fusionLeadThinkingEffort: 'max',
      peerThinkingEffort: 'high',
    };

    await state.configurePair(pair);

    expect(state.preferredPair.value).toEqual(pair);
    expect(api.configureExpertTalk).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.discussionPair)!)).toEqual(pair);
    scope.stop();
  });

  it('does not let an older refresh overwrite a confirmed pair save', async () => {
    let resolveStale!: (value: ReturnType<typeof status>) => void;
    const stale = new Promise<ReturnType<typeof status>>((resolve) => {
      resolveStale = resolve;
    });
    api.getExpertTalkStatus
      .mockImplementationOnce(() => stale)
      .mockResolvedValueOnce(status());
    const confirmed = {
      ...status(),
      resourceVersion: '2',
      config: {
        fusionLeadModelId: 'provider/lead',
        peerModelId: 'provider/peer',
        fusionLeadThinkingEffort: 'max',
      },
    };
    api.configureExpertTalk.mockResolvedValue(confirmed);
    const scope = effectScope();
    const state = scope.run(() => useExpertTalkState(
      computed(() => 'session-1'),
      computed(() => true),
      vi.fn(),
    ))!;
    const pair = {
      fusionLeadModelId: 'provider/lead',
      peerModelId: 'provider/peer',
      fusionLeadThinkingEffort: 'max',
    };

    await state.configurePair(pair);
    expect(state.status.value?.resourceVersion).toBe('2');
    resolveStale(status());
    await flushPromises();

    expect(state.status.value?.resourceVersion).toBe('2');
    expect(state.status.value?.config).toEqual(pair);
    state.applyStatus('session-1', status(), 10);
    expect(state.status.value?.resourceVersion).toBe('2');
    state.applyStatus('session-1', confirmed, 11);
    state.applyStatus('session-1', status(), 10);
    expect(state.status.value?.resourceVersion).toBe('2');
    scope.stop();
  });

  it('refreshes live reasoning snapshots that share a volatile event sequence', async () => {
    api.getExpertTalkStatus.mockResolvedValue(status());
    api.getExpertTalkRun.mockResolvedValue({
      runId: 'run-1',
      sessionId: 'session-1',
      revision: 1,
      progressRevision: 2,
    });
    const scope = effectScope();
    const state = scope.run(() => useExpertTalkState(
      computed(() => 'session-1'),
      computed(() => true),
      vi.fn(),
    ))!;
    await flushPromises();
    const running = {
      ...status(),
      activeRunId: 'run-1',
      latestRunId: 'run-1',
    };

    state.applyStatus('session-1', running, 12);
    state.applyStatus('session-1', running, 12);
    await flushPromises();

    expect(api.getExpertTalkRun).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it('hides the composer pill until Discussion is armed or running', () => {
    const currentStatus = ref<AppExpertTalkStatus>({
      ...status(),
      config: { fusionLeadModelId: 'provider/lead', peerModelId: 'provider/peer' },
    });
    const context = {
      available: computed(() => true),
      preferredPair: ref(currentStatus.value.config ?? undefined),
      status: computed(() => currentStatus.value),
      run: computed(() => undefined),
      runs: computed(() => []),
      busy: ref(false),
      error: ref<string>(),
      refresh: vi.fn(),
      configurePair: vi.fn(),
      useForNextMessage: vi.fn(),
      disarm: vi.fn(),
      clear: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      applyStatus: vi.fn(),
      armIdForSession: vi.fn(),
      promptAccepted: vi.fn(),
    };
    const wrapper = mount(ExpertTalkControl, {
      props: { models: [] },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: context },
        stubs: { Icon: true, teleport: true },
      },
    });

    expect(wrapper.find('.ui-pill').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the protocol disclosure and arms an ordered distinct pair', async () => {
    const currentStatus = ref(status());
    const useForNextMessage = vi.fn().mockResolvedValue(undefined);
    const context = {
      available: computed(() => true),
      preferredPair: ref(),
      status: computed(() => currentStatus.value),
      run: computed(() => undefined),
      runs: computed(() => []),
      busy: ref(false),
      error: ref<string>(),
      refresh: vi.fn(),
      configurePair: vi.fn(),
      useForNextMessage,
      disarm: vi.fn(),
      clear: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      applyStatus: vi.fn(),
      armIdForSession: vi.fn(),
      promptAccepted: vi.fn(),
    };
    const wrapper = mount(ExpertTalkControl, {
      attachTo: document.body,
      props: {
        trigger: 'launcher',
        models: [
          { id: 'provider/lead', provider: 'Provider A', model: 'Lead', maxContextSize: 128000, capabilities: ['tool_use', 'thinking'], supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
          { id: 'provider/peer', provider: 'Provider B', model: 'Peer', maxContextSize: 128000, capabilities: ['tool_use', 'thinking'], supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
          { id: 'provider/text', provider: 'Provider C', model: 'Text only', maxContextSize: 128000, capabilities: [] },
        ],
      },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: context },
        stubs: { Icon: true, teleport: true },
      },
    });

    await wrapper.get('.expert-talk__launcher').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('5-12 model requests, at most 24 provider attempts');
    expect(wrapper.findAll('select')).toHaveLength(0);
    const modelPickers = wrapper.findAllComponents(SecondaryModelPicker);
    expect(modelPickers).toHaveLength(2);
    expect(modelPickers[0]!.props('groups')).toEqual([
      { provider: 'Provider A', options: [{ id: 'provider/lead', label: 'Lead' }] },
      { provider: 'Provider B', options: [{ id: 'provider/peer', label: 'Peer' }] },
    ]);
    modelPickers[0]!.vm.$emit('select', { model: 'provider/lead', effort: 'max' });
    modelPickers[1]!.vm.$emit('select', { model: 'provider/peer', effort: 'low' });
    await nextTick();
    await wrapper.findAll('button').find((button) => button.text().includes('Use for next message'))!.trigger('click');
    await nextTick();

    expect(useForNextMessage).toHaveBeenCalledWith({
      fusionLeadModelId: 'provider/lead',
      peerModelId: 'provider/peer',
      fusionLeadThinkingEffort: 'max',
      peerThinkingEffort: 'low',
    });
    wrapper.unmount();
  });

  it('shows the one-shot widget and exposes activation and Escape cancellation', async () => {
    const currentStatus = ref<AppExpertTalkStatus>({
      ...status(),
      config: { fusionLeadModelId: 'provider/lead', peerModelId: 'provider/peer' },
      activation: { state: 'armed', armId: 'arm-1' },
      pairValidation: { state: 'valid' },
    });
    const currentRun = ref<AppExpertTalkRun>();
    const useForNextMessage = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    const context = {
      available: computed(() => true),
      preferredPair: ref(currentStatus.value.config ?? undefined),
      status: computed(() => currentStatus.value),
      run: computed(() => currentRun.value),
      runs: computed(() => []),
      busy: ref(false),
      error: ref<string>(),
      refresh: vi.fn(),
      configurePair: vi.fn(),
      useForNextMessage,
      disarm: vi.fn(),
      clear: vi.fn(),
      cancel,
      retry: vi.fn(),
      applyStatus: vi.fn(),
      armIdForSession: vi.fn(),
      promptAccepted: vi.fn(),
    };
    const wrapper = mount(ExpertTalkControl, {
      props: {
        trigger: 'widget',
        models: [
          { id: 'provider/lead', provider: 'Provider A', model: 'Lead', maxContextSize: 128000, capabilities: ['tool_use'] },
          { id: 'provider/peer', provider: 'Provider B', model: 'Peer', maxContextSize: 128000, capabilities: ['tool_use'] },
        ],
      },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: context },
        stubs: { Icon: true, teleport: true },
      },
    });

    expect(wrapper.get('.expert-talk__one-shot').text()).toContain('Discussion');
    expect(wrapper.get('.expert-talk__one-shot').text()).toContain('◆ Lead');
    expect(wrapper.get('.expert-talk__one-shot').text()).toContain('▲ Peer');
    expect(wrapper.get('.expert-talk__one-shot').text()).toContain('next prompt only');
    await wrapper.setProps({ trigger: 'pill' });
    expect(wrapper.find('.ui-pill').exists()).toBe(false);
    await wrapper.setProps({ trigger: 'widget' });
    const control = wrapper.vm as unknown as {
      activate(): Promise<void>;
      cancelActive(): boolean;
    };
    currentStatus.value = { ...currentStatus.value, activation: { state: 'idle' } };
    await control.activate();
    expect(useForNextMessage).toHaveBeenCalledWith({
      fusionLeadModelId: 'provider/lead',
      peerModelId: 'provider/peer',
    });

    currentRun.value = { state: 'running' } as AppExpertTalkRun;
    await nextTick();
    expect(control.cancelActive()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('shows reciprocal reviews side by side with full-width Fusion', async () => {
    const currentRun = ref<AppExpertTalkRun>({
      runId: 'run-1',
      sessionId: 'session-1',
      turnId: 1,
      promptId: 'prompt-1',
      state: 'completed' as const,
      stage: 'terminal' as const,
      createdAt: '2026-08-30T12:00:00.000Z',
      updatedAt: '2026-08-30T12:00:08.000Z',
      bindings: {
        fusionLead: { requestedModelId: 'provider/lead', effectiveModelId: 'provider/lead' },
        peer: { requestedModelId: 'provider/peer', effectiveModelId: 'provider/peer' },
      },
      opening: {
        lead: {
          role: 'fusion_lead' as const,
          stage: 'opening' as const,
          state: 'completed' as const,
          text: 'Model one opening',
          partial: false,
          startedAt: '2026-08-30T12:00:00.000Z',
          endedAt: '2026-08-30T12:00:02.000Z',
          usage: { inputOther: 1024, inputCacheRead: 512, inputCacheCreation: 0, output: 600 },
          toolCallCount: 1,
        },
        peer: {
          role: 'peer' as const,
          stage: 'opening' as const,
          state: 'completed' as const,
          text: 'Model two opening',
          partial: false,
        },
      },
      review: {
        lead: {
          role: 'fusion_lead' as const,
          stage: 'review' as const,
          state: 'completed' as const,
          text: 'Fusion Lead review of Peer Expert',
          partial: false,
        },
        peer: {
          role: 'peer' as const,
          stage: 'review' as const,
          state: 'completed' as const,
          text: 'Peer Expert review of Fusion Lead',
          partial: false,
        },
      },
      fusion: {
        role: 'fusion_lead' as const,
        stage: 'fusion' as const,
        state: 'completed' as const,
        text: 'Fused final answer',
        partial: false,
      },
      result: {
        answer: 'Fused answer users receive',
        notes: {
          consensus: ['Both experts recommend the safe migration path.'],
          divergence: ['Fusion Lead prefers a staged rollout; Peer Expert prefers one release.'],
          uncertainty: ['Production traffic data is not available.'],
        },
      },
      usage: { complete: true, requestCount: 5, providerAttemptCount: 5 },
      revision: 6,
    });
    const currentStatus = ref<AppExpertTalkStatus>({
      ...status(),
      config: { fusionLeadModelId: 'provider/lead', peerModelId: 'provider/peer' },
      activation: { state: 'armed', armId: 'arm-1' },
      pairValidation: { state: 'valid' as const },
    });
    const disarm = vi.fn(async () => {
      currentStatus.value = { ...currentStatus.value, activation: { state: 'idle' } };
    });
    const context = {
      available: computed(() => true),
      preferredPair: ref(currentStatus.value.config ?? undefined),
      status: computed(() => currentStatus.value),
      run: computed(() => currentRun.value),
      runs: computed(() => [currentRun.value]),
      busy: ref(false),
      error: ref<string>(),
      refresh: vi.fn(),
      configurePair: vi.fn(),
      useForNextMessage: vi.fn(),
      disarm,
      clear: vi.fn(),
      cancel: vi.fn(),
      retry: vi.fn(),
      applyStatus: vi.fn(),
      armIdForSession: vi.fn(),
      promptAccepted: vi.fn(),
    };
    const wrapper = mount(ExpertTalkControl, {
      attachTo: document.body,
      props: {
        trigger: 'launcher',
        models: [
          { id: 'provider/lead', provider: 'Provider A', model: 'GPT Test', maxContextSize: 128000, capabilities: ['tool_use'] },
          { id: 'provider/peer', provider: 'Provider B', model: 'GLM Test', maxContextSize: 128000, capabilities: ['tool_use'] },
        ],
      },
      global: {
        plugins: [webI18n],
        provide: { [expertTalkContextKey as symbol]: context },
        stubs: { Icon: true, teleport: true },
      },
    });

    await wrapper.get('.expert-talk__launcher').trigger('click');
    await nextTick();
    await flushPromises();

    const columns = wrapper.findAll('.expert-talk__agent-column');
    expect(columns).toHaveLength(2);
    expect(columns[0]!.text()).toContain('Fusion Lead');
    expect(columns[0]!.text()).toContain('GPT Test');
    expect(columns[0]!.text()).toContain('Model one opening');
    expect(columns[0]!.text()).toContain('Time2.0s');
    expect(columns[0]!.text()).toContain('Tokens in1.5k');
    expect(columns[0]!.text()).toContain('TPS300');
    expect(columns[0]!.text()).toContain('Fusion Lead review of Peer Expert');
    expect(columns[1]!.text()).toContain('Peer Expert');
    expect(columns[1]!.text()).toContain('GLM Test');
    expect(columns[1]!.text()).toContain('Model two opening');
    expect(columns[1]!.text()).toContain('Peer Expert review of Fusion Lead');
    expect(wrapper.get('.expert-talk__fusion').text()).toContain('Fused answer users receive');
    expect(wrapper.get('.expert-talk__fusion').text()).not.toContain('Fused final answer');
    expect(wrapper.get('.expert-talk__fusion .expert-talk__agent-symbol').text()).toBe('⧉');
    const comparison = wrapper.get('[data-testid="discussion-comparison"]');
    expect(comparison.text()).toContain('Final comparison');
    expect(comparison.get('.expert-talk__comparison-card--agreement').text()).toContain(
      'Both experts recommend the safe migration path.',
    );
    expect(comparison.get('.expert-talk__comparison-card--difference').text()).toContain(
      'Fusion Lead prefers a staged rollout; Peer Expert prefers one release.',
    );
    expect(comparison.get('.expert-talk__comparison-card--uncertainty').text()).toContain(
      'Production traffic data is not available.',
    );
    const exchange = wrapper.get('details');
    expect((exchange.element as HTMLDetailsElement).open).toBe(true);
    expect(exchange.get('summary').text()).toContain('View exchange and fusion notes');

    const button = (label: string) => wrapper.findAll('button')
      .find((candidate) => candidate.text().trim() === label)!;
    expect(wrapper.get('.expert-talk__fusion').text()).toContain('Fresh Fusion Lead inference');
    expect(wrapper.find('[data-testid="expert-opinion-review"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="expert-opinion-finish"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="expert-opinion-fuse"]').exists()).toBe(false);
    await button('Take Fusion').trigger('click');
    expect(wrapper.emitted('take')).toEqual([['Fused answer users receive']]);
    expect(copyTextToClipboard).not.toHaveBeenCalled();
    expect(wrapper.find('.expert-talk__fusion').exists()).toBe(false);

    await wrapper.get('.expert-talk__launcher').trigger('click');
    await nextTick();
    await flushPromises();
    await button('Build from Fusion').trigger('click');
    expect(disarm).toHaveBeenCalled();
    expect(wrapper.emitted('build')).toEqual([['Fused answer users receive']]);
    expect(wrapper.find('.expert-talk__fusion').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps live reasoning reactive without hiding tools or answers', async () => {
    const run: AppExpertTalkRun = {
      runId: 'run-live',
      sessionId: 'session-1',
      turnId: 3,
      promptId: 'prompt-live',
      state: 'running',
      stage: 'opening',
      createdAt: '2026-08-30T12:00:00.000Z',
      updatedAt: '2026-08-30T12:00:01.000Z',
      bindings: {
        fusionLead: { requestedModelId: 'provider/lead', effectiveModelId: 'provider/lead' },
        peer: { requestedModelId: 'provider/peer', effectiveModelId: 'provider/peer' },
      },
      opening: {
        lead: {
          role: 'fusion_lead',
          stage: 'opening',
          state: 'running',
          text: '# Fusion Lead draft',
          thinking: 'Checking the evidence.',
          tools: [{ id: 'tool-1', name: 'Read' }],
          partial: true,
        },
        peer: { role: 'peer', stage: 'opening', state: 'running', partial: false },
      },
      review: {
        lead: { role: 'fusion_lead', stage: 'review', state: 'pending', partial: false },
        peer: { role: 'peer', stage: 'review', state: 'pending', partial: false },
      },
      usage: { complete: false, requestCount: 1, providerAttemptCount: 1 },
      revision: 2,
    };
    const wrapper = mount(ExpertTalkExchange, {
      props: {
        run,
        models: [
          { id: 'provider/lead', provider: 'Provider A', model: 'GPT Test', maxContextSize: 128000 },
          { id: 'provider/peer', provider: 'Provider B', model: 'GLM Test', maxContextSize: 128000 },
        ],
      },
      global: {
        plugins: [webI18n],
        stubs: {
          Icon: true,
          Markdown: {
            props: ['text', 'streaming'],
            template: '<div class="markdown-stub" :data-streaming="streaming">{{ text }}</div>',
          },
        },
      },
    });

    expect(wrapper.get('.expert-talk__artifact-text .markdown-stub').text())
      .toBe('# Fusion Lead draft');
    const thinking = wrapper.findAll('.expert-talk__thinking');
    expect(thinking).toHaveLength(2);
    expect(thinking[0]?.text()).toContain('▹');
    expect(thinking[0]?.get('.expert-talk__thinking-preview').text()).toBe('Checking the evidence.');
    expect(thinking[0]?.find('.expert-talk__thinking-toggle').exists()).toBe(false);
    expect(thinking[1]?.text()).toContain('Waiting for reasoning...');
    expect(wrapper.get('.expert-talk__tools').text()).toContain('Read');

    useDiscussionPreferences().setShowReasoning(false);
    await nextTick();
    expect(wrapper.findAll('.expert-talk__thinking')).toHaveLength(0);
    expect(wrapper.get('.expert-talk__artifact-text .markdown-stub').text())
      .toBe('# Fusion Lead draft');
    expect(wrapper.get('.expert-talk__tools').text()).toContain('Read');

    useDiscussionPreferences().setShowReasoning(true);
    await nextTick();
    expect(wrapper.findAll('.expert-talk__thinking')).toHaveLength(2);

    await wrapper.setProps({
      run: {
        ...run,
        state: 'completed',
        stage: 'terminal',
        revision: 3,
      },
    });
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(true);
    wrapper.unmount();
  });
});
