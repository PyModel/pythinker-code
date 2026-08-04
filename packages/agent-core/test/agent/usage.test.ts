import { describe, expect, it } from 'vitest';

import { type ModelProvider, SingleModelProvider } from '../../src/session/provider-manager';
import { UsageRecorder } from '../../src/agent/usage';
import { testAgent } from './harness/agent';

describe('Agent usage', () => {
  it('accumulates usage by model', () => {
    const usage = new UsageRecorder();

    usage.record('model-a', {
      inputOther: 1,
      output: 2,
      inputCacheRead: 3,
      inputCacheCreation: 4,
    });
    usage.record('model-a', {
      inputOther: 10,
      output: 20,
      inputCacheRead: 30,
      inputCacheCreation: 40,
    });
    usage.record('model-b', {
      inputOther: 100,
      output: 200,
      inputCacheRead: 300,
      inputCacheCreation: 400,
    });

    expect(usage.data()).toEqual({
      byModel: {
        'model-a': {
          inputOther: 11,
          output: 22,
          inputCacheRead: 33,
          inputCacheCreation: 44,
        },
        'model-b': {
          inputOther: 100,
          output: 200,
          inputCacheRead: 300,
          inputCacheCreation: 400,
        },
      },
      total: {
        inputOther: 111,
        output: 222,
        inputCacheRead: 333,
        inputCacheCreation: 444,
      },
      currentTurn: undefined,
    });
  });

  it('tracks current turn usage separately from session totals', () => {
    const usage = new UsageRecorder();

    usage.record('model-a', {
      inputOther: 1,
      output: 2,
      inputCacheRead: 3,
      inputCacheCreation: 4,
    });
    usage.beginTurn();
    usage.record(
      'model-a',
      {
        inputOther: 10,
        output: 20,
        inputCacheRead: 30,
        inputCacheCreation: 40,
      },
      'turn',
    );
    usage.record(
      'model-b',
      {
        inputOther: 100,
        output: 200,
        inputCacheRead: 300,
        inputCacheCreation: 400,
      },
      'turn',
    );

    expect(usage.data()).toMatchObject({
      total: {
        inputOther: 111,
        output: 222,
        inputCacheRead: 333,
        inputCacheCreation: 444,
      },
      currentTurn: {
        inputOther: 110,
        output: 220,
        inputCacheRead: 330,
        inputCacheCreation: 440,
      },
    });

    usage.endTurn();

    expect(usage.data().currentTurn).toBeUndefined();
  });

  it('returns immutable status snapshots', () => {
    const usage = new UsageRecorder();

    usage.record('model-a', {
      inputOther: 1,
      output: 2,
      inputCacheRead: 3,
      inputCacheCreation: 4,
    });
    const snapshot = usage.data();

    usage.record('model-a', {
      inputOther: 10,
      output: 20,
      inputCacheRead: 30,
      inputCacheCreation: 40,
    });

    expect(snapshot).toEqual({
      byModel: {
        'model-a': {
          inputOther: 1,
          output: 2,
          inputCacheRead: 3,
          inputCacheCreation: 4,
        },
      },
      total: {
        inputOther: 1,
        output: 2,
        inputCacheRead: 3,
        inputCacheCreation: 4,
      },
      currentTurn: undefined,
    });
  });

  it('accumulates USD cost across recorded model usage', () => {
    const usage = new UsageRecorder();

    usage.record(
      'model-a',
      {
        inputOther: 1_000_000,
        output: 2_000_000,
        inputCacheRead: 3_000_000,
        inputCacheCreation: 4_000_000,
      },
      'session',
      { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    );
    usage.record(
      'model-b',
      {
        inputOther: 500_000,
        output: 500_000,
        inputCacheRead: 0,
        inputCacheCreation: 0,
      },
      'session',
      { input: 2, output: 4 },
    );

    expect(usage.data().totalCostUsd).toBe(33);
  });

  it('omits total USD cost when none of the recorded models have rates', () => {
    const usage = new UsageRecorder();

    usage.record('model-a', {
      inputOther: 1_000_000,
      output: 2_000_000,
      inputCacheRead: 3_000_000,
      inputCacheCreation: 4_000_000,
    });

    expect(usage.data().totalCostUsd).toBeUndefined();
  });

  it('omits total USD cost when any recorded usage has unknown rates', () => {
    const usage = new UsageRecorder();

    usage.record(
      'priced-model',
      { ...zeroUsage(), inputOther: 1_000_000 },
      'session',
      { input: 2 },
    );
    usage.record('unpriced-model', { ...zeroUsage(), output: 1_000_000 });

    expect(usage.data().totalCostUsd).toBeUndefined();
  });

  it('resolves rates for the recorded model instead of the active model', () => {
    const ratesByModel = {
      'active-model': { input: 1 },
      'recorded-model': { input: 7 },
    } as const;
    const providerManager: ModelProvider = {
      defaultModel: 'active-model',
      resolveProviderConfig(model) {
        return {
          providerName: 'test-provider',
          provider: { type: 'pythinker', apiKey: 'test-key', model },
          modelCapabilities: {
            image_in: false,
            video_in: false,
            audio_in: false,
            thinking: false,
            tool_use: true,
            max_context_tokens: 100_000,
            cost: ratesByModel[model as keyof typeof ratesByModel],
          },
        };
      },
    };
    const ctx = testAgent({ providerManager });
    ctx.configure({
      provider: {
        type: 'pythinker',
        apiKey: 'test-key',
        model: 'active-model',
      },
    });

    ctx.agent.usage.record('recorded-model', {
      ...zeroUsage(),
      inputOther: 1_000_000,
    });

    expect(ctx.agent.usage.data().totalCostUsd).toBe(7);
  });

  it('emits the active model cost rates and accumulated spend', () => {
    const provider = {
      type: 'pythinker',
      apiKey: 'test-key',
      model: 'priced-model',
    } as const;
    const modelCostRates = { input: 2, output: 4, cacheRead: 0.5, cacheWrite: 3 };
    const ctx = testAgent({
      providerManager: new SingleModelProvider(provider, {
        image_in: false,
        video_in: false,
        audio_in: false,
        thinking: false,
        tool_use: true,
        max_context_tokens: 100_000,
        cost: modelCostRates,
      }),
    });
    ctx.configure({ provider });

    ctx.agent.usage.record('priced-model', {
      inputOther: 1_000_000,
      output: 500_000,
      inputCacheRead: 2_000_000,
      inputCacheCreation: 1_000_000,
    });

    expect(ctx.allEvents.at(-1)).toMatchObject({
      type: '[rpc]',
      event: 'agent.status.updated',
      args: {
        model: 'priced-model',
        modelCostRates,
        usage: { totalCostUsd: 8 },
      },
    });
  });
});

function zeroUsage() {
  return {
    inputOther: 0,
    output: 0,
    inputCacheRead: 0,
    inputCacheCreation: 0,
  };
}
