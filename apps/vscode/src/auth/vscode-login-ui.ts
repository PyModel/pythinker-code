/**
 * VS Code renderer for the multi-provider login flows (`runLogin` from
 * `@pythoughts/pythinker-code-sdk`).
 *
 * The extension host builds a `LoginUi` backed by VS Code's own UI: the
 * provider picker, API-key input box, model and effort selection, and the
 * OAuth device-code prompt are rendered with `vscode.window` widgets, and
 * browsers open through `vscode.env.openExternal` instead of shelling out.
 * Catalog resolution mirrors the terminal renderer's
 * `promptPlatformSelection` — bundled catalog seed first, live fetch with a
 * bundled fallback, so login still works offline.
 *
 * The `ManagedKimiCodeModelInfo` / `OpenPlatformDefinition` /
 * `DeviceAuthorization` types live in `@pythoughts/pythinker-code-oauth`,
 * which the extension does not depend on, so the port members are written
 * inline and contextually typed against `LoginUi`. Effort levels come from the
 * SDK's shared rule, reached through the two model-alias converters, so this
 * renderer offers exactly the levels the terminal renderer offers.
 */

import * as vscode from "vscode";

import {
  buildPlatformOptions,
  catalogModelToAlias,
  DEFAULT_CATALOG_URL,
  effortLevelsForModel,
  fetchCatalog,
  formatErrorMessage,
  loadBuiltInCatalog,
  managedModelToAlias,
  type ApiKeyPromptOptions,
  type LoginProgressSpinnerHandle,
  type LoginUi,
} from "@pythoughts/pythinker-code-sdk";

import type { HandlerContext } from "../handlers/types";

// Filled by the tsdown define in release builds (same env var the CLI's
// release build reads). Source stays empty so the generated models.dev
// snapshot is not committed; `typeof` keeps dev builds safe when the
// identifier is not replaced.
declare const __PYTHINKER_CODE_BUILT_IN_CATALOG__: string | undefined;

const BUILT_IN_CATALOG_JSON: string | undefined =
  typeof __PYTHINKER_CODE_BUILT_IN_CATALOG__ === "string"
    ? __PYTHINKER_CODE_BUILT_IN_CATALOG__
    : undefined;

const CATALOG_FETCH_TIMEOUT_MS = 10_000;

/** One quick pick for the effort level, from a list of supported levels. */
async function promptEffortLevel(
  levels: readonly string[],
  token: vscode.CancellationToken,
): Promise<string | undefined> {
  const selected = await vscode.window.showQuickPick(
    levels.map((level) => ({ label: level })),
    { title: "Select effort level", placeHolder: "Select effort level", ignoreFocusOut: true },
    token,
  );
  return selected?.label;
}

/**
 * A `LoginProgressSpinnerHandle` backed by a notification progress bar. The
 * `withProgress` task resolves when `stop` is called; the final message is
 * shown as a toast so the outcome stays visible after the notification ends.
 */
function createProgressHandle(title: string): LoginProgressSpinnerHandle {
  let resolveFinished: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  // Deliberately not cancellable: these track one step of a login, but the only
  // thing a cancel could do is abort the whole flow, and a Cancel button that
  // silently means more than its label is worse than none. The login-wide
  // progress notification the handler opens owns cancellation for every step.
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title, cancellable: false },
    () => finished,
  );
  let settled = false;
  return {
    stop({ ok, label }) {
      if (settled) return;
      settled = true;
      if (ok) {
        void vscode.window.showInformationMessage(label);
      } else {
        void vscode.window.showErrorMessage(label);
      }
      resolveFinished?.();
    },
  };
}

/**
 * Build a `LoginUi` for the extension host, rendering every prompt with VS
 * Code's own widgets. The webview keeps receiving the OAuth device URL it
 * already renders (`Events.LoginUrl`), so the pending-login screen still works.
 *
 * `token` is the login-wide cancellation token owned by the caller. Every quick
 * pick and input box receives it, so cancelling closes whichever prompt is open
 * instead of leaving the user staring at a widget the flow has already given
 * up on; network waits are cancelled through `cancelInFlight`.
 */
