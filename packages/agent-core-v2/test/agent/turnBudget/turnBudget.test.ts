import { afterEach, describe, expect, it } from 'vitest';

import { type TokenUsage } from '#/kosong/contract/usage';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentLoopService } from '#/agent/loop/loop';
import { ContinuationStepRequest } from '#/agent/loop/stepRequest';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { IFlagService } from '#/app/flag/flag';
import { TURN_BUDGET_CONTINUATION_FLAG_ID } from '#/agent/turnBudget/flag';

import { stubFlag } from '../../app/flag/stubs';
import { appService, createTestAgent, llmGenerateServices, type TestAgentContext } from '../../harness';

function budgetFlags(enabled = true): ReturnType<typeof appService> {
  return appService(IFlagService, stubFlag((id) => enabled && id === TURN_BUDGET_CONTINUATION_FLAG_ID));
}

function outputUsage(output: number): TokenUsage {
  return { inputOther: 0, inputCacheRead: 0, inputCacheCreation: 0, output };
}

function completedResponse(text: string, output: number) {
  return {
    id: `tb-${text}`,
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      toolCalls: [],
    },
    usage: outputUsage(output),
    finishReason: 'completed' as const,
    rawFinishReason: 'stop',
  };
}

describe('turnBudget plugin', () => {
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

  function retryOriginTriggers(): readonly (string | undefined)[] {
    return ctx
      .get(IAgentContextMemoryService)
      .get()
      .filter((message) => message.role === 'user' && message.origin?.kind === 'retry')
      .map((message) =>
        message.origin?.kind === 'retry' ? message.origin.trigger : undefined,
      );
  }

  it('continues a naturally-stopping turn until the output-token threshold', async () => {
    const outputs = [400, 400, 400];
    let calls = 0;
    ctx = createTestAgent(
      budgetFlags(),
      llmGenerateServices(async () => {
        const response = completedResponse(`step-${String(calls)}`, outputs[calls] ?? 0);
        calls += 1;
        return response;
      }),
      {
        initialConfig: {
          loopControl: { maxStepsPerTurn: 20, turnBudgetTokens: 1000 },
        },
      },
    );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed' });
    expect(calls).toBe(3);
    const triggers = retryOriginTriggers();
    expect(triggers).toHaveLength(2);
    expect(triggers.every((trigger) => trigger === 'token_budget')).toBe(true);
  });

  it('stops on diminishing returns after the continuation cap', async () => {
    let calls = 0;
    ctx = createTestAgent(
      budgetFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        return completedResponse(`tiny-${String(calls)}`, 1);
      }),
      {
        initialConfig: {
          loopControl: { maxStepsPerTurn: 20, turnBudgetTokens: 1_000_000 },
        },
      },
    );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed' });
    expect(calls).toBe(4);
    expect(retryOriginTriggers()).toHaveLength(3);
  });

  it('keeps continuing when only the current delta is small after the cap', async () => {
    const outputs = [1000, 1000, 1000, 1, 1];
    let calls = 0;
    ctx = createTestAgent(
      budgetFlags(),
      llmGenerateServices(async () => {
        const response = completedResponse(`mixed-${String(calls)}`, outputs[calls] ?? 0);
        calls += 1;
        return response;
      }),
      {
        initialConfig: {
          loopControl: { maxStepsPerTurn: 30, turnBudgetTokens: 1_000_000 },
        },
      },
    );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed' });
    expect(calls).toBe(5);
    expect(retryOriginTriggers()).toEqual([
      'token_budget',
      'token_budget',
      'token_budget',
      'token_budget',
    ]);
  });

  it('does not continue when the flag is off even with a budget configured', async () => {
    let calls = 0;
    ctx = createTestAgent(
      budgetFlags(false),
      llmGenerateServices(async () => {
        calls += 1;
        return completedResponse(`off-${String(calls)}`, 400);
      }),
      {
        initialConfig: {
          loopControl: { maxStepsPerTurn: 20, turnBudgetTokens: 1000 },
        },
      },
    );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed' });
    expect(calls).toBe(1);
    expect(retryOriginTriggers()).toHaveLength(0);
  });

  it('resets accumulation between turns', async () => {
    let calls = 0;
    ctx = createTestAgent(
      budgetFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        return completedResponse(`reset-${String(calls)}`, 400);
      }),
      {
        initialConfig: {
          loopControl: { maxStepsPerTurn: 30, turnBudgetTokens: 1000 },
        },
      },
    );

    await runTurn(1);
    await runTurn(2);

    expect(calls).toBe(6);
    expect(retryOriginTriggers()).toHaveLength(4);
  });
});
