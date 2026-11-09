import { isManagedPythinkerCodeBaseUrl } from '@pymodel/pythinker-code-oauth';
import type { ModelAlias, PythinkerAuthFacade, ProviderConfig } from '@pymodel/pythinker-code-sdk';

/**
 * Cached access token of the model's provider, but only when that provider
 * sits on the managed base (`CUSTOM_API_BASE_URL`). Any other provider's
 * token must never reach that endpoint, so those resolve to undefined and the
 * caller fetches anonymously.
 */
export async function managedAccessToken(
  auth: Pick<PythinkerAuthFacade, 'getCachedAccessToken'>,
  model: string | undefined,
  models: Readonly<Record<string, ModelAlias>> | undefined,
  providers: Readonly<Record<string, ProviderConfig>>,
): Promise<string | undefined> {
  const entry = model === undefined ? undefined : models?.[model];
  if (entry === undefined) return undefined;
  const provider = providers[entry.provider];
  if (provider?.oauth === undefined) return undefined;
  if (!isManagedPythinkerCodeBaseUrl(entry.baseUrl ?? provider.baseUrl)) return undefined;
  return auth.getCachedAccessToken(provider.oauth);
}
