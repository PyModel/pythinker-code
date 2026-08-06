import {
  applyOpenAICodexOAuthConfig,
  applyOpenPlatformConfig,
  fetchOpenAICodexModels,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  OPENAI_CODEX_OAUTH_PLATFORM_ID,
  OPENAI_CODEX_PROVIDER_ID,
  OpenAICodexApiError,
  OpenPlatformApiError,
  runOpenAICodexOAuthFlow,
  type DeviceAuthorization,
  type ManagedKimiCodeModelInfo,
  type ManagedKimiConfigShape,
  KIMI_CODE_PROVIDER_NAME as DEFAULT_OAUTH_PROVIDER_NAME,
  type OpenPlatformDefinition,
} from '@pythoughts/pythinker-code-oauth';
import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogConnectionWire,
  catalogProviderModels,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  log,
  type CatalogModel,
  type CatalogProviderEntry,
  type PythinkerHarness,
} from '@pythoughts/pythinker-code-sdk';

import { catalogProviderIdFromPlatformValue } from '#/auth/platform-values';
import type { ApiKeyInputDialogOptions } from '#/tui/components/dialogs/api-key-input-dialog';
import type { PlatformSelection } from '#/tui/commands/prompts';
import type { ColorToken } from '#/tui/theme';
import type { LoginProgressSpinnerHandle } from '#/tui/types';
import { formatErrorMessage } from '#/tui/utils/event-payload';

// ---------------------------------------------------------------------------
// Login flows behind the LoginUi port (shared with non-TUI renderers)
// ---------------------------------------------------------------------------

export interface LoginUi {
  readonly harness: PythinkerHarness;
  readonly sessionId?: string;
  cancelInFlight: (() => void) | undefined;
  showStatus(message: string, level?: ColorToken): void;
  showError(message: string): void;
  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle;
  showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle;
  promptPlatformSelection(): Promise<PlatformSelection | undefined>;
  promptApiKey(
    platformName: string,
    subtitleLines?: readonly string[],
    options?: ApiKeyInputDialogOptions,
  ): Promise<string | undefined>;
  promptModelSelectionForOpenPlatform(
    models: ManagedKimiCodeModelInfo[],
    platform: OpenPlatformDefinition,
  ): Promise<{ model: ManagedKimiCodeModelInfo; effort: string } | undefined>;
  promptModelSelectionForCatalog(
    providerId: string,
    models: CatalogModel[],
  ): Promise<{ model: CatalogModel; effort: string } | undefined>;
  refreshConfigAfterLogin(): Promise<void>;
  track(event: string, props?: Record<string, unknown>): void;
}

export async function runLogin(ui: LoginUi): Promise<void> {
  const selection = await ui.promptPlatformSelection();
  if (selection === undefined) return;
  const { platformId, catalog } = selection;

  const catalogProviderId = catalogProviderIdFromPlatformValue(platformId);
  if (catalogProviderId !== undefined) {
    await connectCatalogProvider(ui, catalogProviderId, catalog[catalogProviderId]);
    return;
  }

  if (platformId === 'kimi-code') {
    await handlePythinkerCodeOAuthLogin(ui);
    return;
  }

  if (platformId === OPENAI_CODEX_OAUTH_PLATFORM_ID) {
    await handleOpenAICodexOAuthLogin(ui);
    return;
  }

  const platform = getOpenPlatformById(platformId);
  if (platform === undefined) return;

  if (platform.catalogProviderId !== undefined) {
    await connectCatalogProvider(
      ui,
      platform.catalogProviderId,
      catalog[platform.catalogProviderId],
      platform.name,
    );
    return;
  }

  await handleOpenPlatformLogin(ui, platform);
}

