import {
  connectCatalogProvider as connectCatalogProviderFlow,
  runLogin,
  type LoginUi,
} from '#/auth/login-flows';
import type { CatalogProviderEntry } from '@pythoughts/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME } from '../constant/pythinker-tui';
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

function loginUiFromHost(host: SlashCommandHost): LoginUi {
  return {
    harness: host.harness,
    sessionId: host.session?.id,
    get cancelInFlight() {
      return host.cancelInFlight;
    },
    set cancelInFlight(cancelInFlight: (() => void) | undefined) {
      host.cancelInFlight = cancelInFlight;
    },
    showStatus: (message, level) => {
      host.showStatus(message, level);
    },
    showError: (message) => {
      host.showError(message);
    },
    showLoginProgressSpinner: (label) => host.showLoginProgressSpinner(label),
    showLoginAuthorizationPrompt: (auth) => host.showLoginAuthorizationPrompt(auth),
    promptPlatformSelection: () => promptPlatformSelection(host),
    promptApiKey: (platformName, subtitleLines, options) =>
      options === undefined
        ? promptApiKey(host, platformName, subtitleLines)
        : promptApiKey(host, platformName, subtitleLines, options),
    promptModelSelectionForOpenPlatform: (models, platform) =>
      promptModelSelectionForOpenPlatform(host, models, platform),
    promptModelSelectionForCatalog: (providerId, models) =>
      promptModelSelectionForCatalog(host, providerId, models),
    refreshConfigAfterLogin: () => host.authFlow.refreshConfigAfterLogin(),
    track: (event, props) => {
      host.track(event, props);
    },
  };
}

export function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  return runLogin(loginUiFromHost(host));
}

export function connectCatalogProvider(
  host: SlashCommandHost,
  providerId: string,
  selectedCatalogEntry?: CatalogProviderEntry,
  displayName?: string,
): Promise<void> {
  return connectCatalogProviderFlow(
    loginUiFromHost(host),
    providerId,
    selectedCatalogEntry,
    displayName,
  );
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
