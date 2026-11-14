import { OPENAI_CODEX_PROVIDER_ID } from '@pymodel/pythinker-code-oauth';
import { runLogin, type LoginUi } from '@pymodel/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { PRODUCT_NAME } from '../constant/pythinker-tui';

import { refreshPythinkerRegion } from '#/utils/region';
import {
  promptApiKey,
  promptLogoutProviderSelection,
  promptModelSelectionForCatalog,
  promptModelSelectionForCodex,
  promptModelSelectionForOpenPlatform,
  promptPlatformSelection,
} from './prompts';
import { openUrl } from '#/utils/open-url';
import type { SlashCommandHost } from './dispatch';

const DEVICE_OAUTH_PROVIDER_NAME = 'openai';

// ---------------------------------------------------------------------------
// Auth: login / logout
// ---------------------------------------------------------------------------

function createLoginUi(
  host: SlashCommandHost,
  selection: { readonly platformId: string; readonly catalog: Record<string, unknown> },
): LoginUi {
  return {
    harness: host.harness as LoginUi['harness'],
    get cancelInFlight() {
      return host.cancelInFlight;
    },
    set cancelInFlight(value) {
      host.cancelInFlight = value;
    },
    openBrowser: (url) => openUrl(url),
    showStatus: (message) => {
      host.showStatus(message);
    },
    showError: (message) => {
      host.showError(message);
    },
    showLoginProgressSpinner: (label) => host.showLoginProgressSpinner(label),
    promptPlatformSelection: async () => selection as never,
    promptApiKey: (platformName, subtitleLines, options) =>
      promptApiKey(host, platformName, subtitleLines, {
        title: options?.title,
        mask: options?.secret !== false,
        emptyHint: options?.emptyMessage,
      }),
    promptModelSelectionForOpenPlatform: async (models, platform) => {
      if (platform.id === OPENAI_CODEX_PROVIDER_ID) {
        const picked = await promptModelSelectionForCodex(host, models as never);
        if (picked === undefined) return undefined;
        return { model: picked.model, effort: picked.thinking };
      }
      const picked = await promptModelSelectionForOpenPlatform(host, models as never, platform as never);
      if (picked === undefined) return undefined;
      return { model: picked.model, effort: picked.thinking };
    },
    promptModelSelectionForCatalog: async (providerId, models) => {
      const picked = await promptModelSelectionForCatalog(host, providerId, models);
      if (picked === undefined) return undefined;
      return { model: picked.model, effort: picked.thinking };
    },
    refreshConfigAfterLogin: async () => {
      await host.authFlow.refreshConfigAfterLogin();
    },
    track: (event, properties) => {
      host.track(event, properties);
    },
  };
}

export async function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  const selection = await promptPlatformSelection(host);
  if (selection === undefined || selection.platformId === '') return;
  await runLogin(createLoginUi(host, selection));
}


export async function handleLogoutCommand(host: SlashCommandHost): Promise<void> {
  const oauthStatus = await host.harness.auth.status(DEVICE_OAUTH_PROVIDER_NAME);
  const hasOAuthToken = oauthStatus.providers.some(
    (p) => p.providerName === DEVICE_OAUTH_PROVIDER_NAME && p.hasToken,
  );
  const config = await host.harness.getConfig();
  const hasManagedRemnant =
    hasOAuthToken || config.providers[DEVICE_OAUTH_PROVIDER_NAME] !== undefined;
  const apiKeyProviderIds = Object.keys(config.providers ?? {})
    .filter((id) => id !== DEVICE_OAUTH_PROVIDER_NAME)
    .toSorted();

  const options: ChoiceOption[] = [];
  if (hasManagedRemnant) {
    options.push({
      value: DEVICE_OAUTH_PROVIDER_NAME,
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

  if (target === DEVICE_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEVICE_OAUTH_PROVIDER_NAME);
  } else {
    await host.harness.removeProvider(target);
  }

  if (target === currentProvider) {
    await host.authFlow.refreshConfigAfterLogout();
  } else {
    const updated = await host.harness.getConfig({ reload: true });
    host.setAppState({
      availableModels: updated.models ?? {},
      availableProviders: updated.providers ?? {},
    });
  }
  refreshPythinkerRegion();

  host.track('logout', { provider: target });
  const label = target === DEVICE_OAUTH_PROVIDER_NAME ? PRODUCT_NAME : target;
  host.showStatus(`Logged out from ${label}.`);
}
