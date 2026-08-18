import {
  refreshProviderModels,
  type ProviderChange,
  type RefreshProviderOptions,
  type RefreshProviderScope,
  type RefreshResult,
} from '@pymodel/pythinker-code-oauth';
import type { PythinkerConfig, PythinkerConfigPatch, OAuthRef } from '@pymodel/pythinker-code-sdk';

/**
 * CLI-side host for provider-model refresh. Kept on the SDK's full config types
 * so existing TUI callers (and tests) don't change; the daemon uses the oauth
 * package's `ManagedPythinkerConfigShape`-typed host directly.
 */
export interface RefreshProviderHost {
  getConfig(): Promise<PythinkerConfig>;
  removeProvider(providerId: string): Promise<PythinkerConfig>;
  setConfig(patch: PythinkerConfigPatch): Promise<PythinkerConfig>;
  resolveOAuthToken(providerName: string, oauthRef?: OAuthRef): Promise<string>;
  /** Product User-Agent sent on custom-registry (api.json) fetches. */
  readonly userAgent?: string;
}

export type { ProviderChange, RefreshProviderOptions, RefreshProviderScope, RefreshResult };

/**
 * Refresh remote model metadata for the configured providers. Thin adapter over
 * the shared `refreshProviderModels` orchestrator in `@pymodel/pythinker-code-oauth`
 * (which is also what the daemon's scheduled/manual refresh uses).
 */
export async function refreshAllProviderModels(
  host: RefreshProviderHost,
  options: RefreshProviderOptions = {},
): Promise<RefreshResult> {
  return refreshProviderModels(
    {
      getConfig: () => host.getConfig(),
      removeProvider: (providerId) => host.removeProvider(providerId),
      setConfig: (patch) => host.setConfig(patch as unknown as PythinkerConfigPatch),
      resolveOAuthToken: (providerName, oauthRef) =>
        host.resolveOAuthToken(providerName, oauthRef as unknown as OAuthRef),
      userAgent: host.userAgent,
    },
    options,
  );
}
