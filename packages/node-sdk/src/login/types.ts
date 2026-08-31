import type {
  ProviderModelInfo,
  OpenAICodexModelInfo,
  OpenPlatformDefinition,
} from '@pymodel/pythinker-code-oauth';

import type { Catalog, CatalogModel } from '#/catalog';
import type { PythinkerHarness } from '#/pythinker-harness';

export type LoginPlatformModelInfo =
  | ProviderModelInfo
  | OpenAICodexModelInfo;

export type LoginPlatformDefinition =
  | OpenPlatformDefinition
  | { readonly id: string; readonly name: string };

export interface LoginProgressSpinnerHandle {
  stop(options: { ok: boolean; label: string }): void;
}

export interface ApiKeyPromptOptions {
  readonly title?: string;
  readonly secret?: boolean;
  readonly emptyMessage?: string;
}

export interface PlatformSelection {
  readonly platformId: string;
  readonly catalog: Catalog;
}

export interface LoginUi {
  readonly harness: PythinkerHarness;
  cancelInFlight: (() => void) | undefined;
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
    models: LoginPlatformModelInfo[],
    platform: LoginPlatformDefinition,
  ): Promise<{ model: LoginPlatformModelInfo; effort: string } | undefined>;
  promptModelSelectionForCatalog(
    providerId: string,
    models: CatalogModel[],
  ): Promise<{ model: CatalogModel; effort: string } | undefined>;
  refreshConfigAfterLogin(): Promise<void>;
  track(event: string, properties?: Record<string, unknown>): void;
}
