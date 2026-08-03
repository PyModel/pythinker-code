import { describe, expect, it } from 'vitest';

import { OPENTUI_TARGETS, resolveOpenTuiTarget } from '../../scripts/native/opentui-target.mjs';

describe('OpenTUI native targets', () => {
  it('covers exactly the six published targets', () => {
    expect(Object.keys(OPENTUI_TARGETS).toSorted()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64',
    ]);
  });

  it.each([
    ['darwin-arm64', '@opentui/core-darwin-arm64', 'libopentui.dylib'],
    ['darwin-x64', '@opentui/core-darwin-x64', 'libopentui.dylib'],
    ['linux-arm64', '@opentui/core-linux-arm64', 'libopentui.so'],
    ['linux-x64', '@opentui/core-linux-x64', 'libopentui.so'],
    ['win32-arm64', '@opentui/core-win32-arm64', 'opentui.dll'],
    ['win32-x64', '@opentui/core-win32-x64', 'opentui.dll'],
  ])('maps %s to %s and %s', (target, packageName, libraryFile) => {
    expect(resolveOpenTuiTarget(target)).toEqual({ packageName, libraryFile });
  });

  it('rejects musl targets explicitly', () => {
    expect(() => resolveOpenTuiTarget('linux-x64-musl')).toThrow(/musl.*unsupported/iu);
    expect(() => resolveOpenTuiTarget('linux-arm64-musl')).toThrow(/musl.*unsupported/iu);
  });
});
