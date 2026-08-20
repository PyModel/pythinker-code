import { describe, expect, it, vi } from 'vitest';

import {
  fetchLatestFromCdn,
  fetchLatestVersionFromCdn,
  UPDATE_DISABLED_MESSAGE,
} from '#/cli/update/cdn';

describe('disabled CDN update checks', () => {
  it('disables the plain latest-version fetcher without making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(fetchLatestVersionFromCdn(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      UPDATE_DISABLED_MESSAGE,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('disables the manifest fetcher without making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(fetchLatestFromCdn(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      UPDATE_DISABLED_MESSAGE,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
