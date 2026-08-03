import { describe, expect, it } from 'vitest';

import { createSeaConfig } from '../../../scripts/native/02-sea-blob.mjs';
import { nativeBlobPath, nativeJsBundlePath } from '../../../scripts/native/paths.mjs';

describe('native SEA config', () => {
  it('uses an ESM main and enables Node FFI', () => {
    expect(createSeaConfig({ 'native/test/asset': '/tmp/asset' })).toEqual({
      main: nativeJsBundlePath(),
      mainFormat: 'module',
      output: nativeBlobPath(),
      assets: { 'native/test/asset': '/tmp/asset' },
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      execArgv: ['--experimental-ffi'],
      execArgvExtension: 'env',
    });
    expect(nativeJsBundlePath()).toMatch(/main\.mjs$/u);
  });
});
