import { describe, expect, it } from 'vitest';

import { createPythinkerOAuthCredentialProvider } from '#/credentials/pythinker-oauth';

describe('createPythinkerOAuthCredentialProvider', () => {
  function createTokens() {
    const calls: (boolean | undefined)[] = [];
    return {
      calls,
      tokens: {
        getAccessToken: (options?: { readonly force?: boolean }) => {
          calls.push(options?.force);
          return Promise.resolve('access-token');
        },
      },
    };
  }

  it('resolves the access token from the token provider', async () => {
    const { calls, tokens } = createTokens();
    const provider = createPythinkerOAuthCredentialProvider(tokens);

    await expect(provider.resolve()).resolves.toEqual({ apiKey: 'access-token' });
    expect(calls).toEqual([undefined]);
  });
});
