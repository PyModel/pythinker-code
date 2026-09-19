import { createOAuthCredentialProvider } from "#/credentials/credentials";
import type { LlmCredentialProvider } from "#/llm/requester/requester";

export interface AccessTokenProvider {
  getAccessToken(options?: { readonly force?: boolean; readonly signal?: AbortSignal }): Promise<string>;
}

export function pythinkerOAuthCredentialProvider(tokens: AccessTokenProvider): LlmCredentialProvider {
  return createOAuthCredentialProvider((options) => tokens.getAccessToken(options));
}
