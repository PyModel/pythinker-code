import { afterEach, describe, expect, it } from 'vitest';

import { emptyUsage } from '#/kosong/contract/usage';
import { IEventBus } from '#/app/event/eventBus';
import { DEFAULT_AGENT_PROFILE_NAME } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { IAgentProfileService } from '#/agent/profile/profile';
import { WarningIssued } from '#/agent/profile/profileOps';

import { recordingTelemetry, type TelemetryRecord } from '../../app/telemetry/stubs';
import {
  createTestAgent,
  llmGenerateServices,
  telemetryServices,
  type TestAgentContext,
} from '../../harness';

import {
  defaultThinkingEffortForModel,
  modelSupportsThinkingEffort,
  resolveForcedThinkingEffort,
  resolveThinkingEffortForModel,
} from '#/kosong/model/thinking';

const booleanModel = { capabilities: ['thinking'] };
const effortModel = {
  capabilities: ['thinking'],
  supportEfforts: ['low', 'medium', 'high'],
};
const effortModelWithDefault = {
  capabilities: ['thinking'],
  supportEfforts: ['low', 'high', 'max'],
  defaultEffort: 'max',
};
const alwaysThinkingModel = {
  capabilities: ['thinking', 'always_thinking'],
  alwaysThinking: true,
  protocol: 'openai',
  providerType: 'pythinker',
};
const alwaysThinkingEffortModel = {
  capabilities: ['thinking', 'always_thinking'],
  alwaysThinking: true,
  protocol: 'openai',
  providerType: 'pythinker',
  supportEfforts: ['low', 'high', 'max'],
  defaultEffort: 'high',
};
const nonThinkingModel = { capabilities: ['tool_use'] };
const alwaysThinkingAnthropicEffortModel = {
  ...alwaysThinkingEffortModel,
  protocol: 'anthropic',
  providerType: 'pythinker',
};
const pythinkerEffortModel = { ...effortModel, protocol: 'openai', providerType: 'pythinker' };
const pythinkerBooleanModel = { ...booleanModel, protocol: 'openai', providerType: 'pythinker' };
const openaiEffortModel = { ...effortModel, providerType: 'openai' };

describe('defaultThinkingEffortForModel', () => {
  it('returns off for models that do not support thinking (or an unknown model)', () => {
    expect(defaultThinkingEffortForModel(undefined)).toBe('off');
    expect(defaultThinkingEffortForModel(nonThinkingModel)).toBe('off');
    expect(defaultThinkingEffortForModel({})).toBe('off');
  });

  it('returns the declared defaultEffort for effort-capable models', () => {
    expect(defaultThinkingEffortForModel(effortModelWithDefault)).toBe('max');
  });

  it('ignores a defaultEffort that is not declared in supportEfforts', () => {
    expect(
      defaultThinkingEffortForModel({
        capabilities: ['thinking'],
        supportEfforts: ['low', 'high'],
        defaultEffort: 'max',
      }),
    ).toBe('high');
  });

  it('falls back to the middle supportEfforts entry when defaultEffort is absent', () => {
    expect(defaultThinkingEffortForModel(effortModel)).toBe('medium');
    expect(
      defaultThinkingEffortForModel({
        capabilities: ['thinking'],
        supportEfforts: ['low', 'high'],
      }),
    ).toBe('high');
    expect(
      defaultThinkingEffortForModel({ capabilities: ['thinking'], supportEfforts: ['low'] }),
    ).toBe('low');
  });

  it('returns on for boolean thinking models (thinking support without supportEfforts)', () => {
    expect(defaultThinkingEffortForModel(booleanModel)).toBe('on');
    expect(defaultThinkingEffortForModel({ capabilities: ['always_thinking'] })).toBe('on');
    expect(defaultThinkingEffortForModel({ adaptiveThinking: true })).toBe('on');
  });
});

