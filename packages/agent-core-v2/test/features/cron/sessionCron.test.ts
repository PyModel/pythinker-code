import { describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices } from '#/_base/di/test';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import type { DurableAgentRuntimeParticipant } from '#/agent/runtime/agentRuntime';
import { AgentRuntimeSet } from '#/agent/runtime/agentRuntimeSet';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { IConfigService } from '#/app/config/config';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { CRON_SECTION, DEFAULT_CRON_CONFIG } from '#/features/cron/configSection';
import { AgentCron, cronAgentRuntimeProvider } from '#/features/cron/cronAgentRuntime';
import { CronCursor, type CronModelState } from '#/features/cron/cronOps';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { stubAgentContext } from '../../agent/agentContext/stubs';
import { stubLoopWithHooks } from '../../agent/loop/stubs';
import {
  createTestAgent,
  InMemoryWireRecordPersistence,
  type TestAgentContext,
  type TestAgentOptions,
} from '../../harness';
import { StubConfigService } from '../../kosong/stubs';

async function bootCronContext(options: TestAgentOptions = {}): Promise<TestAgentContext> {
  const ctx = createTestAgent(options);
  ctx.pythinkerConfig = {
    ...ctx.pythinkerConfig,
    cron: { debug: false, noJitter: true, noStale: false, disabled: false, manualTick: true },
  };
  return ctx;
}

describe('session cron wire persistence', () => {
  it('settles an in-flight tick without reading services after close', async () => {
    let releaseInject!: () => void;
    const injection = new Promise<undefined>((resolve) => { releaseInject = () => { resolve(undefined); }; });
    let markInjectStarted!: () => void;
    const injectStarted = new Promise<void>((resolve) => { markInjectStarted = resolve; });
    let closed = false;
    let postCloseReads = 0;
    const configReads: string[] = [];
    const recordRead = (): void => {
      if (closed) postCloseReads += 1;
    };
    class TrackedConfigService extends StubConfigService {
      override get<T = unknown>(domain: string): T {
        configReads.push(domain);
        recordRead();
        return super.get<T>(domain);
      }
    }
    const disposables = new DisposableStore();
    const services = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IConfigService, new TrackedConfigService({
          [CRON_SECTION]: { ...DEFAULT_CRON_CONFIG, noJitter: true, manualTick: true },
        }));
        reg.defineInstance(IAgentLoopService, stubLoopWithHooks());
        reg.definePartialInstance(IAgentPromptService, {
          inject: () => {
            markInjectStarted();
            return injection;
          },
        });
        reg.definePartialInstance(IEventDispatcher, {
          dispatch: async () => { recordRead(); },
        });
        reg.definePartialInstance(ITelemetryService, {
          track2: () => { recordRead(); },
        });
      },
    });
    const agent = stubAgentContext('main');
    const runtimes = new AgentRuntimeSet(agent, services);
    runtimes.apply({
      definition: AgentCron,
      provider: cronAgentRuntimeProvider,
      generation: 1,
      active: true,
    });
    let participant: DurableAgentRuntimeParticipant<CronModelState> | undefined;
    runtimes.attachDurable({
      attach: (attached) => {
        participant = attached;
        return { dispose: () => {} };
      },
    });

    try {
      await runtimes.restore();
      if (participant === undefined) throw new Error('Cron runtime was not attached');
      const now = Date.now();
      participant.commit(new Map([['deadbeef', {
        id: 'deadbeef',
        cron: '* * * * *',
        prompt: 'fire after wait',
        recurring: true,
        createdAt: now - 120_000,
      }]]));

      const ticking = runtimes.resolve(AgentCron).tick();
      await injectStarted;
      await runtimes.close();
      closed = true;
      releaseInject();

      await expect(ticking).resolves.toBeUndefined();
      expect(postCloseReads).toBe(0);
      expect(new Set(configReads)).toEqual(new Set([CRON_SECTION]));
    } finally {
      await runtimes.close();
      disposables.dispose();
    }
  });

  it('writes cron ops as durable wire records and rebuilds the task table on replay', async () => {
    const persistence = new InMemoryWireRecordPersistence();
    const first = await bootCronContext({ persistence });
    try {
      await first.restorePersisted();

      const cron = first.resolve(AgentCron);
      const task = cron.addTask({ cron: '0 9 * * *', prompt: 'wire me', recurring: true });
      await first.dispatcher.dispatch(new CronCursor({ id: task.id, lastFiredAt: 1234 }));
      await first.dispatcher.flush();

      const types = persistence.records.map((record) => record.type);
      expect(types).toContain('cron.add');
      expect(types).toContain('cron.cursor');
    } finally {
      await first.dispose();
    }

    const second = await bootCronContext({
      persistence: new InMemoryWireRecordPersistence(persistence.records),
    });
    try {
      await second.restorePersisted();

      const resumed = second.resolve(AgentCron);
      const rebuilt = resumed.list();
      expect(rebuilt).toHaveLength(1);
      expect(rebuilt[0]).toMatchObject({
        cron: '0 9 * * *',
        prompt: 'wire me',
        recurring: true,
        lastFiredAt: 1234,
      });
    } finally {
      await second.dispose();
    }
  });

  it('drops deleted tasks on replay', async () => {
    const persistence = new InMemoryWireRecordPersistence();
    const first = await bootCronContext({ persistence });
    try {
      await first.restorePersisted();

      const cron = first.resolve(AgentCron);
      const kept = cron.addTask({ cron: '0 9 * * *', prompt: 'keep', recurring: true });
      const dropped = cron.addTask({ cron: '0 10 * * *', prompt: 'drop', recurring: true });
      cron.removeTasks([dropped.id]);
      await first.dispatcher.flush();

      const types = persistence.records.map((record) => record.type);
      expect(types).toContain('cron.delete');
      expect(kept.id).not.toBe(dropped.id);
    } finally {
      await first.dispose();
    }

    const second = await bootCronContext({
      persistence: new InMemoryWireRecordPersistence(persistence.records),
    });
    try {
      await second.restorePersisted();

      const resumed = second.resolve(AgentCron);
      expect(resumed.list().map((task) => task.prompt)).toEqual(['keep']);
    } finally {
      await second.dispose();
    }
  });

  it('activates effects once after restore and cleans them up on close', async () => {
    const ctx = await bootCronContext();
    const registry = ctx.get(IAgentToolRegistryService);
    let disposed = false;
    try {
      expect(registry.listReferences().filter((tool) => tool.name.startsWith('Cron'))).toEqual([
        { name: 'CronCreate', source: 'builtin' },
        { name: 'CronDelete', source: 'builtin' },
        { name: 'CronList', source: 'builtin' },
      ]);
      await expect(ctx.resolve(AgentCron).tick()).rejects.toThrow('not restored');

      await ctx.restorePersisted();
      void ctx.restoreRuntimes();

      await expect(ctx.resolve(AgentCron).tick()).resolves.toBeUndefined();

      await ctx.dispose();
      disposed = true;

      expect(() => ctx.resolve(AgentCron)).toThrow();
    } finally {
      if (!disposed) await ctx.dispose();
    }
  });
});
