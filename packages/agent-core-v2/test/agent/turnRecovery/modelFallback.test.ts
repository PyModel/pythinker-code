import { afterEach, describe, expect, it } from 'vitest';

import { emptyUsage } from '#/kosong/contract/usage';
import { IEventBus } from '#/app/event/eventBus';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IModelService } from '#/kosong/model/model';
import { IAgentLoopService } from '#/agent/loop/loop';
import { ContinuationStepRequest } from '#/agent/loop/stepRequest';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { IAgentProfileService } from '#/agent/profile/profile';
import { ModelFallbackSwitched, WarningIssued } from '#/agent/profile/profileOps';

import { recordingTelemetry, type TelemetryRecord } from '../../app/telemetry/stubs';
import {
  createTestAgent,
  llmGenerateServices,
  telemetryServices,
  type TestAgentContext,
} from '../../harness';

function okGenerate() {
  let calls = 0;
  return {
    generate: async () => {
      calls += 1;
      return {
        id: `mf-${String(calls)}`,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'ok' }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      };
    },
    calls: () => calls,
  };
}

describe('read-time default-model policy', () => {
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

  it('re-resolves a dead bound model to the ranked default at turn bind and completes', async () => {
    const generate = okGenerate();
    const switched: ModelFallbackSwitched[] = [];
    const notices: WarningIssued[] = [];
    const records: TelemetryRecord[] = [];
    ctx = createTestAgent(
      llmGenerateServices(generate.generate),
      telemetryServices(recordingTelemetry(records)),
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));
    ctx.get(IEventBus).subscribe(WarningIssued, (event) => notices.push(event));
    ctx.get(IAgentProfileService).update({ modelAlias: 'dead-model' });

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(generate.calls()).toBe(1);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({
      turnId: 1,
      fromModel: 'dead-model',
      toModel: 'mock-model',
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.code).toBe('model-fallback');
    expect(notices[0]?.message).toContain('dead-model');
    expect(notices[0]?.message).toContain('mock-model');
    const fallbackEvents = records.filter(
      (record) => record.event === 'model_fallback_triggered',
    );
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]?.properties).toMatchObject({
      turn_id: 1,
      from_model: 'dead-model',
      to_model: 'mock-model',
    });
  });

  it('re-resolves a model whose provider was deleted to the ranked default', async () => {
    const generate = okGenerate();
    const switched: ModelFallbackSwitched[] = [];
    ctx = createTestAgent(
      llmGenerateServices(generate.generate),
      {
        initialConfig: {
          models: {
            'orphan-model': {
              provider: 'no-such-provider',
              model: 'orphan',
              maxContextSize: 1_000,
            },
          },
        },
      },
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));
    ctx.get(IAgentProfileService).update({ modelAlias: 'orphan-model' });

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({ fromModel: 'orphan-model', toModel: 'mock-model' });
  });

  it('skips an unready candidate that would win the ranking at turn bind', async () => {
    const generate = okGenerate();
    const switched: ModelFallbackSwitched[] = [];
    ctx = createTestAgent(
      llmGenerateServices(generate.generate),
      {
        initialConfig: {
          models: {
            'zombie-model': {
              provider: 'no-such-provider',
              model: 'zombie',
              maxContextSize: 100_000_000,
            },
          },
        },
      },
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));
    ctx.get(IAgentProfileService).update({ modelAlias: 'dead-model' });

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({ fromModel: 'dead-model', toModel: 'mock-model' });
  });

  it('keeps the dead alias without switching when no candidate is ready', async () => {
    const generate = okGenerate();
    const switched: ModelFallbackSwitched[] = [];
    ctx = createTestAgent(
      llmGenerateServices(generate.generate),
      {
        initialConfig: {
          models: {
            'aaa-model': {
              provider: 'no-such-provider',
              model: 'aaa',
              maxContextSize: 5_000,
            },
            'orphan-model': {
              provider: 'no-such-provider',
              model: 'orphan',
              maxContextSize: 1_000,
            },
          },
        },
      },
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));
    await ctx.get(IModelService).delete('mock-model');
    ctx.get(IAgentProfileService).update({ modelAlias: 'orphan-model' });

    await runTurn(1);

    expect(ctx.get(IAgentProfileService).getModel()).toBe('orphan-model');
    expect(switched).toHaveLength(0);
  });

  it('leaves a healthy bound model untouched and emits nothing', async () => {
    const generate = okGenerate();
    const switched: ModelFallbackSwitched[] = [];
    const records: TelemetryRecord[] = [];
    ctx = createTestAgent(
      llmGenerateServices(generate.generate),
      telemetryServices(recordingTelemetry(records)),
    );
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));

    const result = await runTurn(1);

    expect(result.type).toBe('completed');
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(0);
    expect(records.filter((record) => record.event === 'model_fallback_triggered')).toHaveLength(0);
  });
});
