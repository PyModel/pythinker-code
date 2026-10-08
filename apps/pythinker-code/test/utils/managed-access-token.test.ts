import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { managedAccessToken } from '#/utils/managed-access-token';

const BASE = 'https://api.example.test/coding/v1';
const OAUTH = { storage: 'file', key: 'oauth/managed' } as const;

function setup(providerBaseUrl: string, oauth: typeof OAUTH | null = OAUTH) {
  const auth = { getCachedAccessToken: vi.fn(async () => 'token') };
  const models = { main: { provider: 'acme', model: 'm1', maxContextSize: 1000 } } as never;
  const providers = { acme: { type: 'openai', baseUrl: providerBaseUrl, oauth: oauth ?? undefined } } as never;
  return { auth, models, providers };
}

describe('managedAccessToken', () => {
  beforeEach(() => {
    vi.stubEnv('CUSTOM_API_BASE_URL', BASE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the managed provider token by its oauth ref', async () => {
    const { auth, models, providers } = setup(`${BASE}/`);
    await expect(managedAccessToken(auth as never, 'main', models, providers)).resolves.toBe('token');
    expect(auth.getCachedAccessToken).toHaveBeenCalledWith(OAUTH);
  });

  it('never reads a token for a provider on another base', async () => {
    const { auth, models, providers } = setup('https://other.example.test/v1');
    await expect(managedAccessToken(auth as never, 'main', models, providers)).resolves.toBeUndefined();
    expect(auth.getCachedAccessToken).not.toHaveBeenCalled();
  });

  it('never reads a token without a custom API base', async () => {
    vi.stubEnv('CUSTOM_API_BASE_URL', '');
    const { auth, models, providers } = setup(BASE);
    await expect(managedAccessToken(auth as never, 'main', models, providers)).resolves.toBeUndefined();
    expect(auth.getCachedAccessToken).not.toHaveBeenCalled();
  });

  it('skips providers without oauth and unknown models', async () => {
    const noOauth = setup(BASE, null);
    await expect(
      managedAccessToken(noOauth.auth as never, 'main', noOauth.models, noOauth.providers),
    ).resolves.toBeUndefined();
    const known = setup(BASE);
    await expect(
      managedAccessToken(known.auth as never, 'missing', known.models, known.providers),
    ).resolves.toBeUndefined();
    expect(known.auth.getCachedAccessToken).not.toHaveBeenCalled();
  });
});
