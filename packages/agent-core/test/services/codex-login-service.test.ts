import { describe, expect, it, vi } from 'vitest';

import type {
  CoreRPC,
  GetPythinkerConfigPayload,
  PythinkerConfig,
  PythinkerConfigPatch,
  SetPythinkerConfigPayload,
} from '../../src';
import {
  CodexLoginFlow,
  CodexLoginNotFoundError,
  pickDefaultModel,
  type CodexLoginDeps,
  type ICoreProcessService,
} from '../../src/services';

const MODELS = [
  { id: 'gpt-5', contextLength: 256_000, supportsReasoning: true, supportsImageIn: true, supportsVideoIn: false },
  { id: 'gpt-5-codex', contextLength: 256_000, supportsReasoning: true, supportsImageIn: true, supportsVideoIn: false },
];

function makeCore(configRef: { current: PythinkerConfig }): {
  core: ICoreProcessService;
  setCalls: PythinkerConfigPatch[];
  removeCalls: string[];
} {
  const setCalls: PythinkerConfigPatch[] = [];
  const removeCalls: string[] = [];
  const rpc: Partial<CoreRPC> = {
    getPythinkerConfig: vi.fn(async (_payload: GetPythinkerConfigPayload) => configRef.current),
    setPythinkerConfig: vi.fn(async (payload: SetPythinkerConfigPayload) => {
      setCalls.push(payload);
      configRef.current = { ...configRef.current, ...(payload as Partial<PythinkerConfig>) };
      return configRef.current;
    }),
    removePythinkerProvider: vi.fn(async ({ providerId }) => {
      removeCalls.push(providerId);
      const providers = { ...configRef.current.providers };
      delete providers[providerId];
      configRef.current = { ...configRef.current, providers };
      return configRef.current;
    }),
  };
  return {
    core: { rpc, ready: Promise.resolve(), dispose: () => {} } as unknown as ICoreProcessService,
    setCalls,
    removeCalls,
  };
}

function makeCallback(loopback: boolean): {
  server: { loopback: boolean; redirectUri: string; waitForCode: () => Promise<null>; cancelWait: () => void; close: () => void };
  closed: () => number;
} {
  let closes = 0;
  return {
    server: {
      loopback,
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCode: async () => null,
      cancelWait: () => {},
      close: () => {
        closes += 1;
      },
    },
    closed: () => closes,
  };
}

function makeDeps(
  overrides: Partial<CodexLoginDeps> = {},
  loopback = false,
): { deps: CodexLoginDeps; callbackClosed: () => number } {
  const callback = makeCallback(loopback);
  const deps: CodexLoginDeps = {
    createPkce: () => ({ verifier: 'v', challenge: 'c', state: 'st' }),
    buildAuthorizeUrl: () => 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=st',
    startCallbackServer: async () => callback.server as never,
    exchangeCode: async () => ({ accessToken: 'ACCESS-TOKEN-SECRET', refreshToken: 'REFRESH-TOKEN-SECRET', accountId: 'acct' }),
    fetchModels: async () => MODELS,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return { deps, callbackClosed: callback.closed };
}

function emptyConfig(): PythinkerConfig {
  return { providers: {} } as PythinkerConfig;
}

describe('CodexLoginFlow', () => {
  it('writes the provider, its aliases, and the thinking effort on success', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls, removeCalls } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    expect(start.authorize_url).toContain('auth.openai.com');
    expect(start.loopback).toBe(false);

    const status = await flow.submitCode(
      start.login_id,
      'http://localhost:1455/auth/callback?code=abc&state=st',
    );
    expect(status.state).toBe('completed');
    expect(status.default_model).toBe('openai-codex/gpt-5-codex');

    // Nothing existed before, so no removal was needed.
    expect(removeCalls).toEqual([]);
    const patch = setCalls.at(-1);
    expect(patch?.providers?.['openai-codex']).toBeDefined();
    // All five fields travel together: the patch is a deep merge, and a missing
    // `thinking` silently drops the effort the apply step just picked.
    expect(Object.keys(patch ?? {}).toSorted()).toEqual([
      'defaultModel',
      'defaultThinking',
      'models',
      'providers',
      'thinking',
    ]);
    expect(patch?.thinking).toBeDefined();
  });

  it('drops a previous codex provider before writing the new one', async () => {
    const configRef = {
      current: {
        providers: { 'openai-codex': { type: 'openai_responses' } },
        models: { 'openai-codex/stale': { provider: 'openai-codex', model: 'stale', maxContextSize: 1 } },
      } as unknown as PythinkerConfig,
    };
    const { core, removeCalls } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    await flow.submitCode(start.login_id, 'http://localhost:1455/auth/callback?code=abc');
    expect(removeCalls).toEqual(['openai-codex']);
  });

  it('never reports a token, only the selected alias', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const status = await flow.submitCode(start.login_id, 'code-only');
    const wire = JSON.stringify({ start, status });
    expect(wire).not.toContain('ACCESS-TOKEN-SECRET');
    expect(wire).not.toContain('REFRESH-TOKEN-SECRET');
    expect(wire).not.toContain('verifier');
  });

  it('refuses a redirect whose state belongs to another attempt', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    await expect(
      flow.submitCode(start.login_id, 'http://localhost:1455/auth/callback?code=abc&state=other'),
    ).rejects.toThrow(/different login/);
  });

  it('fails the attempt when the token exchange fails, and keeps the message', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls } = makeCore(configRef);
    const { deps } = makeDeps({
      exchangeCode: async () => {
        throw new Error('OpenAI Codex token exchange failed (HTTP 400).');
      },
    });
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const status = await flow.submitCode(start.login_id, 'code-only');
    expect(status.state).toBe('failed');
    expect(status.message).toContain('HTTP 400');
    expect(setCalls).toEqual([]);
  });

  it('releases the callback listener when a second login starts', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const { deps, callbackClosed } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const first = await flow.start();
    await flow.start();
    expect(callbackClosed()).toBeGreaterThan(0);
    // The superseded attempt is gone, so its id no longer resolves.
    expect(() => flow.status(first.login_id)).toThrow(CodexLoginNotFoundError);
  });

  it('expires a pending attempt once its window closes', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    let clock = 1_700_000_000_000;
    const { deps } = makeDeps({ now: () => clock });
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    expect(flow.status(start.login_id).state).toBe('pending');
    clock += 11 * 60 * 1000;
    const expired = flow.status(start.login_id);
    expect(expired.state).toBe('failed');
    expect(expired.message).toContain('timed out');
  });

  it('cancels a pending attempt', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    expect(flow.cancel(start.login_id).state).toBe('cancelled');
  });
});

describe('pickDefaultModel', () => {
  it('prefers the codex model over the first entry', () => {
    expect(pickDefaultModel(MODELS).id).toBe('gpt-5-codex');
  });

  it('falls back to the first model when none is a codex model', () => {
    expect(pickDefaultModel([MODELS[0]!]).id).toBe('gpt-5');
  });
});
