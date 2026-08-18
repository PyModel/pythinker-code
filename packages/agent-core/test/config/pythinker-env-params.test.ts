import { type ChatProvider, PythinkerChatProvider } from '@pymodel/kosong';
import { describe, expect, it } from 'vitest';

import { applyPythinkerEnvSamplingParams, applyPythinkerEnvThinkingKeep } from '../../src/config/pythinker-env-params';
import { PythinkerError } from '../../src/errors';

function pythinker(): PythinkerChatProvider {
  return new PythinkerChatProvider({ model: 'kimi-k2', apiKey: 'k' });
}

interface PythinkerGenerationState {
  temperature?: number;
  top_p?: number;
  extra_body?: { thinking?: { keep?: unknown } };
}

function genState(provider: ChatProvider): PythinkerGenerationState {
  return Reflect.get(provider as object, '_generationKwargs') as PythinkerGenerationState;
}

function expectConfigInvalid(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PythinkerError);
    expect((error as PythinkerError).code).toBe('config.invalid');
    return;
  }
  throw new Error('expected function to throw');
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
    expectConfigInvalid(() =>
      applyPythinkerEnvSamplingParams(pythinker(), { PYTHINKER_MODEL_TEMPERATURE: 'abc' }),
    );
  });
});

describe('applyPythinkerEnvThinkingKeep', () => {
  it('injects thinking.keep when thinking is on', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(genState(out).extra_body?.thinking?.keep).toBe('all');
  });

  it('does NOT inject thinking.keep when thinking is off', () => {
    const out = applyPythinkerEnvThinkingKeep(pythinker(), 'off', { PYTHINKER_MODEL_THINKING_KEEP: 'all' });
    expect(genState(out).extra_body).toBeUndefined();
  });

  it('returns the same provider when keep is unset', () => {
    const provider = pythinker();
    expect(applyPythinkerEnvThinkingKeep(provider, 'high', {})).toBe(provider);
  });

  it('leaves non-pythinker providers untouched', () => {
    const stub = { name: 'stub' } as unknown as ChatProvider;
    expect(applyPythinkerEnvThinkingKeep(stub, 'high', { PYTHINKER_MODEL_THINKING_KEEP: 'all' })).toBe(stub);
  });
});
