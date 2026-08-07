/**
 * Terminal renderer for the multi-provider login flows (`runLogin` from
 * `@pythoughts/pythinker-code-sdk`).
 *
 * `pythinker login` (and `pythinker acp --login`) build a `LoginUi` backed by
 * `@clack/prompts`: the provider picker, API-key / redirect-URL input, model
 * and effort selection, and the OAuth device-code spinner. Catalog resolution
 * mirrors the TUI's `promptPlatformSelection` — bundled catalog first, live
 * fetch with a bundled fallback, so login still works offline.
 *
 * `--provider <id|name>` skips the picker: the option is resolved against the
 * same `buildPlatformOptions` list the picker renders, and a non-matching
 * value fails loudly instead of falling back to any default provider.
 */

import { isCancel, log, password, select, spinner, text } from '@clack/prompts';
import {
  capabilitiesForModel,
  type DeviceAuthorization,
  type ManagedKimiCodeModelInfo,
  type OpenPlatformDefinition,
} from '@pythoughts/pythinker-code-oauth';
import {
  buildPlatformOptions,
  catalogModelToAlias,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  formatErrorMessage,
  loadBuiltInCatalog,
  resolvePlatformOption,
  type ApiKeyPromptOptions,
  type CatalogModel,
  type LoginProgressSpinnerHandle,
  type LoginUi,
  type ModelAlias,
  type PlatformSelection,
  type PythinkerHarness,
} from '@pythoughts/pythinker-code-sdk';

import { BUILT_IN_CATALOG_JSON } from '#/built-in-catalog';
import type { ColorToken } from '#/tui/theme';
import { coerceEffortForModel, effortLevelsForModel } from '#/tui/utils/thinking-levels';
import { openUrl } from '#/utils/open-url';

/** Thrown when `--provider` does not match any platform id or display name. */
export class UnknownProviderError extends Error {
  constructor(
    readonly input: string,
    readonly validIds: readonly string[],
  ) {
    super(`Unknown provider "${input}"`);
    this.name = 'UnknownProviderError';
  }
}

export type TerminalLoginUi = LoginUi;

