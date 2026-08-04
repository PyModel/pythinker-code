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
  type ManagedPythinkerCodeModelInfo,
  type ManagedPythinkerConfigShape,
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
  type CatalogProviderEntry,
} from '@pythoughts/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { catalogProviderIdFromPlatformValue } from '../components/dialogs/platform-selector';
import { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME } from '../constant/pythinker-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { LoginProgressSpinnerHandle } from '../types';
import {
  promptApiKey,
  promptLogoutProviderSelection,
  promptModelSelectionForCatalog,
  promptModelSelectionForOpenPlatform,
  promptPlatformSelection,
} from './prompts';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Auth: login / logout
// ---------------------------------------------------------------------------

export async function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  const selection = await promptPlatformSelection(host);
  if (selection === undefined) return;
  const { platformId, catalog } = selection;

  const catalogProviderId = catalogProviderIdFromPlatformValue(platformId);
  if (catalogProviderId !== undefined) {
    await connectCatalogProvider(host, catalogProviderId, catalog[catalogProviderId]);
    return;
  }

  if (platformId === 'pythinker-code') {
    await handlePythinkerCodeOAuthLogin(host);
    return;
  }

  if (platformId === OPENAI_CODEX_OAUTH_PLATFORM_ID) {
    await handleOpenAICodexOAuthLogin(host);
    return;
  }

  const platform = getOpenPlatformById(platformId);
  if (platform === undefined) return;

  if (platform.catalogProviderId !== undefined) {
    await connectCatalogProvider(
      host,
      platform.catalogProviderId,
      catalog[platform.catalogProviderId],
      platform.name,
    );
    return;
  }

  await handleOpenPlatformLogin(host, platform);
}

async function handlePythinkerCodeOAuthLogin(host: SlashCommandHost): Promise<void> {
  const status = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    await host.harness.auth.login(DEFAULT_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      onDeviceCode: (data) => {
        spinner = host.showLoginAuthorizationPrompt(data);
      },
    });
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;
    try {
      await host.authFlow.refreshConfigAfterLogin();
    } catch (refreshError) {
      const message = formatErrorMessage(refreshError);
      host.showError(`Authentication successful, but failed to refresh config: ${message}`);
      return;
    }
    host.track('login', {
      provider: DEFAULT_OAUTH_PROVIDER_NAME,
      already_logged_in: alreadyLoggedIn,
    });
    if (alreadyLoggedIn) {
      host.showStatus('Already logged in. Model configuration refreshed.');
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
      sessionId: host.session?.id,
      error,
    });
    const message = formatErrorMessage(error);
    host.showError(`Login failed: ${message}`);
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }
}

async function handleOpenPlatformLogin(
  host: SlashCommandHost,
  platform: OpenPlatformDefinition,
): Promise<void> {
  const platformName = platform.name;
  const subtitleLines = [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
  ];
  const apiKey = await promptApiKey(host, platformName, subtitleLines);
  if (apiKey === undefined) return;

  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;

  let models: ManagedPythinkerCodeModelInfo[];
  try {
    models = await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal);
    models = filterModelsByPrefix(models, platform);
  } catch (error) {
    if (controller.signal.aborted) return;
    const msg = formatErrorMessage(error);
    host.showError(`Failed to verify API key: ${msg}`);
    if (
      error instanceof OpenPlatformApiError &&
      error.status === 401
    ) {
      host.showStatus(
        'Hint: If your API key was obtained from Kimi OAuth, please select "Kimi (OAuth)" instead.',
      );
    }
    return;
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }

  if (models.length === 0) {
    host.showError('No models available for this platform.');
    return;
  }

  const selection = await promptModelSelectionForOpenPlatform(host, models, platform);
  if (selection === undefined) return;

  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[platform.id] !== undefined) {
    await host.harness.removeProvider(platform.id);
  }

  const config = await host.harness.getConfig();
  applyOpenPlatformConfig(config as ManagedPythinkerConfigShape, {
    platform,
    models,
    selectedModel: selection.model,
    thinking: selection.effort !== 'off',
    apiKey,
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('login', { provider: platform.id, method: 'api_key' });
  host.showStatus(`Setup complete: ${platform.name} · ${selection.model.id}`);
}

export async function connectCatalogProvider(
  host: SlashCommandHost,
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
    host.cancelInFlight = cancelLogin;
    try {
      const catalog = await fetchCatalog(DEFAULT_CATALOG_URL, controller.signal);
      catalogEntry = catalog[providerId];
    } catch (error) {
      if (controller.signal.aborted) return;
      host.showError(`Failed to load model catalog: ${formatErrorMessage(error)}`);
      return;
    } finally {
      if (host.cancelInFlight === cancelLogin) {
        host.cancelInFlight = undefined;
      }
    }
  }

  if (catalogEntry === undefined) {
    host.showError(`Catalog provider "${providerId}" was not found.`);
    return;
  }
  const wire = catalogConnectionWire(catalogEntry);
  if (wire === undefined) {
    host.showError(`Catalog provider "${providerId}" is not supported for login.`);
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
    apiKey = await promptApiKey(host, platformName, subtitleLines);
    if (apiKey === undefined) return;
  }

  const models = catalogProviderModels(catalogEntry);
  if (models.length === 0) {
    host.showError('No models available for this platform.');
    return;
  }

  const selection = await promptModelSelectionForCatalog(host, providerId, models);
  if (selection === undefined) return;

  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }

  const config = await host.harness.getConfig();
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

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('login', { provider: providerId, method: envVarHasValue ? 'api_key_env' : 'api_key' });
  host.showStatus(`Setup complete: ${platformName} · ${selection.model.id}`);
}

