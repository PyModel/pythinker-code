import { describe, expect, it } from 'vitest';

import {
  appRoot,
  executableName,
  nativeIntermediatesDir,
  nativeBinDir,
  nativeBinPath,
  nativeBlobPath,
  nativeJsBundlePath,
  nativeManifestKey,
  nativeSeaConfigPath,
  targetTriple,
  nativeDistRoot,
  nativeManifestDir,
  nativeArtifactsDir,
  nativeSmokeHome,
  SEA_SENTINEL_FUSE,
} from '../../../scripts/native/paths.mjs';

describe('targetTriple', () => {
  it('returns platform-arch when env unset', () => {
    expect(targetTriple({ platform: 'darwin', arch: 'arm64', env: {} })).toBe('darwin-arm64');
    expect(targetTriple({ platform: 'linux', arch: 'x64', env: {} })).toBe('linux-x64');
    expect(targetTriple({ platform: 'win32', arch: 'x64', env: {} })).toBe('win32-x64');
  });

  it('honors PYTHINKER_CODE_BUILD_TARGET override', () => {
    expect(
      targetTriple({
        platform: 'darwin',
        arch: 'arm64',
        env: { PYTHINKER_CODE_BUILD_TARGET: 'linux-arm64' },
      }),
    ).toBe('linux-arm64');
  });
});

describe('executableName', () => {
  it('returns pythinker.exe on win32', () => {
    expect(executableName('win32')).toBe('pythinker.exe');
  });

  it('returns pythinker on other platforms', () => {
    expect(executableName('darwin')).toBe('pythinker');
    expect(executableName('linux')).toBe('pythinker');
  });
});

describe('path helpers', () => {
  it('returns absolute intermediates dir under app root', () => {
    expect(nativeIntermediatesDir()).toBe(`${appRoot}/dist-native/intermediates`);
  });

  it('returns absolute bin dir per target', () => {
    expect(nativeBinDir('darwin-arm64')).toBe(`${appRoot}/dist-native/bin/darwin-arm64`);
  });

  it('returns absolute bin path with executable name', () => {
    expect(nativeBinPath('darwin-arm64', 'darwin')).toBe(
      `${appRoot}/dist-native/bin/darwin-arm64/pythinker`,
    );
    expect(nativeBinPath('win32-x64', 'win32')).toBe(
      `${appRoot}/dist-native/bin/win32-x64/pythinker.exe`,
    );
  });

  it('returns intermediate artifact paths', () => {
    expect(nativeJsBundlePath()).toBe(`${appRoot}/dist-native/intermediates/main.cjs`);
    expect(nativeBlobPath()).toBe(`${appRoot}/dist-native/intermediates/pythinker.blob`);
    expect(nativeSeaConfigPath()).toBe(
      `${appRoot}/dist-native/intermediates/sea-config.json`,
    );
  });

  it('returns manifest key for target', () => {
    expect(nativeManifestKey('darwin-arm64')).toBe('native/darwin-arm64/manifest.json');
  });

  it('returns native dist root', () => {
    expect(nativeDistRoot()).toBe(`${appRoot}/dist-native`);
  });

  it('returns manifest dir for target', () => {
    expect(nativeManifestDir('darwin-arm64')).toBe(
      `${appRoot}/dist-native/intermediates/native-assets/darwin-arm64`,
    );
  });

  it('returns artifacts dir', () => {
    expect(nativeArtifactsDir()).toBe(`${appRoot}/dist-native/artifacts`);
  });

  it('returns smoke home', () => {
    expect(nativeSmokeHome()).toBe(`${appRoot}/dist-native/smoke-home`);
  });

  it('has correct SEA sentinel fuse value', () => {
    expect(SEA_SENTINEL_FUSE).toBe('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');
  });
});
