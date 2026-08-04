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
  const rpc: Partial<CoreRPC> = {
    getPythinkerConfig: vi.fn(async () => config),
  };
  const core: ICoreProcessService = {
    _serviceBrand: undefined,
    rpc: rpc as CoreRPC,
    ready: async () => undefined,
    dispose: () => undefined,
  };
  const env: IEnvironmentService = {
    _serviceBrand: undefined,
    homeDir: '/tmp/pythinker-auth-summary-test',
    configPath: '/tmp/pythinker-auth-summary-test/config.toml',
  };
  return new AuthSummaryService(env, core);
}

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
