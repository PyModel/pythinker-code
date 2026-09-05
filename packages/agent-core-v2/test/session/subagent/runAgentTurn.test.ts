import { describe, expect, it } from 'vitest';

import type { IAgentScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { IAgentLoopService, type Turn } from '#/agent/loop/loop';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionUsageService } from '#/session/usage/sessionUsage';
import { runAgentTurn } from '#/session/subagent/runAgentTurn';
import type { TokenUsage } from '#/kosong/contract/usage';

function usage(inputOther: number, output: number): TokenUsage {
  return { inputOther, output, inputCacheRead: 0, inputCacheCreation: 0 };
}

function fakeHandle(totals: TokenUsage[]): IAgentScopeHandle {
  let cursor = 0;
  const agentContext = { agentId: 'sub', space: {} };
  const turn: Turn = {
    id: 1,
    signal: new AbortController().signal,
    ready: Promise.resolve(),
    result: Promise.resolve({ type: 'completed', steps: 1, truncated: false }),
    cancel: () => true,
  };
  return {
    id: 'sub',
    kind: LifecycleScope.Agent,
    accessor: {
      get: <T>(serviceId: unknown): T => {
        if (serviceId === ISessionUsageService) {
          return {
            status: () => ({ total: totals[Math.min(cursor, totals.length - 1)] }),
          } as T;
        }
        if (serviceId === IAgentPromptService) {
          return {
            enqueue: async () => {
              cursor += 1;
              return { launched: Promise.resolve(turn) };
            },
          } as T;
        }
        if (serviceId === IAgentLoopService) return { cancel: () => true } as T;
        if (serviceId === IAgentContextMemoryService) {
          return { get: () => [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }] } as T;
        }
        if (serviceId === IAgentScopeContext) return { agentContext } as T;
        throw new Error(`unexpected service ${String(serviceId)}`);
      },
    },
    dispose: () => {},
  };
}

describe('runAgentTurn usage attribution', () => {
  it('reports per-run usage as a delta and exposes the cumulative total separately', async () => {
    const handle = fakeHandle([usage(100, 10), usage(160, 25), usage(200, 30)]);
    const options = { signal: new AbortController().signal };

    const first = await runAgentTurn(handle, { kind: 'prompt', prompt: 'one' }, options);
    const firstResult = await first.completion;
    expect(firstResult.usage).toEqual(usage(60, 15));
    expect(firstResult.cumulativeUsage).toEqual(usage(160, 25));

    const second = await runAgentTurn(handle, { kind: 'prompt', prompt: 'two' }, options);
    const secondResult = await second.completion;
    expect(secondResult.usage).toEqual(usage(40, 5));
    expect(secondResult.cumulativeUsage).toEqual(usage(200, 30));
  });
});
