import { describe, expect, it, vi } from 'vitest';

import { DynamicInjector } from '../../../src/agent/injection/injector';
import { InjectionManager } from '../../../src/agent/injection/manager';
import { TodoListReminderInjector } from '../../../src/agent/injection/todo-list';
import { testAgent } from '../harness/agent';

class RecordingInjector extends DynamicInjector {
  override readonly injectionVariant = 'recording_test';
  compactionCalls = 0;
  clearCalls = 0;

  override onContextClear(): void {
    this.clearCalls += 1;
    super.onContextClear();
  }

  override onContextCompacted(compactedCount: number, startIndex = 0): void {
    this.compactionCalls += 1;
    super.onContextCompacted(compactedCount, startIndex);
  }

  setInjectedAt(index: number): void {
    this.injectedAt = index;
  }

  getInjectedAt(): number | null {
    return this.injectedAt;
  }

  protected override getInjection(): string | undefined {
    return undefined;
  }
}

class BoomInjector extends DynamicInjector {
  override readonly injectionVariant = 'boom_test';

  override onContextCompacted(_compactedCount: number): void {
    throw new Error('boom-compact');
  }

  protected override getInjection(): string | undefined {
    return undefined;
  }
}

function installInjectors(manager: InjectionManager, injectors: DynamicInjector[]): void {
  (manager as unknown as { injectors: DynamicInjector[] }).injectors = injectors;
}

describe('InjectionManager.onContextCompacted', () => {
  it('notifies every registered injector when compaction occurs', () => {
    const ctx = testAgent();
    ctx.configure();
    const a = new RecordingInjector(ctx.agent);
    const b = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [a, b]);

    ctx.agent.injection.onContextCompacted(3);

    expect(a.compactionCalls).toBe(1);
    expect(b.compactionCalls).toBe(1);
  });

  it('isolates compaction hook failures so later injectors still receive the notification', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [new BoomInjector(ctx.agent), recorder]);

    expect(() => {
      ctx.agent.injection.onContextCompacted(2);
    }).not.toThrow();
    expect(recorder.compactionCalls).toBe(1);
  });

  it('continues notifying surviving injectors on later compactions', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [new BoomInjector(ctx.agent), recorder]);

    expect(() => {
      ctx.agent.injection.onContextCompacted(1);
    }).not.toThrow();
    expect(recorder.compactionCalls).toBe(1);

    ctx.agent.injection.onContextCompacted(1);
    expect(recorder.compactionCalls).toBe(2);
  });

  it('shifts injection positions after a selected compaction range', () => {
    const ctx = testAgent();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [recorder]);
    recorder.setInjectedAt(6);

    ctx.agent.injection.onContextCompacted(3, 2);

    expect(recorder.getInjectedAt()).toBe(4);
  });

  it('replays context lifecycle records through ContextMemory only once', () => {
    const ctx = testAgent();
    ctx.configure();
    const recorder = new RecordingInjector(ctx.agent);
    installInjectors(ctx.agent.injection, [recorder]);

    ctx.agent.records.restore({ type: 'context.clear' });
    ctx.agent.records.restore({
      type: 'context.append_message',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Prompt one' }],
        toolCalls: [],
      },
    });
    ctx.agent.records.restore({
      type: 'context.append_message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Response one' }],
        toolCalls: [],
      },
    });
    ctx.agent.records.restore({
      type: 'context.apply_compaction',
      summary: 'Compacted summary.',
      compactedCount: 2,
      tokensBefore: 10,
      tokensAfter: 4,
    });

    expect(recorder.clearCalls).toBe(1);
    expect(recorder.compactionCalls).toBe(1);
  });
});

describe('InjectionManager registration', () => {
  it('registers TodoListReminderInjector in the default injector chain', () => {
    const ctx = testAgent();
    ctx.configure();

    const injectors = (ctx.agent.injection as unknown as { injectors: DynamicInjector[] }).injectors;

    expect(injectors.some((injector) => injector instanceof TodoListReminderInjector)).toBe(true);
  });

  it('injects pending LSP diagnostics before the next model step', async () => {
    const ctx = testAgent();
    ctx.configure();
    const drainDiagnostics = vi.fn().mockReturnValue(
      'LSP diagnostics:\n- Error /workspace/src/example.ts:1:1 Unexpected token',
    );
    Object.assign(ctx.agent, { lsp: { drainDiagnostics } });

    await ctx.agent.injection.inject();

    expect(drainDiagnostics).toHaveBeenCalledOnce();
    expect(ctx.agent.context.history.at(-1)).toMatchObject({
      origin: { kind: 'injection', variant: 'lsp_diagnostics' },
      content: [
        {
          type: 'text',
          text: expect.stringContaining('Unexpected token'),
        },
      ],
    });
  });
});
