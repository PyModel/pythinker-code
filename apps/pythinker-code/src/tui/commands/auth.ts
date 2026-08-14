import {
  connectCatalogProvider as connectCatalogProviderFlow,
  runLogin,
  type CatalogProviderEntry,
  type LoginUi,
} from '@pymodel/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import {
  promptApiKey,
  promptLogoutProviderSelection,
  promptModelSelectionForCatalog,
  promptModelSelectionForOpenPlatform,
  promptPlatformSelection,
} from './prompts';
import { openUrl } from '#/utils/open-url';

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
    openBrowser: (url) => {
      openUrl(url);
    },
    showStatus: (message) => {
      host.showStatus(message);
    },
    showError: (message) => {
      host.showError(message);
    },
    showLoginProgressSpinner: (label) => host.showLoginProgressSpinner(label),
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

export async function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  await runLogin(loginUiFromHost(host));
}

export async function connectCatalogProvider(
  host: SlashCommandHost,
  providerId: string,
  selectedCatalogEntry?: CatalogProviderEntry,
  displayName?: string,
): Promise<void> {
  await connectCatalogProviderFlow(
    loginUiFromHost(host),
    providerId,
    selectedCatalogEntry,
    displayName,
  );
}

export async function handleLogoutCommand(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig();
  const providerIds = Object.keys(config.providers ?? {}).toSorted();

  const options: ChoiceOption[] = [];
  for (const id of providerIds) {
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

  await host.harness.removeProvider(target);

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
  host.showStatus(`Logged out from ${target}.`);
}
