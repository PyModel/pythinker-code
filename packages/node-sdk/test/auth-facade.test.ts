import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileTokenStorage,
  resolveOAuthTokenStorageName,
  type TokenInfo,
} from '@pymodel/pythinker-code-oauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPythinkerHarness, ErrorCodes } from '#/index';

let homeDir: string;

function token(expiresAt: number): TokenInfo {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt,
    scope: '',
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
}

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'pythinker-sdk-auth-'));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

describe('PythinkerHarness.auth', () => {
  it('reads a fresh token from an explicit file credential reference', async () => {
    const key = 'oauth/example';
    const storage = new FileTokenStorage(join(homeDir, 'credentials'));
    await storage.save(
      resolveOAuthTokenStorageName(key),
      token(Math.floor(Date.now() / 1000) + 3600),
    );
    const harness = createPythinkerHarness({ homeDir });

    await expect(harness.auth.getCachedAccessToken({ storage: 'file', key })).resolves.toBe(
      'access-token',
    );
  });

  it('rejects expired and unsupported stored credentials', async () => {
    const key = 'oauth/example';
    const storage = new FileTokenStorage(join(homeDir, 'credentials'));
    await storage.save(resolveOAuthTokenStorageName(key), token(1));
    const harness = createPythinkerHarness({ homeDir });

    await expect(harness.auth.getCachedAccessToken({ storage: 'file', key })).resolves.toBeUndefined();
    await expect(
      harness.auth.getCachedAccessToken({ storage: 'keyring', key }),
    ).resolves.toBeUndefined();
  });

  it('maps a missing explicit token to login required', async () => {
    const harness = createPythinkerHarness({ homeDir });
    const provider = harness.auth.resolveOAuthTokenProvider('example', {
      storage: 'file',
      key: 'oauth/example',
    });

    await expect(provider?.getAccessToken()).rejects.toMatchObject({
      code: ErrorCodes.AUTH_LOGIN_REQUIRED,
    });
  });
});
