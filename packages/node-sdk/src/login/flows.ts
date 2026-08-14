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
  type OpenPlatformDefinition,
  type PlatformConfigShape,
  type PlatformModelInfo,
} from '@pymodel/pythinker-code-oauth';
import {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogConnectionWire,
  catalogProviderModels,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  type CatalogProviderEntry,
} from '#/catalog';

import { formatErrorMessage } from '../error-format';
import { catalogProviderIdFromPlatformValue } from './platform-values';
import type { LoginUi } from './types';

// ---------------------------------------------------------------------------
// Login flows behind the LoginUi port (shared with non-TUI renderers)
// ---------------------------------------------------------------------------


/**
 * Run the provider picker and the selected provider's login flow.
 *
 * Resolves `true` only when credentials were written to config. Callers such as
 * `pythinker login` use that for their exit code, so it must never be inferred
 * from a side effect like telemetry: every early return here is a user
 * cancellation or a failure the flow already reported.
 */
export async function runLogin(ui: LoginUi): Promise<boolean> {
  const selection = await ui.promptPlatformSelection();
  if (selection === undefined) return false;
  const { platformId, catalog } = selection;

  const catalogProviderId = catalogProviderIdFromPlatformValue(platformId);
  if (catalogProviderId !== undefined) {
    return connectCatalogProvider(ui, catalogProviderId, catalog[catalogProviderId]);
  }


  if (platformId === OPENAI_CODEX_OAUTH_PLATFORM_ID) {
    return handleOpenAICodexOAuthLogin(ui);
  }

  const platform = getOpenPlatformById(platformId);
  if (platform === undefined) return false;

  if (platform.catalogProviderId !== undefined) {
    return connectCatalogProvider(
      ui,
      platform.catalogProviderId,
      catalog[platform.catalogProviderId],
      platform.name,
    );
  }

  return handleOpenPlatformLogin(ui, platform);
}

async function handleOpenPlatformLogin(
  ui: LoginUi,
  platform: OpenPlatformDefinition,
): Promise<boolean> {
  const platformName = platform.name;
  const subtitleLines = [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
  ];
  const apiKey = await ui.promptApiKey(platformName, subtitleLines);
  if (apiKey === undefined) return false;

  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  ui.cancelInFlight = cancelLogin;

  let models: PlatformModelInfo[];
  try {
    models = await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal);
    models = filterModelsByPrefix(models, platform);
  } catch (error) {
    if (controller.signal.aborted) return false;
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
    return false;
  } finally {
    if (ui.cancelInFlight === cancelLogin) {
      ui.cancelInFlight = undefined;
    }
  }

  if (models.length === 0) {
    ui.showError('No models available for this platform.');
    return false;
  }

  const selection = await ui.promptModelSelectionForOpenPlatform(models, platform);
  if (selection === undefined) return false;

  const existingConfig = await ui.harness.getConfig();
  if (existingConfig.providers[platform.id] !== undefined) {
    await ui.harness.removeProvider(platform.id);
  }

  const config = await ui.harness.getConfig();
  applyOpenPlatformConfig(config as PlatformConfigShape, {
    platform,
    models,
    selectedModel: selection.model,
    thinking: selection.effort !== 'off',
    effort: selection.effort,
    apiKey,
  });

  await ui.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
    // `applyOpenPlatformConfig` writes the picked effort here. Leaving it out of
    // the patch dropped it, so only the on/off bit ever reached disk.
    thinking: config.thinking,
  });

  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: platform.id, method: 'api_key' });
  ui.showStatus(`Setup complete: ${platform.name} · ${selection.model.id}`);
  return true;
}

