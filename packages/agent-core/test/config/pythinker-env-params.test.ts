import { type ChatProvider, PythinkerChatProvider } from '@pymodel/kosong';
import { AnthropicChatProvider } from '@pymodel/kosong/providers/anthropic';
import { describe, expect, it } from 'vitest';

import {
  applyAnthropicThinkingKeep,
  applyPythinkerEnvSamplingParams,
  applyPythinkerEnvThinkingKeep,
  resolvePythinkerEnvThinkingEffort,
} from '../../src/config/pythinker-env-params';
import { PythinkerError } from '../../src/errors';

function pythinker(): PythinkerChatProvider {
  return new PythinkerChatProvider({ model: 'pythinker-k2', apiKey: 'k' });
}

interface PythinkerGenerationState {
  temperature?: number;
  top_p?: number;
  extra_body?: { thinking?: { type?: string; effort?: string; keep?: unknown } };
}

function genState(provider: ChatProvider): PythinkerGenerationState {
  return Reflect.get(provider as object, '_generationKwargs') as PythinkerGenerationState;
}

function expectConfigInvalid(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PythinkerError);
  expect((thrown as PythinkerError).code).toBe('config.invalid');
}

describe('applyPythinkerEnvSamplingParams', () => {
  it('returns the same provider when no env vars are set', () => {
    const provider = pythinker();
    expect(applyPythinkerEnvSamplingParams(provider, {})).toBe(provider);
  });

  it('injects temperature and top_p for a pythinker provider', () => {
    const out = applyPythinkerEnvSamplingParams(pythinker(), {
      PYTHINKER_MODEL_TEMPERATURE: '0.3',
      PYTHINKER_MODEL_TOP_P: '0.95',
    });
    const state = genState(out);
    expect(state.temperature).toBe(0.3);
    expect(state.top_p).toBe(0.95);
  });

  it('leaves non-pythinker providers untouched', () => {
    const stub = { name: 'stub' } as unknown as ChatProvider;
    expect(applyPythinkerEnvSamplingParams(stub, { PYTHINKER_MODEL_TEMPERATURE: '0.3' })).toBe(stub);
  });

  it('throws config.invalid for an invalid temperature', () => {
    expect.hasAssertions();
    expectConfigInvalid(() =>
      applyPythinkerEnvSamplingParams(pythinker(), { PYTHINKER_MODEL_TEMPERATURE: 'abc' }),
    );
  });
});

describe('applyPythinkerEnvThinkingKeep', () => {
  it('injects thinking.keep="all" by default when thinking is on', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', {});
    expect(genState(out).extra_body?.thinking?.keep).toBe('all');
  });

  it('injects thinking.keep from env when thinking is on', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(genState(out).extra_body?.thinking?.keep).toBe('all');
  });

  it('injects thinking.keep from config when env is unset', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', {}, 'all');
    expect(genState(out).extra_body?.thinking?.keep).toBe('all');
  });

  it('env takes precedence over config', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' }, 'off');
    expect(genState(out).extra_body?.thinking?.keep).toBe('all');
  });

  it.each(['off', 'false', '0', 'no', 'none', 'null', 'OFF', 'None'])(
    'env off-value %s disables keep even when config enables it',
    (off) => {
      const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: off }, 'all');
      expect(genState(out).extra_body).toBeUndefined();
    },
  );

  it.each(['off', 'none', 'null'])('config off-value %s disables keep by default', (off) => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', {}, off);
    expect(genState(out).extra_body).toBeUndefined();
  });

  it('blank env falls through to config', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: '  ' }, 'off');
    expect(genState(out).extra_body).toBeUndefined();
  });

  it('does NOT inject thinking.keep when thinking is off', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'off', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(genState(out).extra_body).toBeUndefined();
  });

  it('leaves non-pythinker providers untouched', () => {
    const stub = { name: 'stub' } as unknown as ChatProvider;
    expect(applyPythinkerEnvThinkingKeep(stub, 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' })).toBe(stub);
  });
});

