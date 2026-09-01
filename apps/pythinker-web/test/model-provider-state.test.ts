import { computed, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

import type { ExtendedState } from '../src/composables/usePythinkerWebClient';
import { useModelProviderState } from '../src/composables/client/useModelProviderState';

const { api } = vi.hoisted(() => ({
  api: {
    listModels: vi.fn(),
    setConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('model thinking preferences', () => {
  it('restores the explicit effort per model without persisting derived switch defaults', async () => {
    api.listModels.mockResolvedValueOnce([
      {
        id: 'provider/effort',
        provider: 'Provider',
        model: 'Effort',
        maxContextSize: 128_000,
        capabilities: ['thinking'],
        supportEfforts: ['low', 'high', 'max'],
        defaultEffort: 'low',
      },
      {
        id: 'provider/plain',
        provider: 'Provider',
        model: 'Plain',
        maxContextSize: 128_000,
        capabilities: [],
      },
    ]);
    const rawState = reactive({
      activeSessionId: null,
      sessions: [],
      defaultModel: 'provider/effort',
      thinking: undefined,
      thinkingBySession: {},
      inFlightBySession: {},
    }) as unknown as ExtendedState;
    const state = useModelProviderState(rawState, {
      pushOperationFailure: vi.fn(),
      refreshSessionStatus: vi.fn().mockResolvedValue(undefined),
      persistSessionProfile: vi.fn().mockResolvedValue(true),
      activity: computed(() => 'idle'),
      updateSession: vi.fn(),
      updateSessionMessages: vi.fn(),
    });

    await state.loadModels();
    state.setThinking('max');
    await flushPromises();
    expect(api.setConfig).toHaveBeenCalledOnce();

    await state.setModel('provider/plain');
    expect(rawState.thinking).toBe('off');
    await state.setModel('provider/effort');
    expect(rawState.thinking).toBe('max');
    expect(api.setConfig).toHaveBeenCalledOnce();
  });
});