export async function connectCatalogProvider(
  ui: LoginUi,
  providerId: string,
  selectedCatalogEntry?: CatalogProviderEntry,
  displayName?: string,
): Promise<boolean> {
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
      if (controller.signal.aborted) return false;
      ui.showError(`Failed to load model catalog: ${formatErrorMessage(error)}`);
      return false;
    } finally {
      if (ui.cancelInFlight === cancelLogin) {
        ui.cancelInFlight = undefined;
      }
    }
  }

  if (catalogEntry === undefined) {
    ui.showError(`Catalog provider "${providerId}" was not found.`);
    return false;
  }
  const wire = catalogConnectionWire(catalogEntry);
  if (wire === undefined) {
    ui.showError(`Catalog provider "${providerId}" is not supported for login.`);
    return false;
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
    if (apiKey === undefined) return false;
  }

  const models = catalogProviderModels(catalogEntry);
  if (models.length === 0) {
    ui.showError('No models available for this platform.');
    return false;
  }

  const selection = await ui.promptModelSelectionForCatalog(providerId, models);
  if (selection === undefined) return false;

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
    effort: selection.effort,
  });

  await ui.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
    // `applyCatalogProvider` writes the picked effort here. Leaving it out of
    // the patch dropped it, so only the on/off bit ever reached disk.
    thinking: config.thinking,
  });

  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: providerId, method: envVarHasValue ? 'api_key_env' : 'api_key' });
  ui.showStatus(`Setup complete: ${platformName} · ${selection.model.id}`);
  return true;
}

async function handleOpenAICodexOAuthLogin(ui: LoginUi): Promise<boolean> {
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  ui.cancelInFlight = cancelLogin;
  // Stay armed for the whole flow: the model fetch and the model picker
  // below are cancellable too, and disarming here left SIGINT with
  // nothing to abort.
  try {

    ui.showStatus('Opening browser for OpenAI Codex sign-in…');

    let tokens;
    try {
      tokens = await runOpenAICodexOAuthFlow({
        signal: controller.signal,
        openBrowser: (url) => {
          ui.showStatus('Opening browser for OpenAI Codex sign-in…');
          ui.openBrowser(url);
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
        return false;
      }
      ui.showError(`OpenAI Codex login failed: ${formatErrorMessage(error)}`);
      return false;
    }

    let models: PlatformModelInfo[];
    try {
      models = await fetchOpenAICodexModels({
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return false;
      ui.showError(`Failed to list OpenAI Codex models: ${formatErrorMessage(error)}`);
      if (error instanceof OpenAICodexApiError && error.status === 401) {
        ui.showStatus('Hint: Sign in again with /login if your OpenAI Codex session expired.');
      }
      return false;
    }

    if (models.length === 0) {
      ui.showError('No models available for OpenAI Codex.');
      return false;
    }

    const codexPlatform: OpenPlatformDefinition = {
      id: OPENAI_CODEX_PROVIDER_ID,
      name: 'OpenAI Codex (OAuth)',
      defaultContextLength: 256_000,
    };
    const selection = await ui.promptModelSelectionForOpenPlatform(models, codexPlatform);
    if (selection === undefined) return false;
    // Ctrl-C while the picker was open aborts the flow; the picker may still
    // resolve with a value, and an aborted login must not write credentials.
    if (controller.signal.aborted) return false;

    // Drop the previous provider only once the replacement is certain. Removing
    // it earlier loses the user's working config on any of the early returns
    // above — most easily by cancelling the model picker. Matches the ordering
    // in handleOpenPlatformLogin and connectCatalogProvider.
    const existingConfig = await ui.harness.getConfig();
    if (existingConfig.providers[OPENAI_CODEX_PROVIDER_ID] !== undefined) {
      await ui.harness.removeProvider(OPENAI_CODEX_PROVIDER_ID);
    }

    const config = await ui.harness.getConfig();
    applyOpenAICodexOAuthConfig(config as PlatformConfigShape, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      models,
      selectedModel: selection.model,
      thinking: selection.effort !== 'off',
      effort: selection.effort,
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
    return true;
  } finally {
    if (ui.cancelInFlight === cancelLogin) {
      ui.cancelInFlight = undefined;
    }
  }
}
