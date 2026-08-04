import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanupStaleUpdateBackup,
  getNativeAssetFilePath,
  getNativeCacheBase,
  getNativePackageRoot,
  NATIVE_ASSET_MANIFEST_VERSION,
  type NativeAssetManifest,
  type NativeAssetSource,
} from '#/native/native-assets';
import { loadNativePackage } from '#/native/native-require';

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fakeManifest(files: Record<string, string>): {
  manifest: NativeAssetManifest;
  source: NativeAssetSource;
} {
  const assetEntries = Object.entries(files).map(([relativePath, content]) => {
    const assetKey = `native/test-target/${relativePath}`;
    return {
      assetKey,
      relativePath,
      sha256: sha256(content),
    };
  });
  const manifest: NativeAssetManifest = {
    version: NATIVE_ASSET_MANIFEST_VERSION,
    target: 'test-target',
    packages: [
      {
        name: 'fake-native',
        root: 'node_modules/fake-native',
        files: assetEntries,
      },
    ],
  };
  const manifestKey = 'native/test-target/manifest.json';
  const assets = new Map<string, Buffer>([
    [manifestKey, Buffer.from(JSON.stringify(manifest))],
    ...Object.entries(files).map(([relativePath, content]) => [
      `native/test-target/${relativePath}`,
      Buffer.from(content),
    ] as const),
  ]);
  return {
    manifest,
    source: {
      getAssetKeys: () => [...assets.keys()],
      getRawAsset: (assetKey) => {
        const asset = assets.get(assetKey);
        if (asset === undefined) throw new Error(`missing test asset: ${assetKey}`);
        return asset;
      },
    },
  };
}

describe('native assets', () => {
  it('uses PYTHINKER_CODE_CACHE_DIR as the native cache base when present', () => {
    expect(
      getNativeCacheBase({
        env: { PYTHINKER_CODE_CACHE_DIR: '/tmp/pythinker-cache' },
        homeDir: '/home/pythinker',
        platform: 'linux',
      }),
    ).toBe('/tmp/pythinker-cache');
  });

  it('extracts package assets and repairs corrupted cache files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-native-assets-'));
    try {
      const { manifest, source } = fakeManifest({
        'node_modules/fake-native/package.json': '{"main":"index.js"}',
        'node_modules/fake-native/index.js': "module.exports = { value: 'ok' };\n",
      });

      const packageRoot = getNativePackageRoot('fake-native', {
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });
      expect(packageRoot).toBe(join(dir, 'native', 'test', 'test-target', sha256(JSON.stringify(manifest)), 'node_modules', 'fake-native'));
      expect(readFileSync(join(packageRoot ?? '', 'index.js'), 'utf-8')).toContain("value: 'ok'");

      writeFileSync(join(packageRoot ?? '', 'index.js'), 'broken');
      const repairedRoot = getNativePackageRoot('fake-native', {
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });
      expect(repairedRoot).toBe(packageRoot);
      expect(readFileSync(join(repairedRoot ?? '', 'index.js'), 'utf-8')).toContain("value: 'ok'");
      expect(existsSync(join(dir, 'native', 'test', 'test-target'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads a package from extracted native assets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-native-require-'));
    try {
      const { manifest, source } = fakeManifest({
        'node_modules/fake-native/package.json': '{"main":"index.js"}',
        'node_modules/fake-native/index.js': "module.exports = { value: 'ok' };\n",
      });

      const pkg = loadNativePackage<{ value: string }>('fake-native', {
        cacheBase: dir,
        manifest,
        source,
        version: 'test',
      });

      expect(pkg).toEqual({ value: 'ok' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an extracted explicit native library path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-native-library-'));
    try {
      const { manifest, source } = fakeManifest({
        'node_modules/fake-native/libopentui.so': 'native-library',
      });

      expect(
        getNativeAssetFilePath('fake-native', 'libopentui.so', {
          cacheBase: dir,
          manifest,
          source,
          version: 'test',
        }),
      ).toBe(
        join(
          dir,
          'native',
          'test',
          'test-target',
          sha256(JSON.stringify(manifest)),
          'node_modules',
          'fake-native',
          'libopentui.so',
        ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cleanupStaleUpdateBackup', () => {
  it('removes a leftover .old exe on win32 SEA installs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-update-backup-'));
    const execPath = join(dir, 'pythinker.exe');
    const stalePath = `${execPath}.old`;
    writeFileSync(stalePath, 'stale');
    try {
      cleanupStaleUpdateBackup({ execPath, platform: 'win32', isSea: true });
      expect(existsSync(stalePath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when there is nothing to clean up (missing file)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-update-backup-'));
    const execPath = join(dir, 'pythinker.exe');
    try {
      expect(() => {
        cleanupStaleUpdateBackup({ execPath, platform: 'win32', isSea: true });
      }).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips non-win32 platforms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-update-backup-'));
    const execPath = join(dir, 'pythinker');
    const stalePath = `${execPath}.old`;
    writeFileSync(stalePath, 'stale');
    try {
      cleanupStaleUpdateBackup({ execPath, platform: 'darwin', isSea: true });
      expect(existsSync(stalePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips non-SEA (npm/dev) processes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pythinker-update-backup-'));
    const execPath = join(dir, 'pythinker.exe');
    const stalePath = `${execPath}.old`;
    writeFileSync(stalePath, 'stale');
    try {
      cleanupStaleUpdateBackup({ execPath, platform: 'win32', isSea: false });
      expect(existsSync(stalePath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
