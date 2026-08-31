import { describe, expect, it, vi } from 'vitest';

import type {
  OpenAICodexCallbackServer,
  OpenAICodexModelInfo,
} from '@pymodel/pythinker-code-oauth';

import type { IConfigService } from '#/app/config/config';
import {
  DEFAULT_MODEL_SECTION,
  MODELS_SECTION,
  PROVIDERS_SECTION,
  THINKING_SECTION,
} from '#/app/kosongConfig/configSection';
import {
  CodexLoginFlow,
  type CodexLoginDeps,
} from '#/app/codexLogin/codexLoginService';
import {
  CodexLoginInvalidCodeError,
  CodexLoginNotFoundError,
} from '#/app/codexLogin/codexLogin';

const MODELS: OpenAICodexModelInfo[] = [
  {
    id: 'gpt-5',
    contextLength: 256_000,
    supportsReasoning: true,
    supportsImageIn: true,
    supportsVideoIn: false,
  },
  {
    id: 'gpt-5-codex',
    contextLength: 256_000,
    supportsReasoning: true,
    supportedReasoningEfforts: ['low', 'high'],
    supportsImageIn: true,
    supportsVideoIn: false,
  },
];

function callback(
  loopback = false,
  waitForCode: OpenAICodexCallbackServer['waitForCode'] = async () => null,
): OpenAICodexCallbackServer {
  return {
    loopback,
    redirectUri: 'http://localhost:1455/auth/callback',
    waitForCode,
    cancelWait: vi.fn(),
    close: vi.fn(),
  };
}

function deps(overrides: Partial<CodexLoginDeps> = {}): CodexLoginDeps {
  return {
    createPkce: () => ({ verifier: 'verifier', challenge: 'challenge', state: 'state-1' }),
    buildAuthorizeUrl: () => 'https://auth.openai.com/oauth/authorize?state=state-1',
    startCallbackServer: async () => callback(),
    exchangeCode: async () => ({
      accessToken: 'access-token-fixture',
      refreshToken: 'refresh-token-fixture',
      accountId: 'account-fixture',
      expiresAtMs: 1_700_000_100_000,
    }),
    fetchModels: async () => MODELS,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function configStub(): {
  service: IConfigService;
  replaceSections: ReturnType<typeof vi.fn<IConfigService['replaceSections']>>;
} {
  const values: Record<string, unknown> = {
    [PROVIDERS_SECTION]: {},
    [MODELS_SECTION]: {},
    [DEFAULT_MODEL_SECTION]: undefined,
    [THINKING_SECTION]: undefined,
  };
  const replaceSections = vi.fn<IConfigService['replaceSections']>(
    async (sections: Readonly<Record<string, unknown>>) => {
      Object.assign(values, sections);
    },
  );
  return {
    service: {
      get: (domain: string) => values[domain],
      replaceSections,
      reload: async () => {},
    } as unknown as IConfigService,
    replaceSections,
  };
}

describe('CodexLoginFlow', () => {
  it('completes a manual login with one atomic config replacement', async () => {
    const config = configStub();
    const flow = new CodexLoginFlow(config.service, deps());

    const start = await flow.start();
    const status = await flow.submitCode(
      start.login_id,
      'http://localhost:1455/auth/callback?code=code-1&state=state-1',
    );

    expect(status).toEqual({
      login_id: start.login_id,
      state: 'completed',
      default_model: 'openai-codex/gpt-5-codex',
      message: undefined,
    });
    expect(JSON.stringify(status)).not.toContain('token-fixture');
    expect(config.replaceSections).toHaveBeenCalledOnce();
    expect(config.replaceSections).toHaveBeenCalledWith({
      providers: expect.objectContaining({
        'openai-codex': expect.objectContaining({ type: 'openai_responses' }),
      }),
      models: expect.objectContaining({
        'openai-codex/gpt-5-codex': expect.objectContaining({ model: 'gpt-5-codex' }),
      }),
      defaultModel: 'openai-codex/gpt-5-codex',
      thinking: { enabled: true, effort: 'high' },
    });
    flow.dispose();
  });

  it('rejects an unknown login id with a coded domain error', () => {
    const flow = new CodexLoginFlow(configStub().service, deps());

    expect(() => flow.status('missing')).toThrowError(CodexLoginNotFoundError);
    flow.dispose();
  });

  it('rejects a redirect URL with another attempt state before token exchange', async () => {
    const exchangeCode = vi.fn(deps().exchangeCode);
    const config = configStub();
    const flow = new CodexLoginFlow(config.service, deps({ exchangeCode }));
    const start = await flow.start();

    await expect(
      flow.submitCode(start.login_id, 'http://localhost:1455/auth/callback?code=x&state=other'),
    ).rejects.toThrowError(CodexLoginInvalidCodeError);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(config.replaceSections).not.toHaveBeenCalled();
    flow.dispose();
  });

  it('does not write tokens after cancellation during token exchange', async () => {
    const tokenResult = deferred<Awaited<ReturnType<CodexLoginDeps['exchangeCode']>>>();
    const exchangeCode = vi.fn(() => tokenResult.promise);
    const config = configStub();
    const flow = new CodexLoginFlow(config.service, deps({ exchangeCode }));
    const start = await flow.start();
    const completion = flow.submitCode(start.login_id, 'code-1');
    await vi.waitFor(() => expect(exchangeCode).toHaveBeenCalledOnce());

    expect(flow.cancel(start.login_id).state).toBe('cancelled');
    tokenResult.resolve({
      accessToken: 'late-access-token-fixture',
      refreshToken: 'late-refresh-token-fixture',
      accountId: 'late-account-fixture',
      expiresAtMs: 1_700_000_100_000,
    });

    await expect(completion).resolves.toMatchObject({ state: 'cancelled' });
    expect(config.replaceSections).not.toHaveBeenCalled();
    flow.dispose();
  });

  it('keeps manual submission pending after an invalid loopback callback', async () => {
    const flow = new CodexLoginFlow(
      configStub().service,
      deps({ startCallbackServer: async () => callback(true) }),
    );

    const start = await flow.start();
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(flow.status(start.login_id).state).toBe('pending');
    flow.dispose();
  });

  it('reports a cancelled state when the consent page denies authorization', async () => {
    const flow = new CodexLoginFlow(
      configStub().service,
      deps({ startCallbackServer: async () => callback(true, async () => ({ denied: true })) }),
    );

    const start = await flow.start();
    await vi.waitFor(() => expect(flow.status(start.login_id).state).toBe('cancelled'));

    expect(flow.status(start.login_id).message).toBe('OpenAI Codex authorization was denied.');
    flow.dispose();
  });

  it('does not report cancellation after the atomic config commit starts', async () => {
    const config = configStub();
    const persisted = deferred<void>();
    config.replaceSections.mockImplementation(() => persisted.promise);
    const flow = new CodexLoginFlow(config.service, deps());
    const start = await flow.start();
    const completion = flow.submitCode(start.login_id, 'code-1');
    await vi.waitFor(() => expect(config.replaceSections).toHaveBeenCalledOnce());

    expect(flow.cancel(start.login_id).state).toBe('pending');
    persisted.resolve();

    await expect(completion).resolves.toMatchObject({
      state: 'completed',
      default_model: 'openai-codex/gpt-5-codex',
    });
    flow.dispose();
  });
});