export function createTerminalLoginUi(
  harness: PythinkerHarness,
  options: { readonly provider?: string | undefined } = {},
): TerminalLoginUi {
  const { provider } = options;
  let cancelInFlight: (() => void) | undefined;

  function showStatus(message: string, level?: ColorToken): void {
    if (level === 'error') {
      log.error(message);
    } else if (level === 'warning') {
      log.warn(message);
    } else {
      log.info(message);
    }
  }

  function showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    const clackSpinner = spinner();
    clackSpinner.start(label);
    return {
      stop({ ok, label: finalLabel }) {
        if (ok) {
          // clack's spinner.stop renders the success tone.
          clackSpinner.stop(finalLabel);
        } else if (clackSpinner.isCancelled) {
          // SIGINT already cancelled the spinner — clack rendered its own
          // "Canceled" line — so keep the flow's label visible to preserve
          // the "Login cancelled." / "Login failed." message style.
          log.error(finalLabel);
        } else {
          clackSpinner.error(finalLabel);
        }
      },
    };
  }

  function showLoginAuthorizationPrompt(auth: DeviceAuthorization): LoginProgressSpinnerHandle {
    const url = auth.verificationUriComplete || auth.verificationUri;
    // Print the manual fallback before attempting to open the user's browser
    // so headless/browser-opener failures never hide the URL and code needed
    // to complete login.
    log.info(`Go to: ${url}`);
    log.info(`Enter code: ${auth.userCode}`);
    try {
      openUrl(url);
    } catch {
      // Best effort only: the manual fallback has already been printed.
    }
    return showLoginProgressSpinner('Waiting for authorization…');
  }

  async function promptPlatformSelection(): Promise<PlatformSelection | undefined> {
    let catalog = loadBuiltInCatalog(BUILT_IN_CATALOG_JSON) ?? {};
    const controller = new AbortController();
    const cancel = (): void => {
      controller.abort();
    };
    cancelInFlight = cancel;
    const catalogSpinner = showLoginProgressSpinner('Loading provider catalog');
    try {
      catalog = await fetchCatalog(DEFAULT_CATALOG_URL, controller.signal);
      catalogSpinner.stop({ ok: true, label: 'Provider catalog loaded.' });
    } catch (error) {
      if (controller.signal.aborted) {
        catalogSpinner.stop({ ok: false, label: 'Aborted.' });
        log.info('Login cancelled.');
        return undefined;
      }
      catalogSpinner.stop({ ok: false, label: 'Using bundled provider catalog.' });
      showStatus(`Live provider catalog unavailable: ${formatErrorMessage(error)}`, 'warning');
    } finally {
      if (cancelInFlight === cancel) cancelInFlight = undefined;
    }

    const options = buildPlatformOptions(catalog);
    if (provider !== undefined) {
      const resolved = resolvePlatformOption(options, provider);
      if (resolved === undefined) {
        throw new UnknownProviderError(provider, options.map((option) => option.value));
      }
      return { platformId: resolved.value, catalog };
    }

    const selected = await select({
      message: 'Select a provider',
      options: options.map((option) => ({
        value: option.value,
        label: option.label,
        hint: option.description,
      })),
    });
    if (isCancel(selected)) {
      log.info('Login cancelled.');
      return undefined;
    }
    return { platformId: selected, catalog };
  }

  async function promptApiKey(
    platformName: string,
    subtitleLines?: readonly string[],
    promptOptions: ApiKeyPromptOptions = {},
  ): Promise<string | undefined> {
    for (const line of subtitleLines ?? []) {
      log.info(line);
    }
    const message = promptOptions.title ?? `Enter API key for ${platformName}`;
    const emptyMessage = promptOptions.emptyMessage ?? 'API key cannot be empty.';
    const validate = (value: string | undefined): string | undefined =>
      value === undefined || value.length === 0 ? emptyMessage : undefined;
    const result =
      promptOptions.secret === false
        ? await text({ message, validate })
        : await password({ message, validate });
    if (isCancel(result)) {
      log.info('Login cancelled.');
      return undefined;
    }
    return result;
  }

  async function selectModelAndEffort(
    modelDict: Record<string, ModelAlias>,
  ): Promise<{ alias: string; effort: string } | undefined> {
    const aliases = Object.keys(modelDict);
    const selected = await select({
      message: 'Select a model',
      options: aliases.map((alias) => ({
        value: alias,
        label: modelDict[alias]?.displayName ?? modelDict[alias]?.model ?? alias,
      })),
    });
    if (isCancel(selected)) {
      log.info('Login cancelled.');
      return undefined;
    }
    // Same default the TUI's model selector starts from: the first supported
    // level, coerced against what the model actually supports.
    const model = modelDict[selected];
    const levels = effortLevelsForModel(model);
    const initialEffort = coerceEffortForModel(
      model,
      levels.find((level) => level !== 'off') ?? 'off',
    );
    const effort = await select({
      message: 'Select effort level',
      options: levels.map((level) => ({ value: level, label: level })),
      initialValue: initialEffort,
    });
    if (isCancel(effort)) {
      log.info('Login cancelled.');
      return undefined;
    }
    return { alias: selected, effort };
  }

  async function promptModelSelectionForOpenPlatform(
    models: readonly ManagedKimiCodeModelInfo[],
    platform: OpenPlatformDefinition,
  ): Promise<{ model: ManagedKimiCodeModelInfo; effort: string } | undefined> {
    const modelDict: Record<string, ModelAlias> = {};
    for (const m of models) {
      modelDict[`${platform.id}/${m.id}`] = {
        provider: platform.id,
        model: m.id,
        maxContextSize: m.contextLength,
        capabilities: capabilitiesForModel(m),
        displayName: m.displayName,
      };
    }
    const selection = await selectModelAndEffort(modelDict);
    if (selection === undefined) return undefined;
    const model = models.find((m) => `${platform.id}/${m.id}` === selection.alias);
    return model === undefined ? undefined : { model, effort: selection.effort };
  }

  async function promptModelSelectionForCatalog(
    providerId: string,
    models: readonly CatalogModel[],
  ): Promise<{ model: CatalogModel; effort: string } | undefined> {
    const modelDict: Record<string, ModelAlias> = {};
    for (const m of models) {
      modelDict[`${providerId}/${m.id}`] = catalogModelToAlias(providerId, m);
    }
    const selection = await selectModelAndEffort(modelDict);
    if (selection === undefined) return undefined;
    const model = models.find((m) => `${providerId}/${m.id}` === selection.alias);
    return model === undefined ? undefined : { model, effort: selection.effort };
  }

  const ui: TerminalLoginUi = {
    harness,
    get cancelInFlight() {
      return cancelInFlight;
    },
    set cancelInFlight(value: (() => void) | undefined) {
      cancelInFlight = value;
    },
    openBrowser(url: string): void {
      openUrl(url);
    },
    showStatus,
    showError(message: string): void {
      log.error(message);
    },
    showLoginProgressSpinner,
    showLoginAuthorizationPrompt,
    promptPlatformSelection,
    promptApiKey,
    promptModelSelectionForOpenPlatform,
    promptModelSelectionForCatalog,
    async refreshConfigAfterLogin() {
      // No live TUI session to refresh: the config on disk is already current.
    },
    track() {
      // No CLI telemetry sink yet. Success is reported by runLogin's return
      // value, never inferred from a telemetry call.
    },
  };
  return ui;
}
