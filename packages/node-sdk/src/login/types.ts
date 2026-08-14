import type {
  OpenPlatformDefinition,
  PlatformModelInfo,
} from '@pymodel/pythinker-code-oauth';
import type { Catalog, CatalogModel } from '#/catalog';
import type { PythinkerHarness } from '#/pythinker-harness';

export interface LoginProgressSpinnerHandle {
  stop(opts: { ok: boolean; label: string }): void;
}

export interface ApiKeyPromptOptions {
  readonly title?: string;
  readonly subtitleLines?: readonly string[];
  readonly secret?: boolean;
  readonly emptyMessage?: string;
}

export interface PlatformSelection {
  readonly platformId: string;
  readonly catalog: Catalog;
}

export interface LoginUi {
  readonly harness: PythinkerHarness;
  readonly sessionId?: string;
  cancelInFlight: (() => void) | undefined;
  /**
   * Open a URL in the user's browser. Renderer-owned on purpose: a terminal
   * shells out, while an editor extension uses its own host API.
   */
  openBrowser(url: string): void;
  showStatus(message: string): void;
  showError(message: string): void;
  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle;
  promptPlatformSelection(): Promise<PlatformSelection | undefined>;
  promptApiKey(
    platformName: string,
    subtitleLines?: readonly string[],
    options?: ApiKeyPromptOptions,
  ): Promise<string | undefined>;
  promptModelSelectionForOpenPlatform(
    models: PlatformModelInfo[],
    platform: OpenPlatformDefinition,
  ): Promise<{ model: PlatformModelInfo; effort: string } | undefined>;
  promptModelSelectionForCatalog(
    providerId: string,
    models: CatalogModel[],
  ): Promise<{ model: CatalogModel; effort: string } | undefined>;
  refreshConfigAfterLogin(): Promise<void>;
  track(event: string, props?: Record<string, unknown>): void;
}
