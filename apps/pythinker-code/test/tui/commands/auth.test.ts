import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProviderEntry, PythinkerConfig } from '@pythoughts/pythinker-code-sdk';

import { connectCatalogProvider } from '#/tui/commands/auth';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

vi.mock('#/tui/commands/prompts', () => ({
  promptApiKey: vi.fn(),
  promptLogoutProviderSelection: vi.fn(),
  promptModelSelectionForCatalog: vi.fn(),
  promptModelSelectionForOpenPlatform: vi.fn(),
  promptPlatformSelection: vi.fn(),
}));

const { promptApiKey, promptModelSelectionForCatalog } = await import('#/tui/commands/prompts');

const CATALOG_ENTRY: CatalogProviderEntry = {
  id: 'anthropic',
  name: 'Anthropic',
  npm: '@ai-sdk/anthropic',
  api: 'https://api.anthropic.com',
  env: ['TEST_CATALOG_API_KEY'],
  models: {
    'claude-opus-4-7': {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      limit: { context: 200_000, output: 64_000 },
      tool_call: true,
      reasoning: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
  },
} as CatalogProviderEntry;

function makeHost(initial: PythinkerConfig) {
  let config = initial;
  const errors: string[] = [];
  const host = {
    harness: {
      getConfig: vi.fn(async () => config),
      setConfig: vi.fn(async (patch: Partial<PythinkerConfig>) => {
        config = { ...config, ...patch };
      }),
      removeProvider: vi.fn(async (id: string) => {
        delete config.providers[id];
        return config;
      }),
    },
    authFlow: { refreshConfigAfterLogin: vi.fn(async () => undefined) },
    showError: vi.fn((msg: string) => errors.push(msg)),
    showStatus: vi.fn(),
    track: vi.fn(),
    restoreEditor: vi.fn(),
    mountEditorReplacement: vi.fn(),
    cancelInFlight: undefined,
  } as unknown as SlashCommandHost;
  return { host, errors, current: () => config };
}

describe('connectCatalogProvider credential acquisition', () => {
  beforeEach(() => {
    vi.mocked(promptModelSelectionForCatalog).mockResolvedValue({
      model: { id: 'claude-opus-4-7' } as never,
      effort: 'off',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(promptApiKey).mockReset();
    vi.mocked(promptModelSelectionForCatalog).mockReset();
  });

  it('uses the env var without prompting when it is set', async () => {
    vi.stubEnv('TEST_CATALOG_API_KEY', 'from-env');
    const { host, current } = makeHost({ providers: {} } as PythinkerConfig);

    await connectCatalogProvider(host, 'anthropic', CATALOG_ENTRY);

    expect(promptApiKey).not.toHaveBeenCalled();
    expect(current().providers['anthropic']).toMatchObject({
      apiKeyEnvVar: 'TEST_CATALOG_API_KEY',
    });
    expect(current().providers['anthropic']?.apiKey).toBeUndefined();
  });

  it('prompts for a key and stores it literally when the env var is unset', async () => {
    vi.stubEnv('TEST_CATALOG_API_KEY', '');
    vi.mocked(promptApiKey).mockResolvedValue('sk-typed-in');
    const { host, errors, current } = makeHost({ providers: {} } as PythinkerConfig);

    await connectCatalogProvider(host, 'anthropic', CATALOG_ENTRY);

    expect(errors).toEqual([]);
    expect(promptApiKey).toHaveBeenCalledWith(
      host,
      'Anthropic',
      expect.arrayContaining([expect.stringContaining('config.toml')]),
    );
    expect(current().providers['anthropic']?.apiKey).toBe('sk-typed-in');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });

  it('prompts for a key when the catalog entry declares no env var', async () => {
    vi.mocked(promptApiKey).mockResolvedValue('sk-typed-in');
    const entry = { ...CATALOG_ENTRY, env: undefined } as CatalogProviderEntry;
    const { host, errors, current } = makeHost({ providers: {} } as PythinkerConfig);

    await connectCatalogProvider(host, 'anthropic', entry);

    expect(errors).toEqual([]);
    expect(current().providers['anthropic']?.apiKey).toBe('sk-typed-in');
    expect(current().providers['anthropic']?.apiKeyEnvVar).toBeUndefined();
  });

  it('aborts without writing config when the key prompt is cancelled', async () => {
    vi.stubEnv('TEST_CATALOG_API_KEY', '');
    vi.mocked(promptApiKey).mockResolvedValue(undefined);
    const { host, current } = makeHost({ providers: {} } as PythinkerConfig);

    await connectCatalogProvider(host, 'anthropic', CATALOG_ENTRY);

    expect(current().providers['anthropic']).toBeUndefined();
    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(promptModelSelectionForCatalog).not.toHaveBeenCalled();
  });
});
