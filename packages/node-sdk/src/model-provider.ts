import type { BearerTokenProvider } from '@pymodel/pythinker-code-oauth';
import type {
  ModelCapability,
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@pymodel/kosong';

import type { ModelAlias, OAuthRef, ProviderType } from '#/config/index';
import type { Logger } from '#/logging/index';

export type { BearerTokenProvider };

export type OAuthTokenProviderResolver = (
  providerName: string,
  oauthRef?: OAuthRef,
) => BearerTokenProvider | undefined;

export interface ResolvedRuntimeProvider {
  readonly providerName: string;
  readonly provider: KosongProviderConfig;
  readonly modelCapabilities: ModelCapability;
  readonly alwaysThinking?: boolean;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly maxOutputSize?: number;
  readonly type: ProviderType;
  readonly protocol: ModelAlias['protocol'];
}

type AuthorizedRequest = <T>(
  request: (auth: ProviderRequestAuth) => Promise<T>,
) => Promise<T>;

export interface ModelProvider {
  readonly defaultModel?: string;
  resolveProviderConfig(model: string): ResolvedRuntimeProvider;
  resolveAuth?(model: string, options?: { readonly log?: Logger }): AuthorizedRequest | undefined;
}