describe('resolvePythinkerEnvThinkingEffort', () => {
  it('returns the trimmed force override for an enabled Pythinker model', () => {
    expect(
      resolvePythinkerEnvThinkingEffort('high', true, {
        PYTHINKER_MODEL_THINKING_EFFORT: ' max ',
      }),
    ).toBe('max');
  });

  it('lowercases the force override', () => {
    expect(
      resolvePythinkerEnvThinkingEffort('high', true, {
        PYTHINKER_MODEL_THINKING_EFFORT: ' MAX ',
      }),
    ).toBe('max');
  });

  it('does not override an explicit off effort', () => {
    expect(
      resolvePythinkerEnvThinkingEffort('off', true, {
        PYTHINKER_MODEL_THINKING_EFFORT: 'max',
      }),
    ).toBeUndefined();
  });

  it('ignores an unset or blank force override', () => {
    expect(resolvePythinkerEnvThinkingEffort('high', true, {})).toBeUndefined();
    expect(
      resolvePythinkerEnvThinkingEffort('high', true, {
        PYTHINKER_MODEL_THINKING_EFFORT: '  ',
      }),
    ).toBeUndefined();
  });

  it('does not apply the Pythinker force override to another provider', () => {
    expect(
      resolvePythinkerEnvThinkingEffort('high', false, {
        PYTHINKER_MODEL_THINKING_EFFORT: 'max',
      }),
    ).toBeUndefined();
  });
});

function anthropic(): AnthropicChatProvider {
  return new AnthropicChatProvider({ model: 'claude-sonnet-4-6', apiKey: 'k' });
}

interface AnthropicKeepState {
  contextManagement?: { edits: Array<{ type: string; keep?: string }> };
  betaFeatures?: string[];
}

function anthropicState(provider: ChatProvider): AnthropicKeepState {
  return Reflect.get(provider as object, '_generationKwargs') as AnthropicKeepState;
}

describe('applyAnthropicThinkingKeep', () => {
  it('injects context_management keep="all" by default when thinking is on', () => {
    const out = applyAnthropicThinkingKeep(anthropic(), 'high', {});
    expect(anthropicState(out).contextManagement).toEqual({
      edits: [{ type: 'clear_thinking_20251015', keep: 'all' }],
    });
    expect(anthropicState(out).betaFeatures).toContain('context-management-2025-06-27');
  });

  it('injects keep from env when thinking is on', () => {
    const out = applyAnthropicThinkingKeep(anthropic(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(anthropicState(out).contextManagement?.edits[0]?.keep).toBe('all');
  });

  it('injects keep from config when env is unset', () => {
    const out = applyAnthropicThinkingKeep(anthropic(), 'high', {}, 'all');
    expect(anthropicState(out).contextManagement?.edits[0]?.keep).toBe('all');
  });

  it('env takes precedence over config', () => {
    const out = applyAnthropicThinkingKeep(
      anthropic(),
      'high',
      { PYTHINKER_MODEL_THINKING_KEEP: 'all' },
      'off',
    );
    expect(anthropicState(out).contextManagement?.edits[0]?.keep).toBe('all');
  });

  it.each(['off', 'false', '0', 'no', 'none', 'null', 'OFF', 'None'])(
    'env off-value %s disables keep even when config enables it',
    (off) => {
      const out = applyAnthropicThinkingKeep(
        anthropic(),
        'high',
        { PYTHINKER_MODEL_THINKING_KEEP: off },
        'all',
      );
      expect(anthropicState(out).contextManagement).toBeUndefined();
    },
  );

  it.each(['off', 'none', 'null'])('config off-value %s disables keep by default', (off) => {
    const out = applyAnthropicThinkingKeep(anthropic(), 'high', {}, off);
    expect(anthropicState(out).contextManagement).toBeUndefined();
  });

  it('blank env falls through to config', () => {
    const out = applyAnthropicThinkingKeep(
      anthropic(),
      'high',
      { PYTHINKER_MODEL_THINKING_KEEP: '  ' },
      'off',
    );
    expect(anthropicState(out).contextManagement).toBeUndefined();
  });

  it('does NOT inject context_management when thinking is off', () => {
    const out = applyAnthropicThinkingKeep(anthropic(), 'off', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(anthropicState(out).contextManagement).toBeUndefined();
  });

  it('does not duplicate the context-management beta on repeated calls', () => {
    const out = applyAnthropicThinkingKeep(
      applyAnthropicThinkingKeep(anthropic(), 'high', {}),
      'high',
      {},
    );
    const betas = anthropicState(out).betaFeatures ?? [];
    expect(betas.filter((b) => b === 'context-management-2025-06-27')).toHaveLength(1);
  });

  it('leaves non-anthropic providers untouched', () => {
    const stub = { name: 'stub' } as unknown as ChatProvider;
    expect(applyAnthropicThinkingKeep(stub, 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' })).toBe(stub);
  });
});