describe('resolveThinkingEffortForModel', () => {
  it('returns the requested effort verbatim when one is provided', () => {
    expect(resolveThinkingEffortForModel('low', undefined, effortModel)).toBe('low');
    expect(resolveThinkingEffortForModel('on', { enabled: false }, booleanModel)).toBe('on');
    expect(resolveThinkingEffortForModel('off', undefined, booleanModel)).toBe('off');
    expect(resolveThinkingEffortForModel('on', { effort: 'medium' }, effortModel)).toBe('medium');
  });

  it('returns off when config.enabled is false and no effort is requested', () => {
    expect(resolveThinkingEffortForModel(undefined, { enabled: false }, effortModel)).toBe('off');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false, effort: 'high' }, effortModel),
    ).toBe('off');
  });

  it('uses config.effort as the default effort', () => {
    expect(resolveThinkingEffortForModel(undefined, { effort: 'high' }, effortModel)).toBe('high');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: true, effort: 'low' }, effortModel),
    ).toBe('low');
  });

  it('falls back to defaultThinkingEffortForModel(model) when no effort is configured', () => {
    expect(resolveThinkingEffortForModel(undefined, undefined, effortModel)).toBe('medium');
    expect(resolveThinkingEffortForModel(undefined, {}, booleanModel)).toBe('on');
    expect(resolveThinkingEffortForModel(undefined, undefined, undefined)).toBe('off');
  });

  it('forces always-thinking models back on when the resolved effort is off', () => {
    expect(resolveThinkingEffortForModel('off', undefined, alwaysThinkingModel, true)).toBe('on');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false }, alwaysThinkingModel, true),
    ).toBe('on');
  });

  it('honors a configured effort when clamping always-thinking models back on', () => {
    expect(
      resolveThinkingEffortForModel(
        undefined,
        { enabled: false, effort: 'max' },
        alwaysThinkingEffortModel,
        true,
      ),
    ).toBe('max');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false }, alwaysThinkingEffortModel, true),
    ).toBe('high');
  });

  it('does not force on for models that are not always-thinking', () => {
    expect(resolveThinkingEffortForModel('off', undefined, booleanModel)).toBe('off');
    expect(resolveThinkingEffortForModel(undefined, { enabled: false }, booleanModel)).toBe('off');
  });

  it('clamps always-thinking models to their default effort even without strict validation', () => {
    expect(
      resolveThinkingEffortForModel('off', undefined, alwaysThinkingAnthropicEffortModel),
    ).toBe('high');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false }, alwaysThinkingAnthropicEffortModel),
    ).toBe('high');
    expect(resolveThinkingEffortForModel('off', undefined, alwaysThinkingModel)).toBe('on');
  });

  it('normalizes a configured off value (case/whitespace) instead of sending it upstream', () => {
    expect(resolveThinkingEffortForModel(undefined, { effort: ' OFF ' }, effortModel)).toBe('off');
    expect(resolveThinkingEffortForModel(undefined, { effort: 'Off' }, booleanModel)).toBe('off');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false, effort: ' OFF ' }, alwaysThinkingEffortModel),
    ).toBe('high');
  });

  it('normalizes the env-forced effort (case/whitespace)', () => {
    expect(resolveForcedThinkingEffort(' MAX ', 'high', true)).toBe('max');
    expect(resolveForcedThinkingEffort('   ', 'high', true)).toBeUndefined();
  });

  it('treats a configured off as absent when clamping always-thinking models', () => {
    expect(resolveThinkingEffortForModel(undefined, { effort: 'off' }, alwaysThinkingEffortModel)).toBe(
      'high',
    );
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false, effort: 'off' }, alwaysThinkingEffortModel),
    ).toBe('high');
    expect(
      resolveThinkingEffortForModel(undefined, { enabled: false, effort: 'max' }, alwaysThinkingEffortModel),
    ).toBe('max');
  });

  it('carries custom requested efforts through', () => {
    expect(resolveThinkingEffortForModel('xhigh', undefined, undefined)).toBe('xhigh');
    expect(resolveThinkingEffortForModel('bogus', { effort: 'low' }, undefined)).toBe('bogus');
  });

  it('normalizes requested effort case and whitespace', () => {
    expect(resolveThinkingEffortForModel('  Medium ', undefined, undefined)).toBe('medium');
    expect(resolveThinkingEffortForModel('OFF', { effort: 'high' }, undefined)).toBe('off');
  });

  it('falls back to the model default for an unsupported Pythinker effort', () => {
    expect(resolveThinkingEffortForModel('ultra', undefined, pythinkerEffortModel, true)).toBe(
      'medium',
    );
  });

  it('projects a concrete effort to on for a boolean-only Pythinker model', () => {
    expect(resolveThinkingEffortForModel('ultra', undefined, pythinkerBooleanModel, true)).toBe('on');
  });

  it('reports unsupported concrete efforts only for Pythinker effort models', () => {
    expect(modelSupportsThinkingEffort('ultra', pythinkerEffortModel, true)).toBe(false);
    expect(modelSupportsThinkingEffort('ultra', openaiEffortModel, false)).toBe(true);
  });
});

describe('setModel thinking clamp (engine policy)', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    try {
      await ctx.expectResumeMatches();
    } finally {
      await ctx.dispose();
    }
  });

  function okGenerate() {
    return async () => ({
      id: 'clamp-1',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'ok' }],
        toolCalls: [],
      },
      usage: emptyUsage(),
      finishReason: 'completed' as const,
      rawFinishReason: 'stop',
    });
  }

  it('clamps the persisted effort and notifies when switching to a model that lacks it', async () => {
    const notices: WarningIssued[] = [];
    const records: TelemetryRecord[] = [];
    ctx = createTestAgent(
      llmGenerateServices(okGenerate()),
      telemetryServices(recordingTelemetry(records)),
      {
        initialConfig: {
          models: {
            'max-model': {
              provider: 'test-provider',
              model: 'max-model',
              maxContextSize: 100_000,
              capabilities: ['thinking', 'tool_use'],
              supportEfforts: ['low', 'max'],
              defaultEffort: 'max',
            },
            'mid-model': {
              provider: 'test-provider',
              model: 'mid-model',
              maxContextSize: 100_000,
              capabilities: ['thinking', 'tool_use'],
              supportEfforts: ['low', 'high'],
              defaultEffort: 'low',
            },
          },
        },
      },
    );
    ctx.get(IEventBus).subscribe(WarningIssued, (event) => notices.push(event));
    const profile = ctx.get(IAgentProfileService);
    await profile.bind({ profile: DEFAULT_AGENT_PROFILE_NAME, model: 'max-model' });
    profile.setThinking('max');
    expect(profile.data().thinkingLevel).toBe('max');

    await profile.setModel('mid-model');

    expect(profile.data().thinkingLevel).toBe('low');
    const clampNotices = notices.filter((notice) => notice.code === 'thinking-effort-clamped');
    expect(clampNotices).toHaveLength(1);
    expect(clampNotices[0]?.message).toContain('"max"');
    expect(clampNotices[0]?.message).toContain('"low"');
    expect(
      records.some(
        (record) =>
          record.event === 'thinking_toggle' &&
          (record.properties as { effort?: string } | undefined)?.effort === 'low',
      ),
    ).toBe(true);
  });
});