async function handlePythinkerCodeOAuthLogin(ui: LoginUi): Promise<void> {
  const status = await ui.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  ui.cancelInFlight = cancelLogin;
  try {
    await ui.harness.auth.login(DEFAULT_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      onDeviceCode: (data) => {
        spinner = ui.showLoginAuthorizationPrompt(data);
      },
    });
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;
    try {
      await ui.refreshConfigAfterLogin();
    } catch (refreshError) {
      const message = formatErrorMessage(refreshError);
      ui.showError(`Authentication successful, but failed to refresh config: ${message}`);
      return;
    }
    ui.track('login', {
      provider: DEFAULT_OAUTH_PROVIDER_NAME,
      already_logged_in: alreadyLoggedIn,
    });
    if (alreadyLoggedIn) {
      ui.showStatus('Already logged in. Model configuration refreshed.');
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    spinner?.stop({
      ok: false,
      label: cancelled ? 'Login cancelled.' : 'Login failed.',
    });
    spinner = undefined;
    if (cancelled) return;
    log.warn('login failed', {
      providerName: DEFAULT_OAUTH_PROVIDER_NAME,
      alreadyLoggedIn,
      sessionId: ui.sessionId,
      error,
    });
    const message = formatErrorMessage(error);
    ui.showError(`Login failed: ${message}`);
  } finally {
    if (ui.cancelInFlight === cancelLogin) {
      ui.cancelInFlight = undefined;
    }
  }
}

async function handleOpenPlatformLogin(
  ui: LoginUi,
  platform: OpenPlatformDefinition,
): Promise<void> {
  const platformName = platform.name;
  const subtitleLines = [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
  ];
  const apiKey = await ui.promptApiKey(platformName, subtitleLines);
  if (apiKey === undefined) return;

  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  ui.cancelInFlight = cancelLogin;

  let models: ManagedKimiCodeModelInfo[];
  try {
    models = await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal);
    models = filterModelsByPrefix(models, platform);
  } catch (error) {
    if (controller.signal.aborted) return;
    const msg = formatErrorMessage(error);
    ui.showError(`Failed to verify API key: ${msg}`);
    if (
      error instanceof OpenPlatformApiError &&
      error.status === 401
    ) {
      ui.showStatus(
        'Hint: If your API key was obtained from Pythinker OAuth, please select "Pythinker (OAuth)" instead.',
      );
    }
    return;
  } finally {
    if (ui.cancelInFlight === cancelLogin) {
      ui.cancelInFlight = undefined;
    }
  }

  if (models.length === 0) {
    ui.showError('No models available for this platform.');
    return;
  }

  const selection = await ui.promptModelSelectionForOpenPlatform(models, platform);
  if (selection === undefined) return;

  const existingConfig = await ui.harness.getConfig();
  if (existingConfig.providers[platform.id] !== undefined) {
    await ui.harness.removeProvider(platform.id);
  }

  const config = await ui.harness.getConfig();
  applyOpenPlatformConfig(config as ManagedKimiConfigShape, {
    platform,
    models,
    selectedModel: selection.model,
    thinking: selection.effort !== 'off',
    apiKey,
  });

  await ui.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: platform.id, method: 'api_key' });
  ui.showStatus(`Setup complete: ${platform.name} · ${selection.model.id}`);
}