async function handleOpenAICodexOAuthLogin(host: SlashCommandHost): Promise<void> {
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;

  host.showStatus('Opening browser for OpenAI Codex sign-in…');
  const { openUrl } = await import('#/utils/open-url');

  let tokens;
  try {
    tokens = await runOpenAICodexOAuthFlow({
      signal: controller.signal,
      openBrowser: (url) => {
        host.showStatus('Opening browser for OpenAI Codex sign-in…');
        openUrl(url);
      },
      onManualInput: async () =>
        promptApiKey(
          host,
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
      host.showStatus('OpenAI Codex login cancelled.');
      return;
    }
    host.showError(`OpenAI Codex login failed: ${formatErrorMessage(error)}`);
    return;
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }

  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[OPENAI_CODEX_PROVIDER_ID] !== undefined) {
    await host.harness.removeProvider(OPENAI_CODEX_PROVIDER_ID);
  }

  let models: ManagedPythinkerCodeModelInfo[];
  try {
    models = await fetchOpenAICodexModels({
      accessToken: tokens.accessToken,
      accountId: tokens.accountId,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    host.showError(`Failed to list OpenAI Codex models: ${formatErrorMessage(error)}`);
    if (error instanceof OpenAICodexApiError && error.status === 401) {
      host.showStatus('Hint: Sign in again with /login if your OpenAI Codex session expired.');
    }
    return;
  }

  if (models.length === 0) {
    host.showError('No models available for OpenAI Codex.');
    return;
  }

  const codexPlatform: OpenPlatformDefinition = {
    id: OPENAI_CODEX_PROVIDER_ID,
    name: 'OpenAI Codex (OAuth)',
    defaultContextLength: 256_000,
  };
  const selection = await promptModelSelectionForOpenPlatform(host, models, codexPlatform);
  if (selection === undefined) return;

  const config = await host.harness.getConfig();
  applyOpenAICodexOAuthConfig(config as ManagedPythinkerConfigShape, {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: tokens.accountId,
    models,
    selectedModel: selection.model,
    thinking: selection.effort !== 'off',
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
    thinking: config.thinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('login', { provider: OPENAI_CODEX_OAUTH_PLATFORM_ID, method: 'oauth' });
  host.showStatus(`Logged in to OpenAI Codex · ${selection.model.id}`);
}

export async function handleLogoutCommand(host: SlashCommandHost): Promise<void> {
  const oauthStatus = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const hasOAuthToken = oauthStatus.providers.some(
    (p) => p.providerName === DEFAULT_OAUTH_PROVIDER_NAME && p.hasToken,
  );
  const config = await host.harness.getConfig();
  const hasManagedRemnant =
    hasOAuthToken || config.providers[DEFAULT_OAUTH_PROVIDER_NAME] !== undefined;
  const apiKeyProviderIds = Object.keys(config.providers ?? {})
    .filter((id) => id !== DEFAULT_OAUTH_PROVIDER_NAME)
    .toSorted();

  const options: ChoiceOption[] = [];
  if (hasManagedRemnant) {
    options.push({
      value: DEFAULT_OAUTH_PROVIDER_NAME,
      label: PRODUCT_NAME,
      description: 'OAuth login',
    });
  }
  for (const id of apiKeyProviderIds) {
    const baseUrl = config.providers[id]?.baseUrl;
    options.push({
      value: id,
      label: id,
      description: typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : undefined,
    });
  }

  if (options.length === 0) {
    host.showStatus('Nothing to logout.');
    return;
  }

  const currentModel = host.state.appState.model.trim();
  const currentProvider = host.state.appState.availableModels[currentModel]?.provider;

  const target = await promptLogoutProviderSelection(host, options, currentProvider);
  if (target === undefined) return;

  if (target === DEFAULT_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
  } else {
    await host.harness.removeProvider(target);
  }

  if (target === currentProvider) {
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
  } else {
    const updated = await host.harness.getConfig({ reload: true });
    host.setAppState({
      availableModels: updated.models ?? {},
      availableProviders: updated.providers ?? {},
    });
  }

  host.track('logout', { provider: target });
  const label = target === DEFAULT_OAUTH_PROVIDER_NAME ? PRODUCT_NAME : target;
  host.showStatus(`Logged out from ${label}.`);
}
