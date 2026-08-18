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
  type OpenAICodexModelInfo,
  type OpenPlatformDefinition,
} from '@pymodel/pythinker-code-oauth';

import {
  catalogProviderModels,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  importCatalogProvider,
  resolveCatalogImport,
  type CatalogProviderEntry,
} from '#/catalog';
import type { PythinkerConfig } from '#/types';

import { formatErrorMessage } from '../error-format';
import { catalogProviderIdFromPlatformValue } from './platform-values';
import type { LoginUi } from './types';

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
  return platform === undefined ? false : handleOpenPlatformLogin(ui, platform);
}

async function handleOpenPlatformLogin(
  ui: LoginUi,
  platform: OpenPlatformDefinition,
): Promise<boolean> {
  const apiKey = await ui.promptApiKey(platform.name, [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
  ]);
  if (apiKey === undefined) return false;

  const controller = new AbortController();
  let committing = false;
  const cancelLogin = (): void => {
    if (!committing) controller.abort();
  };
  ui.cancelInFlight = cancelLogin;
  try {
    let models: ManagedPythinkerCodeModelInfo[];
    try {
      models = filterModelsByPrefix(
        await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal),
        platform,
      );
    } catch (error) {
      if (controller.signal.aborted) return false;
      ui.showError(`Failed to verify API key: ${formatErrorMessage(error)}`);
      if (error instanceof OpenPlatformApiError && error.status === 401) {
        ui.showStatus('The provider rejected this API key.');
      }
      return false;
    }
    if (models.length === 0) {
      ui.showError('No models available for this platform.');
      return false;
    }

    const picked = await ui.promptModelSelectionForOpenPlatform(models, platform);
    if (picked === undefined) return false;
    const selectedModel = models.find((model) => model.id === picked.model.id);
    if (selectedModel === undefined) return false;

    controller.signal.throwIfAborted();
    const current = await ui.harness.getConfig({ reload: true });
    controller.signal.throwIfAborted();
    const next = cloneConfig(current);
    applyOpenPlatformConfig(next as ManagedPythinkerConfigShape, {
      platform,
      models,
      selectedModel,
      thinking: picked.effort !== 'off',
      effort: picked.effort === 'off' || picked.effort === 'on' ? undefined : picked.effort,
      apiKey,
    });
    committing = true;
    await ui.harness.replaceConfigSections({
      providers: next.providers,
      models: next.models,
      defaultModel: next.defaultModel,
      thinking: next.thinking,
    });
    await ui.refreshConfigAfterLogin();
    ui.track('login', { provider: platform.id, method: 'api_key' });
    ui.showStatus(`Setup complete: ${platform.name} · ${selectedModel.id}`);
    return true;
  } finally {
    if (ui.cancelInFlight === cancelLogin) ui.cancelInFlight = undefined;
  }
}

export async function connectCatalogProvider(
  ui: LoginUi,
  providerId: string,
  selectedCatalogEntry?: CatalogProviderEntry,
): Promise<boolean> {
  let entry = selectedCatalogEntry;
  if (entry === undefined) {
    const controller = new AbortController();
    const cancelLogin = (): void => controller.abort();
    ui.cancelInFlight = cancelLogin;
    try {
      entry = (await fetchCatalog(DEFAULT_CATALOG_URL, { signal: controller.signal }))[providerId];
    } catch (error) {
      if (controller.signal.aborted) return false;
      ui.showError(`Failed to load model catalog: ${formatErrorMessage(error)}`);
      return false;
    } finally {
      if (ui.cancelInFlight === cancelLogin) ui.cancelInFlight = undefined;
    }
  }
  if (entry === undefined || resolveCatalogImport(entry).kind !== 'ok') {
    ui.showError(`Catalog provider "${providerId}" is not available for direct import.`);
    return false;
  }

  const apiKey = await ui.promptApiKey(entry.name ?? providerId, [
    `${'saved to'.padEnd(12)}~/.pythinker-code/config.toml`,
  ]);
  if (apiKey === undefined) return false;
  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    ui.showError('No models available for this platform.');
    return false;
  }
  const picked = await ui.promptModelSelectionForCatalog(providerId, models);
  if (picked === undefined) return false;

  await importCatalogProvider(ui.harness, {
    providerId,
    entry,
    catalogUrl: DEFAULT_CATALOG_URL,
    apiKey,
    defaultModel: picked.model.id,
    thinking: picked.effort !== 'off',
    effort: picked.effort === 'off' || picked.effort === 'on' ? undefined : picked.effort,
  });
  await ui.refreshConfigAfterLogin();
  ui.track('login', { provider: providerId, method: 'api_key' });
  ui.showStatus(`Setup complete: ${entry.name ?? providerId} · ${picked.model.id}`);
  return true;
}

async function handleOpenAICodexOAuthLogin(ui: LoginUi): Promise<boolean> {
  const controller = new AbortController();
  let committing = false;
  const cancelLogin = (): void => {
    if (!committing) controller.abort();
  };
  ui.cancelInFlight = cancelLogin;
  try {
    let tokens;
    try {
      tokens = await runOpenAICodexOAuthFlow({
        signal: controller.signal,
        openBrowser: (url) => ui.openBrowser(url),
        onManualInput: () =>
          ui.promptApiKey(
            'OpenAI Codex (OAuth)',
            [
              'Sign in with your ChatGPT account in the browser.',
              'If the callback fails, paste the full redirect URL here.',
            ],
            {
              title: 'Paste OpenAI Codex redirect URL',
              secret: false,
              emptyMessage: 'Redirect URL cannot be empty.',
            },
          ),
      });
    } catch (error) {
      if (controller.signal.aborted) return false;
      ui.showError(`OpenAI Codex login failed: ${formatErrorMessage(error)}`);
      return false;
    }

    let models: OpenAICodexModelInfo[];
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
        ui.showStatus('Sign in again if your OpenAI Codex session expired.');
      }
      return false;
    }
    if (models.length === 0) {
      ui.showError('No models available for OpenAI Codex.');
      return false;
    }

    const picked = await ui.promptModelSelectionForOpenPlatform(models, {
      id: OPENAI_CODEX_PROVIDER_ID,
      name: 'OpenAI Codex (OAuth)',
    });
    if (picked === undefined) return false;
    const selectedModel = models.find((model) => model.id === picked.model.id);
    if (selectedModel === undefined) return false;

    controller.signal.throwIfAborted();
    const current = await ui.harness.getConfig({ reload: true });
    controller.signal.throwIfAborted();
    const next = cloneConfig(current);
    applyOpenAICodexOAuthConfig(next, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      models,
      selectedModel,
      thinking: picked.effort !== 'off',
      effort: picked.effort === 'off' || picked.effort === 'on' ? undefined : picked.effort,
    });
    committing = true;
    await ui.harness.replaceConfigSections({
      providers: next.providers,
      models: next.models,
      defaultModel: next.defaultModel,
      thinking: next.thinking,
    });
    await ui.refreshConfigAfterLogin();
    ui.track('login', { provider: OPENAI_CODEX_PROVIDER_ID, method: 'oauth' });
    ui.showStatus(`Setup complete: OpenAI Codex · ${selectedModel.id}`);
    return true;
  } finally {
    if (ui.cancelInFlight === cancelLogin) ui.cancelInFlight = undefined;
  }
}

function cloneConfig(config: PythinkerConfig): PythinkerConfig {
  return {
    ...config,
    providers: { ...config.providers },
    models: { ...config.models },
  };
}
