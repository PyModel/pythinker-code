import { emptyUsage } from '#human/llm/usage';
import { afterEach, describe, expect, it } from 'vitest';

import { IEventBus } from '#/app/event/eventBus';
import { IModelService } from '#/llm-adapter/model/model';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentProfileService } from '#/agent/profile/profile';
import { ModelFallbackSwitched, WarningIssued } from '#/agent/profile/profileOps';

import { recordingTelemetry, type TelemetryRecord } from '../../app/telemetry/stubs';
import {
  createTestAgent,
  llmGenerateServices,
  requesterFromGenerateFn,
  telemetryServices,
  type TestAgentContext,
} from '../../harness';

function okGenerate() {
  let calls = 0;
  return {
    services: llmGenerateServices(
      requesterFromGenerateFn(async () => {
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
      }),
    ),
    calls: () => calls,
  };
}

describe('turn-start model fallback', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  function requestTurn(turnId: number): Promise<unknown> {
    return ctx.get(IAgentLLMRequesterService).request({ source: { type: 'turn', turnId, step: 1 } });
  }

  function captureSwitches(): ModelFallbackSwitched[] {
    const switched: ModelFallbackSwitched[] = [];
    ctx.get(IEventBus).subscribe(ModelFallbackSwitched, (event) => switched.push(event));
    return switched;
  }

  it('switches a dead bound model to the best-ranked ready model', async () => {
    const generate = okGenerate();
    const records: TelemetryRecord[] = [];
    ctx = createTestAgent(generate.services, telemetryServices(recordingTelemetry(records)));
    const switched = captureSwitches();
    const notices: WarningIssued[] = [];
    ctx.get(IEventBus).subscribe(WarningIssued, (event) => notices.push(event));
    ctx.get(IAgentProfileService).update({ modelAlias: 'dead-model' });

    await requestTurn(1);

    expect(generate.calls()).toBe(1);
    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({ turnId: 1, fromModel: 'dead-model', toModel: 'mock-model' });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.code).toBe('model-fallback');
    expect(notices[0]?.message).toContain('dead-model');
    expect(notices[0]?.message).toContain('mock-model');
    const fallbackEvents = records.filter((record) => record.event === 'model_fallback_triggered');
    expect(fallbackEvents).toHaveLength(1);
    expect(fallbackEvents[0]?.properties).toMatchObject({
      turn_id: 1,
      from_model: 'dead-model',
      to_model: 'mock-model',
    });
  });

  it('switches a model whose provider was deleted', async () => {
    ctx = createTestAgent(okGenerate().services, {
      initialConfig: {
        models: {
          'orphan-model': { provider: 'no-such-provider', model: 'orphan', maxContextSize: 1_000 },
        },
      },
    });
    const switched = captureSwitches();
    ctx.get(IAgentProfileService).update({ modelAlias: 'orphan-model' });

    await requestTurn(1);

    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({ fromModel: 'orphan-model', toModel: 'mock-model' });
  });

  it('skips an unready candidate that would win the ranking', async () => {
    ctx = createTestAgent(okGenerate().services, {
      initialConfig: {
        models: {
          'zombie-model': { provider: 'no-such-provider', model: 'zombie', maxContextSize: 100_000_000 },
        },
      },
    });
    const switched = captureSwitches();
    ctx.get(IAgentProfileService).update({ modelAlias: 'dead-model' });

    await requestTurn(1);

    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(1);
    expect(switched[0]).toMatchObject({ fromModel: 'dead-model', toModel: 'mock-model' });
  });

  it('keeps the dead alias when no candidate is ready', async () => {
    ctx = createTestAgent(okGenerate().services, {
      initialConfig: {
        models: {
          'aaa-model': { provider: 'no-such-provider', model: 'aaa', maxContextSize: 5_000 },
          'orphan-model': { provider: 'no-such-provider', model: 'orphan', maxContextSize: 1_000 },
        },
      },
    });
    const switched = captureSwitches();
    await ctx.get(IModelService).delete('mock-model');
    ctx.get(IAgentProfileService).update({ modelAlias: 'orphan-model' });

    await requestTurn(1).catch(() => undefined);

    expect(ctx.get(IAgentProfileService).getModel()).toBe('orphan-model');
    expect(switched).toHaveLength(0);
  });

  it('leaves a healthy bound model untouched', async () => {
    const records: TelemetryRecord[] = [];
    ctx = createTestAgent(okGenerate().services, telemetryServices(recordingTelemetry(records)));
    const switched = captureSwitches();

    await requestTurn(1);

    expect(ctx.get(IAgentProfileService).getModel()).toBe('mock-model');
    expect(switched).toHaveLength(0);
    expect(records.filter((record) => record.event === 'model_fallback_triggered')).toHaveLength(0);
  });
});
