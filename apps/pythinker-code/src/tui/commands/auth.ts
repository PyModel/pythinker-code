import {
  OPENAI_CODEX_PROVIDER_ID,
  type OpenAICodexModelInfo,
  type OpenPlatformDefinition,
  type ProviderModelInfo,
} from '@pymodel/pythinker-code-oauth';
import {
  runLogin,
  type LoginPlatformDefinition,
  type LoginPlatformModelInfo,
  type LoginUi,
} from '@pymodel/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
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

// ---------------------------------------------------------------------------
// Auth: login / logout
// ---------------------------------------------------------------------------

export async function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  const ui: LoginUi = {
    harness: host.harness,
    get cancelInFlight() {
      return host.cancelInFlight;
    },
    set cancelInFlight(value) {
      host.cancelInFlight = value;
    },
    openBrowser: openUrl,
    showStatus: (message): void => {
      host.showStatus(message);
    },
    showError: (message): void => {
      host.showError(message);
    },
    showLoginProgressSpinner: (label) => host.showLoginProgressSpinner(label),
    promptPlatformSelection: () => promptPlatformSelection(host),
    promptApiKey: (platformName, subtitleLines, options) =>
      promptApiKey(host, platformName, subtitleLines, {
        title: options?.title,
        mask: options?.secret !== false,
        emptyHint: options?.emptyMessage,
      }),
    promptModelSelectionForOpenPlatform: (models, platform) =>
      promptLoginPlatformModel(host, models, platform),
    promptModelSelectionForCatalog: async (providerId, models) => {
      const selection = await promptModelSelectionForCatalog(host, providerId, models);
      return selection === undefined
        ? undefined
        : { model: selection.model, effort: selection.thinking };
    },
    refreshConfigAfterLogin: () => host.authFlow.refreshConfigAfterLogin(),
    track: (event, properties): void => {
      host.track(event, properties);
    },
  };
  try {
    await runLogin(ui);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return;
    host.showError(`Login failed: ${formatErrorMessage(error)}`);
  }
}

async function promptLoginPlatformModel(
  host: SlashCommandHost,
  models: LoginPlatformModelInfo[],
  platform: LoginPlatformDefinition,
): Promise<{ model: LoginPlatformModelInfo; effort: string } | undefined> {
  if (platform.id === OPENAI_CODEX_PROVIDER_ID) {
    const selection = await promptModelSelectionForCodex(
      host,
      models as OpenAICodexModelInfo[],
    );
    return selection === undefined
      ? undefined
      : { model: selection.model, effort: selection.thinking };
  }
  const selection = await promptModelSelectionForOpenPlatform(
    host,
    models as ProviderModelInfo[],
    platform as OpenPlatformDefinition,
  );
  return selection === undefined
    ? undefined
    : { model: selection.model, effort: selection.thinking };
}

export async function handleLogoutCommand(host: SlashCommandHost): Promise<void> {
  const config = await host.harness.getConfig();
  const options: ChoiceOption[] = [];
  for (const id of Object.keys(config.providers ?? {}).toSorted()) {
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
