import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CoreRPC, PythinkerConfig } from '../../src';
import {
  AuthSummaryService,
  AuthTokenMissingError,
  type ICoreProcessService,
  type IEnvironmentService,
} from '../../src/services';

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeServiceFor(config: PythinkerConfig): AuthSummaryService {
  const rpc: Partial<CoreRPC> = {
    getPythinkerConfig: vi.fn(async () => config),
  };
  const core: ICoreProcessService = {
    _serviceBrand: undefined,
    rpc: rpc as CoreRPC,
    ready: async () => undefined,
    dispose: () => undefined,
  };
  return new AuthSummaryService(core);
}

function makeService(): AuthSummaryService {
  const config: PythinkerConfig = {
    defaultModel: 'catalog/model',
    providers: {
      catalog: {
        type: 'openai',
        apiKeyEnvVar: 'PYTHINKER_TEST_CATALOG_API_KEY',
      },
    },
    models: {
      'catalog/model': {
        provider: 'catalog',
        model: 'model',
        maxContextSize: 128_000,
      },
    },
  };
  return makeServiceFor(config);
}

describe('AuthSummaryService OAuth-provisioned providers', () => {
  // OpenAI Codex stores its access token as the provider `apiKey` and keeps the
  // refresh token under `source`. It is the only OAuth login left, and nothing
  // else marks a provider as OAuth-backed any more, so a Codex-only config has
  // to satisfy the plain api-key readiness check or every Codex user hits
  // AuthTokenMissingError on their first turn.
  const codexConfig: PythinkerConfig = {
    defaultModel: 'openai-codex/gpt-5-codex',
    providers: {
      'openai-codex': {
        type: 'openai_responses',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        apiKey: 'codex-access-token',
        source: { auth: 'openai-codex-oauth', accountId: 'acct-1' },
      },
    },
    models: {
      'openai-codex/gpt-5-codex': {
        provider: 'openai-codex',
        model: 'gpt-5-codex',
        maxContextSize: 272_000,
      },
    },
  } as unknown as PythinkerConfig;

  it('reports a Codex-only config as ready', async () => {
    await expect(makeServiceFor(codexConfig).get()).resolves.toEqual({
      ready: true,
      providers_count: 1,
      default_model: 'openai-codex/gpt-5-codex',
    });
  });

  it('lets a Codex-only config through ensureReady', async () => {
    await expect(makeServiceFor(codexConfig).ensureReady()).resolves.toBeUndefined();
  });
});

describe('AuthSummaryService API key environment references', () => {
  it('accepts a nonempty referenced shell credential', async () => {
    vi.stubEnv('PYTHINKER_TEST_CATALOG_API_KEY', 'runtime-key');
    const service = makeService();

    await expect(service.get()).resolves.toMatchObject({ ready: true });
    await expect(service.ensureReady()).resolves.toBeUndefined();
  });

  it('reports a blank referenced shell credential as not ready', async () => {
    vi.stubEnv('PYTHINKER_TEST_CATALOG_API_KEY', '   ');
    const service = makeService();

    await expect(service.get()).resolves.toMatchObject({ ready: false });
    await expect(service.ensureReady()).rejects.toBeInstanceOf(AuthTokenMissingError);
  });
});
