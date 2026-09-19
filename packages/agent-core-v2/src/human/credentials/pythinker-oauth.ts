import { oauthCredentials } from "#/credentials/credentials";
import type { LlmCredentialProvider } from "#/llm/requester/requester";

export interface AccessTokenProvider {
  getAccessToken(options?: { readonly force?: boolean; readonly signal?: AbortSignal }): Promise<string>;
}

export function pythinkerOAuthCredentialProvider(tokens: AccessTokenProvider): LlmCredentialProvider {
  return oauthCredentials((options) => tokens.getAccessToken(options));
}