export function createVscodeLoginUi(
  ctx: HandlerContext,
  token: vscode.CancellationToken,
): LoginUi {
  let cancelInFlight: (() => void) | undefined;

  function openBrowser(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url));
  }

  function showStatus(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  function showError(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  function showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return createProgressHandle(label);
  }

  const ui: LoginUi = {
    harness: ctx.harness,
    get cancelInFlight() {
      return cancelInFlight;
    },
    set cancelInFlight(value: (() => void) | undefined) {
      cancelInFlight = value;
    },
    openBrowser,
    showStatus,
    showError,
    showLoginProgressSpinner,
    async promptPlatformSelection() {
      let catalog = loadBuiltInCatalog(BUILT_IN_CATALOG_JSON) ?? {};
      const controller = new AbortController();
      const cancel = (): void => {
        controller.abort();
      };
      cancelInFlight = cancel;
      const catalogSpinner = showLoginProgressSpinner("Loading provider catalog");
      try {
        // The editor progress notification is not cancellable, so a hung
        // request would strand the login with no way out. The bundled catalog
        // is a working fallback, so time the fetch out rather than wait.
        catalog = await fetchCatalog(
          DEFAULT_CATALOG_URL,
          AbortSignal.any([controller.signal, AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS)]),
        );
        catalogSpinner.stop({ ok: true, label: "Provider catalog loaded." });
      } catch (error) {
        if (controller.signal.aborted) {
          catalogSpinner.stop({ ok: false, label: "Aborted." });
          return undefined;
        }
        // A benign fallback, not a failure: one informational toast, because in
        // an editor every `stop` is a popup rather than an inline spinner step.
        catalogSpinner.stop({
          ok: true,
          label: `Using bundled provider catalog (live catalog unavailable: ${formatErrorMessage(error)}).`,
        });
      } finally {
        if (cancelInFlight === cancel) cancelInFlight = undefined;
      }

      const options = buildPlatformOptions(catalog);
      const items = options.map((option) => ({
        label: option.label,
        description: option.description,
        value: option.value,
      }));
      const selected = await vscode.window.showQuickPick(
        items,
        { title: "Select a provider", placeHolder: "Select a provider", ignoreFocusOut: true },
        token,
      );
      if (selected === undefined) return undefined;
      return { platformId: selected.value, catalog };
    },
    async promptApiKey(platformName, subtitleLines, promptOptions: ApiKeyPromptOptions = {}) {
      const emptyMessage = promptOptions.emptyMessage ?? "API key cannot be empty.";
      return vscode.window.showInputBox(
        {
          title: promptOptions.title ?? `Enter API key for ${platformName}`,
          // An input box prompt is a single line, so newlines would collapse.
          prompt: subtitleLines?.join(" — "),
          password: promptOptions.secret !== false,
          ignoreFocusOut: true,
          validateInput: (input: string) => (input.length === 0 ? emptyMessage : undefined),
        },
        token,
      );
    },
    async promptModelSelectionForOpenPlatform(models, platform) {
      const items = models.map((model) => ({
        label: model.displayName ?? model.id,
        model,
      }));
      const selected = await vscode.window.showQuickPick(
        items,
        {
          title: `Select a model for ${platform.name}`,
          placeHolder: "Select a model",
          ignoreFocusOut: true,
        },
        token,
      );
      if (selected === undefined) return undefined;
      const effort = await promptEffortLevel(
        effortLevelsForModel(managedModelToAlias(platform.id, selected.model)),
        token,
      );
      if (effort === undefined) return undefined;
      return { model: selected.model, effort };
    },
    async promptModelSelectionForCatalog(providerId, models) {
      const items = models.map((model) => ({
        label: model.name ?? model.id,
        model,
      }));
      const selected = await vscode.window.showQuickPick(
        items,
        {
          title: `Select a model for ${providerId}`,
          placeHolder: "Select a model",
          ignoreFocusOut: true,
        },
        token,
      );
      if (selected === undefined) return undefined;
      const effort = await promptEffortLevel(
        effortLevelsForModel(catalogModelToAlias(providerId, selected.model)),
        token,
      );
      if (effort === undefined) return undefined;
      return { model: selected.model, effort };
    },
    async refreshConfigAfterLogin() {
      // No live extension session to refresh: `Methods.Login` refreshes the
      // login context afterwards, and the config on disk is already current.
    },
    track() {
      // No extension telemetry sink yet. Success is reported by runLogin's
      // return value, never inferred from a telemetry call.
    },
  };
  return ui;
}