export async function connectCatalogProvider(
  ui: LoginUi,
  providerId: string,
  selectedCatalogEntry?: CatalogProviderEntry,
  displayName?: string,
): Promise<void> {
  let catalogEntry = selectedCatalogEntry;
  if (catalogEntry === undefined) {
    const controller = new AbortController();
    const cancelLogin = (): void => {
      controller.abort();
    };
    ui.cancelInFlight = cancelLogin;
    try {
      const catalog = await fetchCatalog(DEFAULT_CATALOG_URL, controller.signal);
      catalogEntry = catalog[providerId];
    } catch (error) {
      if (controller.signal.aborted) return;
      ui.showError(`Failed to load model catalog: ${formatErrorMessage(error)}`);
      return;
    } finally {
      if (ui.cancelInFlight === cancelLogin) {
        ui.cancelInFlight = undefined;
      }
    }
  }

  if (catalogEntry === undefined) {
    ui.showError(`Catalog provider "${providerId}" was not found.`);
    return;
  }
  const wire = catalogConnectionWire(catalogEntry);
  if (wire === undefined) {
    ui.showError(`Catalog provider "${providerId}" is not supported for login.`);
    return;
  }

  const baseUrl = catalogBaseUrl(catalogEntry, wire);
  const platformName = displayName ?? catalogEntry.name ?? providerId;

  const apiKeyEnvVar = catalogEntry.env?.[0]?.trim();
  const envVarHasValue =
    apiKeyEnvVar !== undefined &&
    apiKeyEnvVar.length > 0 &&
    (process.env[apiKeyEnvVar]?.trim().length ?? 0) > 0;
  let apiKey: string | undefined;
  if (!envVarHasValue) {
    const subtitleLines = [
      ...(baseUrl === undefined ? [] : [`${'base_url'.padEnd(12)}${baseUrl}`]),
      `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
    ];
    apiKey = await ui.promptApiKey(platformName, subtitleLines);
    if (apiKey === undefined) return;
  }

  const models = catalogProviderModels(catalogEntry);
  if (models.length === 0) {
    ui.showError('No models available for this platform.');
    return;
  }

  const selection = await ui.promptModelSelectionForCatalog(providerId, models);
  if (selection === undefined) return;

  const existingConfig = await ui.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await ui.harness.removeProvider(providerId);
  }

  const config = await ui.harness.getConfig();
  applyCatalogProvider(config, {
    providerId,
    catalogUrl: DEFAULT_CATALOG_URL,
    wire,
    baseUrl,
    apiKey,
    apiKeyEnvVar: envVarHasValue ? apiKeyEnvVar : undefined,
    models,
    selectedModelId: selection.model.id,
    thinking: selection.effort !== 'off',
  });

  await ui.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: providerId, method: envVarHasValue ? 'api_key_env' : 'api_key' });
  ui.showStatus(`Setup complete: ${platformName} · ${selection.model.id}`);
}

async function handleOpenAICodexOAuthLogin(ui: LoginUi): Promise<void> {
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  ui.cancelInFlight = cancelLogin;

  ui.showStatus('Opening browser for OpenAI Codex sign-in…');
  const { openUrl } = await import('#/utils/open-url');

  let tokens;
  try {
    tokens = await runOpenAICodexOAuthFlow({
      signal: controller.signal,
      openBrowser: (url) => {
        ui.showStatus('Opening browser for OpenAI Codex sign-in…');
        openUrl(url);
      },
      onManualInput: async () =>
        ui.promptApiKey(
          'OpenAI Codex (OAuth)',
          [
            'Sign in with your ChatGPT account in the browser.',
            'If the browser callback fails, paste the full redirect URL here.',
          ],
          {
            title: 'Paste OpenAI Codex redirect URL',
            secret: false,
            emptyMessage: 'Redirect URL cannot be empty.',
          },
        ),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      ui.showStatus('OpenAI Codex login cancelled.');
      return;
    }
    ui.showError(`OpenAI Codex login failed: ${formatErrorMessage(error)}`);
    return;
  } finally {
    if (ui.cancelInFlight === cancelLogin) {
      ui.cancelInFlight = undefined;
    }
  }

  let models: ManagedKimiCodeModelInfo[];
  try {
    models = await fetchOpenAICodexModels({
      accessToken: tokens.accessToken,
      accountId: tokens.accountId,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    ui.showError(`Failed to list OpenAI Codex models: ${formatErrorMessage(error)}`);
    if (error instanceof OpenAICodexApiError && error.status === 401) {
      ui.showStatus('Hint: Sign in again with /login if your OpenAI Codex session expired.');
    }
    return;
  }

  if (models.length === 0) {
    ui.showError('No models available for OpenAI Codex.');
    return;
  }

  const codexPlatform: OpenPlatformDefinition = {
    id: OPENAI_CODEX_PROVIDER_ID,
    name: 'OpenAI Codex (OAuth)',
    defaultContextLength: 256_000,
  };
  const selection = await ui.promptModelSelectionForOpenPlatform(models, codexPlatform);
  if (selection === undefined) return;

  // Drop the previous provider only once the replacement is certain. Removing
  // it earlier loses the user's working config on any of the early returns
  // above — most easily by cancelling the model picker. Matches the ordering
  // in handleOpenPlatformLogin and connectCatalogProvider.
  const existingConfig = await ui.harness.getConfig();
  if (existingConfig.providers[OPENAI_CODEX_PROVIDER_ID] !== undefined) {
    await ui.harness.removeProvider(OPENAI_CODEX_PROVIDER_ID);
  }

  const config = await ui.harness.getConfig();
  applyOpenAICodexOAuthConfig(config as ManagedKimiConfigShape, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: tokens.accountId,
    models,
    selectedModel: selection.model,
    thinking: selection.effort !== 'off',
  });

  await ui.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
    thinking: config.thinking,
  });

  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: OPENAI_CODEX_OAUTH_PLATFORM_ID, method: 'oauth' });
  ui.showStatus(`Logged in to OpenAI Codex · ${selection.model.id}`);
}
