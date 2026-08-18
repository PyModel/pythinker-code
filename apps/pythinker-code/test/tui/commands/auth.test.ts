import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PythinkerConfig } from '@pymodel/pythinker-code-sdk';
import {
  OPENAI_CODEX_OAUTH_PLATFORM_ID,
  OPENAI_CODEX_PROVIDER_ID,
  applyOpenAICodexOAuthConfig,
  fetchOpenAICodexModels,
  runOpenAICodexOAuthFlow,
} from '@pymodel/pythinker-code-oauth';

import { handleLoginCommand } from '#/tui/commands/auth';
import {
  promptModelSelectionForCodex,
  promptPlatformSelection,
} from '#/tui/commands/prompts';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

vi.mock('@pymodel/pythinker-code-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pymodel/pythinker-code-oauth')>();
  return {
    ...actual,
    applyOpenAICodexOAuthConfig: vi.fn(actual.applyOpenAICodexOAuthConfig),
    runOpenAICodexOAuthFlow: vi.fn(async () => ({
      accessToken: 'access-token-fixture',
      refreshToken: 'refresh-token-fixture',
      accountId: 'account-fixture',
    })),
    fetchOpenAICodexModels: vi.fn(async () => [
      {
        id: 'gpt-5-codex',
        contextLength: 256_000,
        supportsReasoning: true,
        supportedReasoningEfforts: ['low', 'high'],
        supportsImageIn: true,
        supportsVideoIn: false,
      },
    ]),
  };
});

vi.mock('#/tui/commands/prompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/tui/commands/prompts')>();
  return {
    ...actual,
    promptPlatformSelection: vi.fn(),
    promptModelSelectionForCodex: vi.fn(),
  };
});

vi.mock('#/utils/open-url', () => ({ openUrl: vi.fn() }));

describe('handleLoginCommand OpenAI Codex OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the current provider until one atomic replacement is ready', async () => {
    vi.mocked(promptPlatformSelection).mockResolvedValue(OPENAI_CODEX_OAUTH_PLATFORM_ID);
    vi.mocked(promptModelSelectionForCodex).mockResolvedValue({
      model: {
        id: 'gpt-5-codex',
        contextLength: 256_000,
        supportsReasoning: true,
        supportedReasoningEfforts: ['low', 'high'],
        supportsImageIn: true,
        supportsVideoIn: false,
      },
      thinking: 'high',
    });

    let config = {
      providers: { [OPENAI_CODEX_PROVIDER_ID]: { apiKey: 'existing-token-fixture' } },
      models: {},
    } as unknown as PythinkerConfig;
    const replaceConfigSections = vi.fn(async (sections: Record<string, unknown>) => {
      config = { ...config, ...sections } as PythinkerConfig;
    });
    const host = {
      harness: {
        getConfig: vi.fn(async () => config),
        supportsAtomicSectionReplace: () => true,
        replaceConfigSections,
        removeProvider: vi.fn(),
      },
      authFlow: { refreshConfigAfterLogin: vi.fn(async () => undefined) },
      showError: vi.fn(),
      showStatus: vi.fn(),
      track: vi.fn(),
      restoreEditor: vi.fn(),
      mountEditorReplacement: vi.fn(),
      cancelInFlight: undefined,
    } as unknown as SlashCommandHost;

    await handleLoginCommand(host);

    expect(runOpenAICodexOAuthFlow).toHaveBeenCalledOnce();
    expect(fetchOpenAICodexModels).toHaveBeenCalledOnce();
    expect(applyOpenAICodexOAuthConfig).toHaveBeenCalledOnce();
    expect(host.harness.removeProvider).not.toHaveBeenCalled();
    expect(replaceConfigSections).toHaveBeenCalledOnce();
    expect(config.defaultModel).toBe('openai-codex/gpt-5-codex');
    expect(host.track).toHaveBeenCalledWith('login', {
      provider: OPENAI_CODEX_PROVIDER_ID,
      method: 'oauth',
    });
  });

  it('does not persist credentials when cancellation arrives during config loading', async () => {
    vi.mocked(promptPlatformSelection).mockResolvedValue(OPENAI_CODEX_OAUTH_PLATFORM_ID);
    vi.mocked(promptModelSelectionForCodex).mockResolvedValue({
      model: {
        id: 'gpt-5-codex',
        contextLength: 256_000,
        supportsReasoning: true,
        supportsImageIn: true,
        supportsVideoIn: false,
      },
      thinking: 'high',
    });
    const replaceConfigSections = vi.fn();
    let host!: SlashCommandHost;
    host = {
      harness: {
        getConfig: vi.fn(async () => {
          host.cancelInFlight?.();
          return { providers: {}, models: {} } as PythinkerConfig;
        }),
        replaceConfigSections,
      },
      authFlow: { refreshConfigAfterLogin: vi.fn() },
      showError: vi.fn(),
      showStatus: vi.fn(),
      track: vi.fn(),
      cancelInFlight: undefined,
    } as unknown as SlashCommandHost;

    await handleLoginCommand(host);

    expect(replaceConfigSections).not.toHaveBeenCalled();
    expect(host.authFlow.refreshConfigAfterLogin).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
  });
});
