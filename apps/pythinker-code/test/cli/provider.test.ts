/**
 * `pythinker provider` CLI unit tests. The handlers receive an injected `getHarness`
 * + capturing stdout/stderr, so we test the wiring end-to-end without booting
 * a real harness or hitting the network.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import {
  DEFAULT_CATALOG_URL,
  type PythinkerConfig,
} from '@pymodel/pythinker-code-sdk';

import {
  handleCatalogAdd,
  handleCatalogList,
  handleProviderAdd,
  handleProviderList,
  handleProviderRemove,
  registerProviderCommand,
  type ProviderDeps,
} from '#/cli/sub/provider';

class ExitCalled extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

interface FakeHarness {
  ensureConfigFile: () => Promise<void>;
  getConfig: () => Promise<PythinkerConfig>;
  setConfig: (patch: Partial<PythinkerConfig>) => Promise<PythinkerConfig>;
  removeProvider: (providerId: string) => Promise<PythinkerConfig>;
}

function makeHarness(initial: PythinkerConfig): {
  harness: FakeHarness;
  current: () => PythinkerConfig;
  setConfigCalls: Array<Partial<PythinkerConfig>>;
  removeCalls: string[];
} {
  // `persisted` simulates the on-disk config; the real RPC's `removeProvider`
  // reads from / writes to disk on every call (see
  // `packages/agent-core/src/rpc/core-impl.ts removePythinkerProvider`). Tests must
  // model this: anything the handler builds up in its in-memory `config`
  // object disappears unless it is flushed via `setConfig` BEFORE the next
  // `removeProvider`.
  let persisted: PythinkerConfig = structuredClone(initial);
  const setConfigCalls: Array<Partial<PythinkerConfig>> = [];
  const removeCalls: string[] = [];
  const harness: FakeHarness = {
    ensureConfigFile: async () => {},
    getConfig: async () => structuredClone(persisted),
    setConfig: async (patch) => {
      setConfigCalls.push(structuredClone(patch));
      // Mirror the real `setPythinkerConfig`: deep-merge with undefined keys
      // skipped (see `agent-core/src/config/merge.ts deepMerge`). This is
      // load-bearing for tests that assert `setConfig({defaultModel:
      // undefined})` does NOT wipe a key from disk — only `removeProvider`
      // can.
      const next: Record<string, unknown> = { ...persisted };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        next[key] = value;
      }
      persisted = next as PythinkerConfig;
      return structuredClone(persisted);
    },
    removeProvider: async (providerId) => {
      removeCalls.push(providerId);
      const nextProviders = { ...persisted.providers };
      delete nextProviders[providerId];
      const nextModels = { ...persisted.models };
      let removedDefault = false;
      for (const [alias, model] of Object.entries(nextModels)) {
        if (model.provider === providerId) {
          delete nextModels[alias];
          if (persisted.defaultModel === alias) removedDefault = true;
        }
      }
      persisted = { ...persisted, providers: nextProviders, models: nextModels };
      if (removedDefault) persisted = { ...persisted, defaultModel: undefined };
      if (persisted.defaultProvider === providerId) {
        persisted = { ...persisted, defaultProvider: undefined };
      }
      return structuredClone(persisted);
    },
  };
  return {
    harness,
    current: () => persisted,
    setConfigCalls,
    removeCalls,
  };
}

function makeDeps(
  harness: FakeHarness,
  overrides: Partial<ProviderDeps> = {},
): {
  deps: ProviderDeps;
  stdout: string[];
  stderr: string[];
  exitCodes: number[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const deps: ProviderDeps = {
    getHarness: () => harness as unknown as ProviderDeps extends { getHarness: () => infer R }
      ? R
      : never,
    stdout: {
      write: (chunk: string) => {
        stdout.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string) => {
        stderr.push(chunk);
        return true;
      },
    },
    env: {},
    exit: ((code: number) => {
      exitCodes.push(code);
      throw new ExitCalled(code);
    }) as ProviderDeps['exit'],
    ...overrides,
  };
  return { deps, stdout, stderr, exitCodes };
}

async function tryRun<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ExitCalled) return undefined;
    throw error;
  }
}

const REGISTRY_URL = 'https://registry.example.test/v1/models/api.json';
const REGISTRY_BODY = {
  kohub: {
    id: 'kohub',
    name: 'KoHub Anthropic',
    api: 'https://registry.example.test',
    type: 'anthropic',
    models: {
      'claude-opus-4-7': { id: 'claude-opus-4-7', name: 'Claude Opus 4-7', tool_call: true },
    },
  },
  'kohub-responses': {
    id: 'kohub-responses',
    name: 'KoHub Responses',
    api: 'https://registry.example.test/v1',
    type: 'openai_responses',
    models: {
      'gpt-5.5': { id: 'gpt-5.5', name: 'GPT 5.5', reasoning: true },
    },
  },
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockRegistryFetch(body: unknown = REGISTRY_BODY, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

const CATALOG_BODY = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    npm: '@ai-sdk/anthropic',
    api: 'https://api.anthropic.com',
    env: ['ANTHROPIC_API_KEY'],
    models: {
      'claude-opus-4-7': {
        id: 'claude-opus-4-7',
        name: 'Claude Opus 4.7',
        limit: { context: 200_000, output: 64_000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
      'claude-haiku-4-5': {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        limit: { context: 200_000, output: 16_000 },
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    npm: '@ai-sdk/openai',
    api: 'https://api.openai.com/v1',
    env: ['OPENAI_API_KEY'],
    models: {
      'gpt-5.5': {
        id: 'gpt-5.5',
        name: 'GPT 5.5',
        limit: { context: 1_048_576, output: 128_000 },
        tool_call: true,
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
};

const CATALOG_ENV = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  OPENAI_API_KEY: 'test-openai-key',
};

describe('pythinker provider add', () => {
  it('imports providers and models from a custom registry, persisting source on each provider', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness, current, setConfigCalls } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-test-token' }),
    );

    expect(exitCodes).toEqual([]);
    expect(stderr.join('')).toBe('');
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-token' }),
      }),
    );

    const finalConfig = current();
    expect(Object.keys(finalConfig.providers).toSorted()).toEqual(['kohub', 'kohub-responses']);
    const kohub = finalConfig.providers['kohub']!;
    expect(kohub.type).toBe('anthropic');
    expect(kohub.baseUrl).toBe('https://registry.example.test');
    expect(kohub.apiKey).toBe('sk-test-token');
    expect(kohub.source).toEqual({
      kind: 'apiJson',
      url: REGISTRY_URL,
      apiKey: 'sk-test-token',
    });

    expect(finalConfig.models?.['kohub/claude-opus-4-7']).toMatchObject({
      provider: 'kohub',
      model: 'claude-opus-4-7',
    });
    expect(finalConfig.models?.['kohub-responses/gpt-5.5']).toMatchObject({
      provider: 'kohub-responses',
      model: 'gpt-5.5',
    });

    // The single setConfig patch should carry both providers and models.
    expect(setConfigCalls).toHaveLength(1);
    expect(Object.keys(setConfigCalls[0]?.providers ?? {}).toSorted()).toEqual([
      'kohub',
      'kohub-responses',
    ]);

    const output = stdout.join('');
    expect(output).toContain('Imported 2 providers (2 models)');
    expect(output).toContain('- kohub');
    expect(output).toContain('- kohub-responses');
  });

  it('drops a stale provider before re-applying when the id already exists', async () => {
    mockRegistryFetch();
    const initial: PythinkerConfig = {
      providers: {
        kohub: {
          type: 'pythinker',
          baseUrl: 'https://stale.example.test',
          apiKey: 'old',
        },
      },
      models: {
        'kohub/stale-model': {
          provider: 'kohub',
          model: 'stale-model',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as PythinkerConfig;
    const { harness, removeCalls, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-new' }),
    );

    expect(exitCodes).toEqual([]);
    expect(removeCalls).toContain('kohub');
    // The stale model alias must be gone; the registry's alias must be in.
    expect(current().models?.['kohub/stale-model']).toBeUndefined();
    expect(current().models?.['kohub/claude-opus-4-7']).toBeDefined();
  });

  it('preserves a still-valid default model when re-importing its provider', async () => {
    mockRegistryFetch();
    const initial: PythinkerConfig = {
      providers: {
        kohub: {
          type: 'anthropic',
          baseUrl: 'https://registry.example.test',
          apiKey: 'old',
        },
      },
      models: {
        'kohub/claude-opus-4-7': {
          provider: 'kohub',
          model: 'claude-opus-4-7',
          maxContextSize: 1024,
          capabilities: ['tool_use'],
        },
      },
      defaultProvider: 'kohub',
      defaultModel: 'kohub/claude-opus-4-7',
      defaultThinking: true,
    } as unknown as PythinkerConfig;
    const { harness, current, setConfigCalls } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-new' }));

    expect(exitCodes).toEqual([]);
    expect(current().defaultProvider).toBe('kohub');
    expect(current().defaultModel).toBe('kohub/claude-opus-4-7');
    expect(current().defaultThinking).toBe(true);
    expect(setConfigCalls[0]).toMatchObject({
      defaultProvider: 'kohub',
      defaultModel: 'kohub/claude-opus-4-7',
      defaultThinking: true,
    });
  });

  it('preserves newly-imported providers when a later registry entry replaces an existing id', async () => {
    // Regression test for the codex P1: `harness.removeProvider` re-reads
    // from disk on each call, so applying the loop body without flushing
    // would silently drop providers added earlier in the same iteration.
    // The handler now removes every stale id up front in a single batch.
    mockRegistryFetch();
    const initial: PythinkerConfig = {
      providers: {
        // The registry will replace this one.
        'kohub-responses': {
          type: 'openai_responses',
          baseUrl: 'https://stale.example.test/v1',
          apiKey: 'old',
        },
      },
      models: {
        'kohub-responses/legacy-model': {
          provider: 'kohub-responses',
          model: 'legacy-model',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as PythinkerConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-fresh' }),
    );

    expect(exitCodes).toEqual([]);
    const final = current();
    // BOTH providers must end up in the final config — `kohub` was newly
    // added in the loop, `kohub-responses` was replaced. The old bug dropped
    // `kohub` because the second iteration's `removeProvider` reloaded a
    // disk-backed config that had not yet been persisted with `kohub`.
    expect(final.providers['kohub']).toBeDefined();
    expect(final.providers['kohub-responses']).toBeDefined();
    expect(final.providers['kohub-responses']?.apiKey).toBe('sk-fresh');
    expect(final.models?.['kohub/claude-opus-4-7']).toBeDefined();
    expect(final.models?.['kohub-responses/gpt-5.5']).toBeDefined();
    expect(final.models?.['kohub-responses/legacy-model']).toBeUndefined();
  });

  it('reads the api key from PYTHINKER_REGISTRY_API_KEY when --api-key is omitted', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { PYTHINKER_REGISTRY_API_KEY: 'sk-env-token' },
    });

    await tryRun(() => handleProviderAdd(deps, REGISTRY_URL, {}));

    expect(exitCodes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-env-token' }),
      }),
    );
  });

  it('exits 1 with a clear message when no api key is supplied anywhere', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderAdd(deps, REGISTRY_URL, {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toMatch(/missing api key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 when the registry fetch fails with an HTTP error', async () => {
    mockRegistryFetch({ message: 'invalid token' }, 401);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() =>
      handleProviderAdd(deps, REGISTRY_URL, { apiKey: 'sk-bad' }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toMatch(/HTTP 401/);
  });
});

describe('pythinker provider remove', () => {
  it('removes a provider and reports success', async () => {
    const initial: PythinkerConfig = {
      providers: {
        kohub: { type: 'anthropic', baseUrl: 'https://x', apiKey: 'k' },
      },
      models: {
        'kohub/m': {
          provider: 'kohub',
          model: 'm',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
    } as unknown as PythinkerConfig;
    const { harness, removeCalls, current } = makeHarness(initial);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRemove(deps, 'kohub'));

    expect(exitCodes).toEqual([]);
    expect(removeCalls).toEqual(['kohub']);
    expect(current().providers['kohub']).toBeUndefined();
    expect(stdout.join('')).toContain('Removed provider "kohub"');
  });

  it('exits 1 when the provider id does not exist', async () => {
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleProviderRemove(deps, 'nope'));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "nope" not found');
  });
});

describe('pythinker provider list', () => {
  const config: PythinkerConfig = {
    providers: {
      kohub: {
        type: 'anthropic',
        baseUrl: 'https://x',
        apiKey: 'k',
        source: { kind: 'apiJson', url: REGISTRY_URL, apiKey: 'k' },
      },
      'moonshot-cn': {
        type: 'pythinker',
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKey: 'sk-moonshot',
      },
      manual: { type: 'openai', baseUrl: 'https://y', apiKey: 'm' },
    },
    models: {
      'kohub/a': {
        provider: 'kohub',
        model: 'a',
        maxContextSize: 1024,
        capabilities: [],
      },
      'kohub/b': {
        provider: 'kohub',
        model: 'b',
        maxContextSize: 1024,
        capabilities: [],
      },
      'manual/x': {
        provider: 'manual',
        model: 'x',
        maxContextSize: 1024,
        capabilities: [],
      },
    },
    defaultModel: 'kohub/a',
  } as unknown as PythinkerConfig;

  it('renders one row per provider with counts and source labels', async () => {
    const { harness } = makeHarness(config);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: false }));

    const out = stdout.join('');
    expect(out).toMatch(/kohub\s+type=anthropic\s+models=2\s+source=apiJson\(/);
    expect(out).toMatch(/moonshot-cn\s+type=pythinker\s+models=0\s+source=inline/u);
    expect(out).toMatch(/manual\s+type=openai\s+models=1\s+source=inline/);
    expect(out).toContain('Default model: kohub/a');
  });

  it('prints a friendly message when nothing is configured', async () => {
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: false }));

    expect(stdout.join('')).toContain('No providers configured');
  });

  it('emits parseable JSON with --json', async () => {
    const { harness } = makeHarness(config);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleProviderList(deps, { json: true }));

    const parsed = JSON.parse(stdout.join('')) as {
      providers: Record<string, unknown>;
      models: Record<string, unknown>;
    };
    expect(Object.keys(parsed.providers).toSorted()).toEqual([
      'kohub',
      'manual',
      'moonshot-cn',
    ]);
    expect(Object.keys(parsed.models)).toContain('kohub/a');
  });
});

describe('registerProviderCommand', () => {
  it('describes the user-facing subcommand and routes flags through commander', async () => {
    const fetchMock = mockRegistryFetch();
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes, stdout } = makeDeps(harness);

    const program = new Command('pythinker');
    registerProviderCommand(program, deps);

    const providerCmd = program.commands.find((c) => c.name() === 'provider');
    expect(providerCmd?.description()).toMatch(/Manage LLM providers/i);

    await tryRun(() =>
      program.parseAsync(
        ['node', 'pythinker', 'provider', 'add', REGISTRY_URL, '--api-key', 'sk-cli'],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      REGISTRY_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-cli' }),
      }),
    );
    expect(Object.keys(current().providers).toSorted()).toEqual(['kohub', 'kohub-responses']);
    expect(stdout.join('')).toContain('Imported 2 providers');
  });

  it('reports write failures on stderr and exits 1 instead of crashing', async () => {
    const { harness } = makeHarness({
      providers: { pythinker: { type: 'pythinker' } },
    } as unknown as PythinkerConfig);
    // Simulate the strict write path rejecting because config.toml is invalid.
    harness.removeProvider = async () => {
      throw new Error(
        'Cannot change settings while config.toml is invalid — fix it first (run `pythinker doctor` for details).',
      );
    };
    const { deps, stderr, exitCodes } = makeDeps(harness);

    const program = new Command('pythinker');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(['node', 'pythinker', 'provider', 'remove', 'pythinker'], { from: 'node' }),
    );

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Cannot change settings');
    expect(stderr.join('')).not.toContain('    at '); // no stack trace dump
  });
});

describe('pythinker provider catalog list', () => {
  it('lists catalog providers with wire/model counts, sorted by id', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, undefined, { json: false }));

    expect(exitCodes).toEqual([]);
    const out = stdout.join('');
    expect(out).toMatch(/^anthropic\s+wire=anthropic\s+models=2\s+Anthropic\n/);
    expect(out).toMatch(/openai\s+wire=openai\s+models=1\s+OpenAI/);
    // anthropic before openai (alphabetical).
    expect(out.indexOf('anthropic')).toBeLessThan(out.indexOf('openai'));
  });

  it('filters case-insensitively by id and name substring', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, undefined, { json: false, filter: 'open' }));

    const out = stdout.join('');
    expect(out).toContain('openai');
    expect(out).not.toContain('anthropic');
  });

  it('drills into a specific providerId and lists its models with capabilities', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'anthropic', { json: false }));

    const out = stdout.join('');
    expect(out).toMatch(/^Anthropic \(anthropic\)/);
    expect(out).toMatch(/claude-opus-4-7\s+ctx=200000.*tool_use.*thinking.*image_in/);
    expect(out).toMatch(/claude-haiku-4-5\s+ctx=200000.*tool_use/);
  });

  it('exits 1 when the requested providerId is missing from the catalog', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'unknown', { json: false }));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "unknown" not found in catalog');
  });

  it('emits parseable JSON for the providerId view', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stdout } = makeDeps(harness);

    await tryRun(() => handleCatalogList(deps, 'openai', { json: true }));

    const parsed = JSON.parse(stdout.join('')) as {
      providerId: string;
      models: Array<{ id: string }>;
    };
    expect(parsed.providerId).toBe('openai');
    expect(parsed.models.map((m) => m.id)).toEqual(['gpt-5.5']);
  });

  it('honors --url override when supplied', async () => {
    const fetchMock = mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps } = makeDeps(harness);

    await tryRun(() =>
      handleCatalogList(deps, undefined, { json: true, url: 'https://example.test/catalog.json' }),
    );

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/catalog.json', expect.any(Object));
  });
});

describe('pythinker provider catalog add', () => {
  it('imports a provider from the catalog without changing the default model', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const initial: PythinkerConfig = {
      providers: {
        other: { type: 'pythinker', baseUrl: 'https://x', apiKey: 'k' },
      },
      models: {
        'other/main': {
          provider: 'other',
          model: 'main',
          maxContextSize: 1024,
          capabilities: [],
        },
      },
      defaultModel: 'other/main',
      defaultThinking: true,
    } as unknown as PythinkerConfig;
    const { harness, current, setConfigCalls } = makeHarness(initial);
    const { deps, stdout, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

    expect(exitCodes).toEqual([]);
    const finalConfig = current();
    expect(finalConfig.providers['anthropic']).toMatchObject({
      type: 'anthropic',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      source: { kind: 'modelsDev', url: DEFAULT_CATALOG_URL },
    });
    expect(finalConfig.providers['anthropic']?.apiKey).toBeUndefined();
    // Catalog import populates the model aliases.
    expect(finalConfig.models?.['anthropic/claude-opus-4-7']).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });
    expect(finalConfig.models?.['anthropic/claude-haiku-4-5']).toBeDefined();
    // The unrelated provider's model survives, and remains the default.
    expect(finalConfig.models?.['other/main']).toBeDefined();
    expect(finalConfig.defaultModel).toBe('other/main');
    expect(finalConfig.defaultThinking).toBe(true);
    // The patch sent over `setConfig` must explicitly carry the preserved default.
    expect(setConfigCalls[0]?.defaultModel).toBe('other/main');
    expect(stdout.join('')).toContain('Imported Anthropic (anthropic)');
  });

  it('sets default_model when --default-model is supplied and the model exists', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {},
    } as PythinkerConfig);
    const { deps, stdout, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(setConfigCalls[0]?.defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(stdout.join('')).toContain('Default model set to anthropic/claude-opus-4-7');
  });

  it('rejects an unknown --default-model with a helpful hint', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        defaultModel: 'does-not-exist',
      }),
    );

    expect(exitCodes).toEqual([1]);
    const err = stderr.join('');
    expect(err).toContain('"does-not-exist" is not in provider "anthropic"');
    expect(err).toContain('pythinker provider catalog list anthropic');
  });

  it('preserves an existing default_model when re-importing the same provider without --default-model', async () => {
    // Regression test for the codex P2: `removeProvider` clears
    // `defaultModel` if it pointed at one of the provider's aliases. The
    // handler must capture the previous default BEFORE calling
    // `removeProvider`, otherwise refreshing an already-configured provider
    // would silently wipe the user's chosen default.
    mockRegistryFetch(CATALOG_BODY);
    const initial: PythinkerConfig = {
      providers: {
        anthropic: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        },
      },
      models: {
        'anthropic/claude-opus-4-7': {
          provider: 'anthropic',
          model: 'claude-opus-4-7',
          maxContextSize: 200_000,
          capabilities: ['tool_use', 'thinking', 'image_in'],
        },
      },
      defaultProvider: 'anthropic',
      defaultModel: 'anthropic/claude-opus-4-7',
      defaultThinking: true,
    } as unknown as PythinkerConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBe('ANTHROPIC_API_KEY');
    // Previous provider/model defaults and thinking flag must survive the re-import.
    expect(current().defaultProvider).toBe('anthropic');
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(current().defaultThinking).toBe(true);
  });

  it('preserves default_thinking when --default-model is supplied to a thinking-capable model', async () => {
    // Regression test for the codex P2: `applyCatalogProvider` always
    // assigns `defaultThinking` from `options.thinking`. Hardcoding `false`
    // silently disabled thinking even when the user previously had it on
    // and is just importing a known provider. The handler now threads the
    // previous value through.
    mockRegistryFetch(CATALOG_BODY);
    const initial: PythinkerConfig = {
      providers: {},
      defaultThinking: true,
    } as unknown as PythinkerConfig;
    const { harness, current, setConfigCalls } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    expect(current().defaultThinking).toBe(true);
    expect(setConfigCalls[0]?.defaultThinking).toBe(true);
  });

  it('does not persist default_thinking=false for first-time setup with --default-model', async () => {
    // Regression test for codex P2 follow-up: previously the handler fell
    // back to `false` when `defaultThinking` was unset, but
    // `resolveThinkingLevel` treats `defaultThinking === false` as an
    // explicit "off" request. A fresh `pythinker provider catalog add
    // anthropic --default-model claude-opus-4-7` must NOT silently disable
    // thinking — it should leave `defaultThinking` unset so the runtime
    // uses the per-model default.
    mockRegistryFetch(CATALOG_BODY);
    // Note: `defaultThinking` is omitted on purpose to model a fresh user.
    const { harness, current, setConfigCalls } = makeHarness({
      providers: {},
    } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() =>
      handleCatalogAdd(deps, 'anthropic', {
        defaultModel: 'claude-opus-4-7',
      }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().defaultModel).toBe('anthropic/claude-opus-4-7');
    // Must NOT be `false`. `undefined` lets the runtime resolver pick the
    // per-model default; `false` would force `'off'`.
    expect(current().defaultThinking).toBeUndefined();
    expect(setConfigCalls[0]?.defaultThinking).toBeUndefined();
  });

  it('drops a stale default_model when the catalog refresh no longer contains it', async () => {
    // Regression test for codex P2: when the user previously chose
    // `anthropic/legacy` as default and a refresh of the same provider no
    // longer ships that model, restoring the previous default would point
    // `default_model` at a non-existent alias and break the next session.
    // The handler now checks whether the alias still resolves and clears
    // it otherwise.
    mockRegistryFetch(CATALOG_BODY);
    const initial: PythinkerConfig = {
      providers: {
        anthropic: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        },
      },
      models: {
        'anthropic/legacy-claude': {
          provider: 'anthropic',
          model: 'legacy-claude',
          maxContextSize: 200_000,
          capabilities: [],
        },
      },
      defaultModel: 'anthropic/legacy-claude',
    } as unknown as PythinkerConfig;
    const { harness, current } = makeHarness(initial);
    const { deps, exitCodes } = makeDeps(harness, { env: CATALOG_ENV });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

    expect(exitCodes).toEqual([]);
    // The legacy alias must have been replaced by the catalog's models.
    expect(current().models?.['anthropic/legacy-claude']).toBeUndefined();
    expect(current().models?.['anthropic/claude-opus-4-7']).toBeDefined();
    // The dangling default must NOT have been restored — it would point at
    // a non-existent alias. The handler clears it instead.
    expect(current().defaultModel).toBeUndefined();
  });

  it('allows an explicit API key environment-variable override', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { CUSTOM_OPENAI_API_KEY: 'test-openai-key' },
    });

    await tryRun(() =>
      handleCatalogAdd(deps, 'openai', { apiKeyEnv: 'CUSTOM_OPENAI_API_KEY' }),
    );

    expect(exitCodes).toEqual([]);
    expect(current().providers['openai']).toMatchObject({
      apiKeyEnvVar: 'CUSTOM_OPENAI_API_KEY',
    });
    expect(current().providers['openai']?.apiKey).toBeUndefined();
  });

  it.each([{}, { ANTHROPIC_API_KEY: '   ' }])(
    'exits 1 when the referenced API key is missing or blank',
    async (env) => {
      const fetchMock = mockRegistryFetch(CATALOG_BODY);
      const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
      const { deps, stderr, exitCodes } = makeDeps(harness, { env });

      await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

      expect(exitCodes).toEqual([1]);
      expect(stderr.join('')).toContain(
        'Environment variable "ANTHROPIC_API_KEY" is not set or is empty.',
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('exits 1 when the catalog does not declare a credential name', async () => {
    mockRegistryFetch({
      anthropic: { ...CATALOG_BODY.anthropic, env: undefined },
    });
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain(
      'Provider "anthropic" does not declare an API key environment variable.',
    );
  });

  it('exits 1 when the providerId is missing from the catalog', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, stderr, exitCodes } = makeDeps(harness);

    await tryRun(() => handleCatalogAdd(deps, 'no-such-id', {}));

    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Provider "no-such-id" not found in catalog');
  });

  it('routes --api-key-env through Commander', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { CUSTOM_ANTHROPIC_API_KEY: 'test-anthropic-key' },
    });
    const program = new Command('pythinker');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        [
          'node',
          'pythinker',
          'provider',
          'catalog',
          'add',
          'anthropic',
          '--api-key-env',
          'CUSTOM_ANTHROPIC_API_KEY',
        ],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBe(
      'CUSTOM_ANTHROPIC_API_KEY',
    );
  });

  it('stores a literal --api-key when the environment variable is unset', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, { env: {} });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-literal' }));

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-literal');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });

  it('prefers a literal --api-key over a set environment variable', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, {
      env: { ANTHROPIC_API_KEY: 'from-env' },
    });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-literal' }));

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-literal');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });

  it('stores a literal --api-key even when the catalog declares no credential name', async () => {
    mockRegistryFetch({
      anthropic: { ...CATALOG_BODY.anthropic, env: undefined },
    });
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, { env: {} });

    await tryRun(() => handleCatalogAdd(deps, 'anthropic', { apiKey: 'sk-literal' }));

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-literal');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });

  it('routes --api-key through Commander', async () => {
    mockRegistryFetch(CATALOG_BODY);
    const { harness, current } = makeHarness({ providers: {} } as PythinkerConfig);
    const { deps, exitCodes } = makeDeps(harness, { env: {} });
    const program = new Command('pythinker');
    registerProviderCommand(program, deps);

    await tryRun(() =>
      program.parseAsync(
        ['node', 'pythinker', 'provider', 'catalog', 'add', 'anthropic', '--api-key', 'sk-flag'],
        { from: 'node' },
      ),
    );

    expect(exitCodes).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-flag');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });
});
