import { afterEach, describe, expect, it } from 'vitest';

import { emptyUsage } from '#/kosong/contract/usage';
import { IFlagService } from '#/app/flag/flag';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentLoopService } from '#/agent/loop/loop';
import { ContinuationStepRequest } from '#/agent/loop/stepRequest';
import { TurnStarted } from '#/agent/loop/turnEvents';

import { stubFlag } from '../../app/flag/stubs';
import { appService, createTestAgent, llmGenerateServices, type TestAgentContext } from '../../harness';
import { OUTPUT_TOKEN_RECOVERY_FLAG_ID } from '#/agent/turnRecovery/flag';

function recoveryFlags(): ReturnType<typeof appService> {
  return appService(IFlagService, stubFlag((id) => id === OUTPUT_TOKEN_RECOVERY_FLAG_ID));
}

describe('outputTokenRecovery plugin', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  async function runTurn(turnId: number): Promise<Awaited<ReturnType<IAgentLoopService['run']>>> {
    void ctx.dispatcher.dispatch(new TurnStarted({ agentId: 'main', turnId, origin: { kind: 'user' } }));
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

  it('continues a truncated response with a resume nudge and completes', async () => {
    let calls = 0;
    ctx = createTestAgent(
      recoveryFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        const truncated = calls === 1;
        return {
          id: `otr-${String(calls)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: truncated ? 'partial' : 'done' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: truncated ? ('truncated' as const) : ('completed' as const),
          rawFinishReason: truncated ? 'max_tokens' : 'stop',
        };
      }),
          );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed', truncated: false });
    expect(calls).toBe(2);
    const triggers = retryOriginTriggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toBe('max_output_tokens');
  });

  it('caps recoveries per turn and ends the turn truncated', async () => {
    ctx = createTestAgent(
      recoveryFlags(),
      llmGenerateServices(async () => ({
        id: 'always-truncated',
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'cut' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'truncated' as const,
        rawFinishReason: 'max_tokens',
      })),
          );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed', truncated: true });
    expect(retryOriginTriggers()).toHaveLength(3);
  });

  it('leaves truncated turns alone when the flag is off', async () => {
    ctx = createTestAgent(
      appService(IFlagService, stubFlag(false)),
      llmGenerateServices(async () => ({
        id: 'flag-off',
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'cut' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'truncated' as const,
        rawFinishReason: 'max_tokens',
      })),
    );

    const result = await runTurn(1);

    expect(result).toMatchObject({ type: 'completed', truncated: true });
    expect(retryOriginTriggers()).toHaveLength(0);
  });

  it('resets the attempt budget on each new turn', async () => {
    let calls = 0;
    ctx = createTestAgent(
      recoveryFlags(),
      llmGenerateServices(async () => {
        calls += 1;
        const truncated = calls % 2 === 1;
        return {
          id: `reset-${String(calls)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: 'x' }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: truncated ? ('truncated' as const) : ('completed' as const),
          rawFinishReason: truncated ? 'max_tokens' : 'stop',
        };
      }),
    );

    await runTurn(1);
    await runTurn(2);

    expect(calls).toBe(4);
    expect(retryOriginTriggers()).toHaveLength(2);
  });
});
