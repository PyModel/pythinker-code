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

function makeCore(configRef: { current: PythinkerConfig }) {
  const setCalls: PythinkerConfigPatch[] = [];
  const removeCalls: string[] = [];
  const setPythinkerConfig = vi.fn(async (payload: SetPythinkerConfigPayload) => {
    setCalls.push(payload);
    configRef.current = { ...configRef.current, ...(payload as Partial<PythinkerConfig>) };
    return configRef.current;
  });
  const rpc: Partial<CoreRPC> = {
    getPythinkerConfig: vi.fn(async (_payload: GetPythinkerConfigPayload) => configRef.current),
    setPythinkerConfig,
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
    setPythinkerConfig,
  };
}

type CallbackResult = { readonly code: string } | null;

function makeCallback(
  loopback: boolean,
  waitForCode: () => Promise<CallbackResult> = async () => null,
  onWaitCancel: () => void = () => {},
): {
  server: {
    loopback: boolean;
    redirectUri: string;
    waitForCode: () => Promise<CallbackResult>;
    cancelWait: () => void;
    close: () => void;
  };
  closed: () => number;
  waitCancelled: () => number;
} {
  let closes = 0;
  let waitCancellations = 0;
  return {
    server: {
      loopback,
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCode,
      cancelWait: () => {
        waitCancellations += 1;
        onWaitCancel();
      },
      close: () => {
        closes += 1;
      },
    },
    closed: () => closes,
    waitCancelled: () => waitCancellations,
  };
}

