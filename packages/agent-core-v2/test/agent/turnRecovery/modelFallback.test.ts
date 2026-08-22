import { afterEach, describe, expect, it } from 'vitest';

import { APIConnectionError } from '#/kosong/contract/errors';
import { emptyUsage } from '#/kosong/contract/usage';
import { IFlagService } from '#/app/flag/flag';
import { IEventBus } from '#/app/event/eventBus';
import { IAgentLoopService, type LoopErrorContext, type Step } from '#/agent/loop/loop';
import { ContinuationStepRequest } from '#/agent/loop/stepRequest';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { IAgentProfileService } from '#/agent/profile/profile';
import { MODEL_FALLBACK_FLAG_ID } from '#/agent/turnRecovery/flag';
import { IAgentModelFallbackService, ModelFallbackSwitched } from '#/agent/turnRecovery/modelFallback';

import { stubFlag } from '../../app/flag/stubs';
import { appService, createTestAgent, llmGenerateServices, type TestAgentContext } from '../../harness';

const FALLBACK_MODEL = 'fallback-model';

function fallbackFlags(enabled = true): ReturnType<typeof appService> {
  return appService(IFlagService, stubFlag((id) => enabled && id === MODEL_FALLBACK_FLAG_ID));
}

function fallbackTestConfig() {
  return {
    loopControl: { maxAttemptsPerStep: 1, maxStepsPerTurn: 20, fallbackModel: FALLBACK_MODEL },
    models: {
      'mock-model': { provider: 'test-provider', model: 'mock-model', maxContextSize: 1_000_000 },
      [FALLBACK_MODEL]: {
        provider: 'test-provider',
        model: 'fallback-model',
        maxContextSize: 1_000_000,
      },
    },
  };
}

describe('modelFallback plugin', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  async function runTurn(turnId: number): Promise<Awaited<ReturnType<IAgentLoopService['run']>>> {
    void ctx.dispatcher.dispatch(new TurnStarted({ turnId, origin: { kind: 'user' } }));
    const loop = ctx.get(IAgentLoopService);
    loop.enqueue(new ContinuationStepRequest());
    return loop.run({ turnId });
  }

  it('switches to the configured fallback after retries are exhausted and completes', async () => {
    let calls = 0;
    const switched: ModelFallbackSwitched[] = [];
    ctx = createTestAgent(
      fallbackFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        if (calls === 1) throw new APIConnectionError('terminated');
        return {
          id: `mf-${String(calls)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'recovered on fallback' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: 'completed' as const,
          rawFinishReason: 'stop',
        };
      }),
      { initialConfig: fallbackTestConfig() },
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(calls).toBe(2);
    expect(ctx.get(IAgentProfileService).getModel()).toBe(FALLBACK_MODEL);
    expect(switched).toHaveLength(1);
    expect(switched[0]?.fromModel).toBe('mock-model');
    expect(switched[0]?.toModel).toBe(FALLBACK_MODEL);
    expect(switched[0]?.turnId).toBe(1);
  });

  it('falls back at most once per turn and fails when the fallback also errors', async () => {
    let calls = 0;
    ctx = createTestAgent(
      fallbackFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        throw new APIConnectionError('still down');
      }),
      { initialConfig: fallbackTestConfig() },
    );

    const result = await runTurn(1);

    expect(result.type).toBe('failed');
    expect(calls).toBe(2);
    expect(ctx.get(IAgentProfileService).getModel()).toBe(FALLBACK_MODEL);
  });

  it('stays on the primary model when no fallback is configured', async () => {
    let calls = 0;
    ctx = createTestAgent(
      fallbackFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        if (calls === 1) throw new APIConnectionError('terminated');
        return {
          id: `nofb-${String(calls)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'ok' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: 'completed' as const,
          rawFinishReason: 'stop',
        };
      }),
      {
        initialConfig: {
          loopControl: { maxAttemptsPerStep: 2, maxStepsPerTurn: 20 },
        },
      },
    );

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(calls).toBe(2);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
  });

  it('does nothing when the flag is off even with a fallback configured', async () => {
    let calls = 0;
    ctx = createTestAgent(
      fallbackFlags(false),
      llmGenerateServices(async () => {
        calls += 1;
        if (calls === 1) throw new APIConnectionError('terminated');
        return {
          id: `off-${String(calls)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'ok' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: 'completed' as const,
          rawFinishReason: 'stop',
        };
      }),
      {
        initialConfig: {
          loopControl: { maxAttemptsPerStep: 2, maxStepsPerTurn: 20, fallbackModel: FALLBACK_MODEL },
          models: fallbackTestConfig().models,
        },
      },
    );

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(calls).toBe(2);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
  });

  it('refuses to switch when the turn signal is already aborted', async () => {
    ctx = createTestAgent(
      fallbackFlags(),
      llmGenerateServices(async () => ({
        id: 'aborted',
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'ok' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      })),
      { initialConfig: fallbackTestConfig() },
    );

    const signal = AbortSignal.abort();
    const stepStub: Step = {
      id: 'step-1',
      turnId: 1,
      state: 'running',
      signal,
      result: Promise.resolve({ type: 'cancelled', reason: new Error('cancelled') }),
      cancel: () => false,
    };
    const context: LoopErrorContext = {
      turnId: 1,
      step: 1,
      signal,
      error: new APIConnectionError('terminated'),
      failedDriver: new ContinuationStepRequest(),
      retry: () => stepStub,
    };

    const switched = await ctx
      .get(IAgentModelFallbackService)
      .tryFallbackSwitch(context);

    expect(switched).toBe(false);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
  });

  it('refuses to switch when only the current step is aborted', async () => {
    ctx = createTestAgent(
      fallbackFlags(),
      llmGenerateServices(async () => ({
        id: 'step-aborted',
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'ok' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      })),
      { initialConfig: fallbackTestConfig() },
    );

    const stepController = new AbortController();
    stepController.abort();
    const stepStub: Step = {
      id: 'step-1',
      turnId: 1,
      state: 'running',
      signal: stepController.signal,
      result: Promise.resolve({ type: 'cancelled', reason: new Error('cancelled') }),
      cancel: () => false,
    };
    const context: LoopErrorContext = {
      turnId: 1,
      step: 1,
      signal: new AbortController().signal,
      currentStep: stepStub,
      error: new APIConnectionError('terminated'),
      failedDriver: new ContinuationStepRequest(),
      retry: () => stepStub,
    };

    const switched = await ctx
      .get(IAgentModelFallbackService)
      .tryFallbackSwitch(context);

    expect(switched).toBe(false);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
  });
});
