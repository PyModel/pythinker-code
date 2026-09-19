// @ts-nocheck
import {
  OAuthAccessDeniedError,
  OPENAI_CODEX_PROVIDER_ID,
  type PythinkerRegion,
} from '@pymodel/pythinker-code-oauth';
import { log, runLogin, type LoginUi } from '@pymodel/pythinker-code-sdk';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { PRODUCT_NAME } from '../constant/pythinker-tui';

import { formatErrorMessage } from '../utils/event-payload';
import {
  PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE,
  refreshPythinkerRegion,
} from '#/utils/region';
import type { LoginProgressSpinnerHandle } from '../types';
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
    refreshConfigAfterLogin: () => host.authFlow.refreshConfigAfterLogin(),
    track: (event, properties) => {
      host.track(event, properties);
    },
  };
}

export async function handleLoginCommand(host: SlashCommandHost): Promise<void> {
  const selection = await promptPlatformSelection(host);
  if (selection === undefined || selection === null) return;
  const platformId =
    typeof selection === 'string'
      ? selection
      : (selection as { readonly platformId?: string }).platformId;
  if (platformId === undefined || platformId === null || platformId === '') return;
  const catalog =
    typeof selection === 'string'
      ? {}
      : ((selection as { readonly catalog?: Record<string, unknown> }).catalog ?? {});
  const normalized = { platformId, catalog };

  if (platformId === 'pythinker-code' || platformId === PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE) {
    const region: PythinkerRegion = platformId === PYTHINKER_CODE_GLOBAL_PLATFORM_VALUE ? 'global' : 'mainland-cn';
    await handlePythinkerCodeOAuthLogin(host, region);
    return;
  }

  await runLogin(createLoginUi(host, normalized));
}

async function handlePythinkerCodeOAuthLogin(
  host: SlashCommandHost,
  region: PythinkerRegion,
): Promise<void> {
  const status = await host.harness.auth.status(DEVICE_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEVICE_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    // The facade maps region → profile hosts (env overrides keep priority);
    // 'mainland-cn' is passed explicitly too so switching back overrides a
    // persisted global login.
    await host.harness.auth.login(DEVICE_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      region,
      onDeviceCode: (data: any) => {
        spinner = host.showLoginAuthorizationPrompt(data);
      },
    });
    refreshPythinkerRegion();
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
      provider: DEVICE_OAUTH_PROVIDER_NAME,
      method: 'oauth',
      already_logged_in: alreadyLoggedIn,
    });
    if (alreadyLoggedIn) {
      host.showStatus('Already logged in. Model configuration refreshed.', 'success');
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const denied = error instanceof OAuthAccessDeniedError;
    spinner?.stop({
      ok: false,
      label: cancelled || denied ? 'Login cancelled.' : 'Login failed.',
    });
    spinner = undefined;
    if (cancelled) return;
    const message = formatErrorMessage(error);
    if (denied) {
      host.showError(`Login cancelled: ${message}`);
      return;
    }
    log.warn('login failed', {
      providerName: DEVICE_OAUTH_PROVIDER_NAME,
      alreadyLoggedIn,
      sessionId: host.session?.id,
      error,
    });
    host.showError(`Login failed: ${message}`);
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }
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
