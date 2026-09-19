import type { BearerTokenProvider } from '@pymodel/pythinker-code-oauth';

import { oauthCredentials } from '#/credentials/credentials';
import type { LlmCredentialProvider } from '#/llm/requester/requester';

export function pythinkerOAuthCredentialProvider(tokens: BearerTokenProvider): LlmCredentialProvider {
  return oauthCredentials((options) => tokens.getAccessToken(options));
}
