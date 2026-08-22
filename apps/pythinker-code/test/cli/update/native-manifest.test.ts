import { describe, expect, it, vi } from 'vitest';

import { UPDATE_DISABLED_MESSAGE } from '#/cli/update/cdn';
import {
  fetchNativeReleaseManifest,
  nativeBinaryUrl,
  nativeManifestUrl,
  selectPlatformEntry,
} from '#/cli/update/native-manifest';

const VERSION = '0.7.0';

describe('disabled native release source', () => {
  it('disables manifest and binary URL resolution', () => {
    expect(() => nativeManifestUrl(VERSION)).toThrow(UPDATE_DISABLED_MESSAGE);
    expect(() => nativeBinaryUrl(VERSION, 'pythinker-code-win32-x64.zip')).toThrow(
      UPDATE_DISABLED_MESSAGE,
    );
  });

  it('does not fetch a native release manifest', async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchNativeReleaseManifest(VERSION, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(UPDATE_DISABLED_MESSAGE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('selectPlatformEntry', () => {
  const manifest = {
    version: VERSION,
    platforms: {
      'win32-x64': { filename: 'pythinker-code-win32-x64.zip', checksum: 'a'.repeat(64) },
    },
  };

  it('returns the entry matching platform-arch', () => {
    expect(selectPlatformEntry(manifest, 'win32', 'x64')).toEqual(
      manifest.platforms['win32-x64'],
    );
  });

  it('throws when the platform is missing', () => {
    expect(() => selectPlatformEntry(manifest, 'linux', 'arm64')).toThrow(
      /linux-arm64 not found/,
    );
  });
});
