import { describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices } from '#/_base/di/test';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import { AgentRuntimeSet } from '#/agent/runtime/agentRuntimeSet';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { IConfigService } from '#/app/config/config';
import { DEFAULT_CRON_CONFIG } from '#/features/cron/configSection';
import { AgentCron, cronAgentRuntimeProvider } from '#/features/cron/cronAgentRuntime';
import { CronCursor } from '#/features/cron/cronOps';

import {
  createTestAgent,
  InMemoryWireRecordPersistence,
  type TestAgentContext,
  type TestAgentOptions,
} from '../../harness';

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
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => { releaseReady = resolve; });
    let markTickStarted!: () => void;
    const tickStarted = new Promise<void>((resolve) => { markTickStarted = resolve; });
    let readyReads = 0;
    let closed = false;
    const disposables = new DisposableStore();
    const services = createServices(disposables, {
      additionalServices: (reg) => {
        reg.definePartialInstance(IConfigService, {
          get ready() {
            readyReads += 1;
            if (readyReads === 2) markTickStarted();
            return ready;
          },
          get: <T>() => {
            if (closed) throw new Error('config read after close');
            return DEFAULT_CRON_CONFIG as T;
          },
        });
      },
    });
    const agent = { agentId: 'main', generation: 1, space: {} } as AgentContext;
    const runtimes = new AgentRuntimeSet(agent, services);
    runtimes.apply({
      definition: AgentCron,
      provider: cronAgentRuntimeProvider,
      generation: 1,
      active: true,
    });
    runtimes.attachDurable({ attach: () => ({ dispose: () => {} }) });

    const restoring = runtimes.restore();
    const ticking = runtimes.resolve(AgentCron).tick();
    await tickStarted;
    await runtimes.close();
    closed = true;
    disposables.dispose();
    releaseReady();

    await expect(ticking).resolves.toBeUndefined();
    await expect(restoring).resolves.toBeUndefined();
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
