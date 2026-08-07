import { describe, expect, it, vi } from 'vitest';

import { refreshUpdateCache } from '#/cli/update/refresh';
import type { UpdateManifest } from '#/cli/update/types';

const MANIFEST: UpdateManifest = {
  version: '0.5.0',
  publishedAt: '2026-05-20T12:00:00.000Z',
  rollout: [
    { percent: 30, delaySeconds: 0 },
    { percent: 30, delaySeconds: 43_200 },
    { percent: 40, delaySeconds: 86_400 },
  ],
};

describe('refreshUpdateCache', () => {
  it('writes a fresh cache carrying the manifest on successful fetch', async () => {
    const writeCache = vi.fn(async () => {});
    const result = await refreshUpdateCache({
      fetchManifest: async () => MANIFEST,
      writeCache,
      now: () => new Date('2026-05-20T12:34:56.000Z'),
    });

    expect(result).toEqual({
      source: 'cdn',
      checkedAt: '2026-05-20T12:34:56.000Z',
      latest: '0.5.0',
      manifest: MANIFEST,
    });
    expect(writeCache).toHaveBeenCalledWith(result);
  });

  it('takes `latest` from the manifest rather than a separate field', async () => {
    const writeCache = vi.fn(async () => {});
    const result = await refreshUpdateCache({
      fetchManifest: async () => ({ ...MANIFEST, version: '0.6.0' }),
      writeCache,
      now: () => new Date('2026-05-20T12:34:56.000Z'),
    });

    expect(result.latest).toBe('0.6.0');
    expect(result.manifest?.version).toBe('0.6.0');
  });

  it('propagates fetch errors and skips writeCache so the cache is preserved', async () => {
    const writeCache = vi.fn(async () => {});
    await expect(
      refreshUpdateCache({
        fetchManifest: async () => {
          throw new Error('network down');
        },
        writeCache,
        now: () => new Date(),
      }),
    ).rejects.toThrow(/network down/);

    expect(writeCache).not.toHaveBeenCalled();
  });
});