function makeDeps(
  overrides: Partial<CodexLoginDeps> = {},
  loopback = false,
  waitForCode: () => Promise<CallbackResult> = async () => null,
  onWaitCancel: () => void = () => {},
): { deps: CodexLoginDeps; callbackClosed: () => number; waitCancelled: () => number } {
  const callback = makeCallback(loopback, waitForCode, onWaitCancel);
  const deps: CodexLoginDeps = {
    createPkce: () => ({ verifier: 'v', challenge: 'c', state: 'st' }),
    buildAuthorizeUrl: () => 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=st',
    startCallbackServer: async () => callback.server as never,
    exchangeCode: async () => ({ accessToken: 'ACCESS-TOKEN-SECRET', refreshToken: 'REFRESH-TOKEN-SECRET', accountId: 'acct' }),
    fetchModels: async () => MODELS,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return {
    deps,
    callbackClosed: callback.closed,
    waitCancelled: callback.waitCancelled,
  };
}

function emptyConfig(): PythinkerConfig {
  return { providers: {} } as PythinkerConfig;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    expect(Object.keys(patch!).toSorted()).toEqual([
      'defaultModel',
      'defaultThinking',
      'models',
      'providers',
      'thinking',
    ]);
    expect(patch?.thinking).toBeDefined();
  });

  it('replaces previous codex config in one non-destructive write', async () => {
    const configRef = {
      current: {
        providers: { 'openai-codex': { type: 'openai_responses' } },
        models: { 'openai-codex/stale': { provider: 'openai-codex', model: 'stale', maxContextSize: 1 } },
      } as unknown as PythinkerConfig,
    };
    const { core, removeCalls, setCalls } = makeCore(configRef);
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    await flow.submitCode(start.login_id, 'http://localhost:1455/auth/callback?code=abc');

    expect(removeCalls).toEqual([]);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.models?.['openai-codex/stale']).toBeUndefined();
    expect(setCalls[0]?.models?.['openai-codex/gpt-5-codex']).toBeDefined();
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
    ).rejects.toThrow(/different login/u);
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

  it('keeps the old config when the replacement write fails', async () => {
    const configRef = {
      current: {
        providers: { 'openai-codex': { type: 'openai_responses', apiKey: 'OLD-TOKEN' } },
        models: { 'openai-codex/stale': { provider: 'openai-codex', model: 'stale', maxContextSize: 1 } },
        defaultModel: 'openai-codex/stale',
      } as unknown as PythinkerConfig,
    };
    const before = structuredClone(configRef.current);
    const { core, removeCalls, setPythinkerConfig } = makeCore(configRef);
    setPythinkerConfig.mockRejectedValueOnce(new Error('config write failed'));
    const { deps } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const status = await flow.submitCode(start.login_id, 'code-only');

    expect(status.state).toBe('failed');
    expect(status.message).toContain('config write failed');
    expect(removeCalls).toEqual([]);
    expect(configRef.current).toEqual(before);
  });

  it('serializes duplicate completion submissions', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls } = makeCore(configRef);
    const exchange = deferred<{
      accessToken: string;
      refreshToken: string;
      accountId: string;
    }>();
    let exchangeCalls = 0;
    const { deps } = makeDeps({
      exchangeCode: async () => {
        exchangeCalls += 1;
        return exchange.promise;
      },
    });
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const first = flow.submitCode(start.login_id, 'code-a');
    const second = flow.submitCode(start.login_id, 'code-b');
    expect(exchangeCalls).toBe(1);

    exchange.resolve({
      accessToken: 'ACCESS-TOKEN-SECRET',
      refreshToken: 'REFRESH-TOKEN-SECRET',
      accountId: 'acct',
    });
    const statuses = await Promise.all([first, second]);
    expect(statuses.map((status) => status.state)).toEqual(['completed', 'completed']);
    expect(setCalls).toHaveLength(1);
  });

  it('does not write config after cancellation during token exchange', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls } = makeCore(configRef);
    const exchange = deferred<{
      accessToken: string;
      refreshToken: string;
      accountId: string;
    }>();
    const { deps } = makeDeps({ exchangeCode: async () => exchange.promise });
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const submission = flow.submitCode(start.login_id, 'code-only');
    expect(flow.cancel(start.login_id).state).toBe('cancelled');
    exchange.resolve({
      accessToken: 'ACCESS-TOKEN-SECRET',
      refreshToken: 'REFRESH-TOKEN-SECRET',
      accountId: 'acct',
    });

    await expect(submission).resolves.toMatchObject({ state: 'cancelled' });
    expect(setCalls).toEqual([]);
  });

  it('does not write config after supersession during model fetch', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls } = makeCore(configRef);
    const exchange = deferred<{
      accessToken: string;
      refreshToken: string;
      accountId: string;
    }>();
    const models = deferred<typeof MODELS>();
    let fetchCalls = 0;
    const { deps } = makeDeps({
      exchangeCode: async () => exchange.promise,
      fetchModels: async () => {
        fetchCalls += 1;
        return models.promise;
      },
    });
    const flow = new CodexLoginFlow(core, deps);

    const first = await flow.start();
    const submission = flow.submitCode(first.login_id, 'code-only');
    exchange.resolve({
      accessToken: 'ACCESS-TOKEN-SECRET',
      refreshToken: 'REFRESH-TOKEN-SECRET',
      accountId: 'acct',
    });
    await vi.waitFor(() => { expect(fetchCalls).toBe(1); });

    const second = await flow.start();
    models.resolve(MODELS);
    await expect(submission).resolves.toMatchObject({ state: 'cancelled' });
    expect(setCalls).toEqual([]);
    flow.cancel(second.login_id);
  });

  it('releases the callback listener when a second login starts', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const { deps, callbackClosed, waitCancelled } = makeDeps();
    const flow = new CodexLoginFlow(core, deps);

    const first = await flow.start();
    const second = await flow.start();
    expect(callbackClosed()).toBeGreaterThan(0);
    expect(waitCancelled()).toBeGreaterThan(0);
    // The superseded attempt is gone, so its id no longer resolves.
    expect(() => flow.status(first.login_id)).toThrow(CodexLoginNotFoundError);
    flow.cancel(second.login_id);
  });

  it('returns expired before exchanging and releases the callback wait', async () => {
    const configRef = { current: emptyConfig() };
    const { core, setCalls } = makeCore(configRef);
    let clock = 1_700_000_000_000;
    const exchangeCode = vi.fn(async () => ({
      accessToken: 'ACCESS-TOKEN-SECRET',
      refreshToken: 'REFRESH-TOKEN-SECRET',
      accountId: 'acct',
    }));
    const wait = deferred<null>();
    const { deps, callbackClosed, waitCancelled } = makeDeps(
      { now: () => clock, exchangeCode },
      true,
      () => wait.promise,
      () => { wait.resolve(null); },
    );
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    clock += 11 * 60 * 1000;
    const expired = await flow.submitCode(start.login_id, 'code-only');

    expect(expired.state).toBe('failed');
    expect(expired.message).toContain('timed out');
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(setCalls).toEqual([]);
    expect(waitCancelled()).toBeGreaterThan(0);
    expect(callbackClosed()).toBeGreaterThan(0);
  });

  it('cleans up the callback wait when completion finishes', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const wait = deferred<null>();
    const { deps, callbackClosed, waitCancelled } = makeDeps(
      {},
      true,
      () => wait.promise,
      () => { wait.resolve(null); },
    );
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    const status = await flow.submitCode(start.login_id, 'code-only');

    expect(status.state).toBe('completed');
    expect(waitCancelled()).toBeGreaterThan(0);
    expect(callbackClosed()).toBeGreaterThan(0);
  });

  it('cancels a pending attempt and its callback wait', async () => {
    const configRef = { current: emptyConfig() };
    const { core } = makeCore(configRef);
    const wait = deferred<null>();
    const { deps, waitCancelled } = makeDeps(
      {},
      true,
      () => wait.promise,
      () => { wait.resolve(null); },
    );
    const flow = new CodexLoginFlow(core, deps);

    const start = await flow.start();
    expect(flow.cancel(start.login_id).state).toBe('cancelled');
    expect(waitCancelled()).toBeGreaterThan(0);
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
