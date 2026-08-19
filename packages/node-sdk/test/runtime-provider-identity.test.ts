import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PythinkerConfig } from '@pymodel/agent-core';
import { createPythinkerDefaultHeaders, PYTHINKER_CODE_PLATFORM } from '@pymodel/pythinker-code-oauth';

import { ProviderManager } from '../../agent-core/src/session/provider-manager';
import { SDKRpcClient } from '#/index';
import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

function resolveRuntimeProvider(options: {
  readonly config: PythinkerConfig;
  readonly model?: string;
  readonly pythinkerRequestHeaders?: Record<string, string>;
}) {
  const manager = new ProviderManager({
    config: options.config,
    pythinkerRequestHeaders: options.pythinkerRequestHeaders,
  });
  const model = options.model ?? options.config.defaultModel;
  if (model === undefined) {
    throw new Error('No model selected');
  }
  return manager.resolveProviderConfig(model);
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-sdk-provider-identity-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('runtime provider identity headers', () => {
  it('preserves the host user agent suffix in SDK RPC headers', async () => {
    const homeDir = await makeTempDir();
    const client = new SDKRpcClient({
      homeDir,
      identity: {
        ...TEST_IDENTITY,
        userAgentSuffix: 'web-runtime',
      },
    });
    const core = client.core as unknown as {
      readonly pythinkerRequestHeaders?: Record<string, string>;
    };

    try {
      expect(core.pythinkerRequestHeaders).toMatchObject({
        'User-Agent': 'pythinker-code-cli/0.0.0-test (web-runtime)',
      });
    } finally {
      await client.close();
    }
  });

  it('adds the pythinker-code-cli User-Agent to the default Pythinker provider without device headers', async () => {
    const homeDir = await makeTempDir();
    const pythinkerRequestHeaders = createPythinkerDefaultHeaders({ homeDir, ...TEST_IDENTITY });
    const resolved = resolveRuntimeProvider({
      config: {
        defaultModel: 'pythinker-model',
        providers: {
          pythinker: {
            type: 'pythinker',
            apiKey: 'test-key',
          },
        },
        models: {
          'pythinker-model': {
            provider: 'pythinker',
            model: 'pythinker-model',
            maxContextSize: 1000,
          },
        },
      },
      pythinkerRequestHeaders,
    });

    expect(resolved.provider).toMatchObject({
      type: 'pythinker',
      defaultHeaders: expect.objectContaining({
        'User-Agent': 'pythinker-code-cli/0.0.0-test',
      }),
    });
    expect(
      Object.keys((resolved.provider as { defaultHeaders?: Record<string, string> }).defaultHeaders ?? {}).filter(
        (name) => name.startsWith('X-Msh-'),
      ),
    ).toEqual([]);
  });

  it('lets Pythinker provider customHeaders override default identity headers', async () => {
    const homeDir = await makeTempDir();
    const pythinkerRequestHeaders = createPythinkerDefaultHeaders({ homeDir, ...TEST_IDENTITY });
    const config: PythinkerConfig = {
      providers: {
        pythinker: {
          type: 'pythinker',
          apiKey: 'test-key',
          customHeaders: {
            'User-Agent': 'Custom/1',
            'X-Msh-Version': 'override-version',
          },
        },
      },
      defaultProvider: 'pythinker',
      defaultModel: 'pythinker-model',
      models: {
        'pythinker-model': {
          provider: 'pythinker',
          model: 'pythinker-model',
          maxContextSize: 1000,
        },
      },
    };

    const resolved = resolveRuntimeProvider({
      config,
      pythinkerRequestHeaders,
    });

    expect(resolved.provider).toMatchObject({
      type: 'pythinker',
      defaultHeaders: expect.objectContaining({
        'User-Agent': 'Custom/1',
        'X-Msh-Version': 'override-version',
      }),
    });
  });

  it('applies only the User-Agent (no device identity headers) to non-Pythinker providers', async () => {
    const homeDir = await makeTempDir();
    const pythinkerRequestHeaders = createPythinkerDefaultHeaders({ homeDir, ...TEST_IDENTITY });
    const config: PythinkerConfig = {
      providers: {
        openai: {
          type: 'openai',
          baseUrl: 'https://example.test/v1',
          apiKey: 'sk-test',
        },
      },
      defaultProvider: 'openai',
      defaultModel: 'gpt-test',
      models: {
        'gpt-test': {
          provider: 'openai',
          model: 'gpt-test',
          maxContextSize: 1000,
        },
      },
    };

    const resolved = resolveRuntimeProvider({
      config,
      pythinkerRequestHeaders,
    });

    expect(resolved.provider).toMatchObject({
      type: 'openai',
      model: 'gpt-test',
      defaultHeaders: {
        'User-Agent': `pythinker-code-cli/${TEST_IDENTITY.version}`,
      },
    });
    // Device identity headers (`X-Msh-*`) stay Pythinker-only — must not leak to
    // third-party providers.
    const headers = (resolved.provider as { defaultHeaders?: Record<string, string> })
      .defaultHeaders;
    expect(headers).toBeDefined();
    expect(headers).not.toHaveProperty('X-Msh-Platform');
  });
});
