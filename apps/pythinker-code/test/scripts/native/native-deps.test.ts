import { describe, expect, it } from 'vitest';

import {
  nativeDeps,
  resolveTargetDeps,
  isSupportedTarget,
  SUPPORTED_TARGETS,
} from '../../../scripts/native/native-deps.mjs';

describe('SUPPORTED_TARGETS', () => {
  it('contains the six published targets', () => {
    expect([...SUPPORTED_TARGETS].toSorted()).toEqual(
      [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'win32-arm64',
        'win32-x64',
      ].toSorted(),
    );
  });
});

describe('isSupportedTarget', () => {
  it('accepts every supported target', () => {
    for (const t of SUPPORTED_TARGETS) {
      expect(isSupportedTarget(t)).toBe(true);
    }
  });

  it('rejects unknown targets', () => {
    expect(isSupportedTarget('linux-x64-musl')).toBe(false);
    expect(isSupportedTarget('darwin-arm')).toBe(false);
  });
});

describe('resolveTargetDeps', () => {
  it('returns one descriptor per package for darwin-arm64', () => {
    const deps = resolveTargetDeps('darwin-arm64');
    const names = deps.map((d) => d.resolvedName);
    expect(names).toContain('@mariozechner/clipboard');
    expect(names).toContain('@mariozechner/clipboard-darwin-arm64');
    expect(names).toContain('koffi');
    expect(names).toContain('@opentui/core');
    expect(names).toContain('@opentui/core-darwin-arm64');
  });

  it('picks the right clipboard subpackage per target', () => {
    expect(
      resolveTargetDeps('linux-x64').map((d) => d.resolvedName),
    ).toContain('@mariozechner/clipboard-linux-x64-gnu');
    expect(
      resolveTargetDeps('win32-x64').map((d) => d.resolvedName),
    ).toContain('@mariozechner/clipboard-win32-x64-msvc');
    expect(
      resolveTargetDeps('win32-arm64').map((d) => d.resolvedName),
    ).toContain('@mariozechner/clipboard-win32-arm64-msvc');
  });

  it('encodes koffi native file path with target triplet', () => {
    const linuxKoffi = resolveTargetDeps('linux-arm64').find((d) => d.resolvedName === 'koffi');
    expect(linuxKoffi?.nativeFileRelatives).toEqual(['build/koffi/linux_arm64/koffi.node']);
    const macKoffi = resolveTargetDeps('darwin-x64').find((d) => d.resolvedName === 'koffi');
    expect(macKoffi?.nativeFileRelatives).toEqual(['build/koffi/darwin_x64/koffi.node']);
    const winArmKoffi = resolveTargetDeps('win32-arm64').find((d) => d.resolvedName === 'koffi');
    expect(winArmKoffi?.nativeFileRelatives).toEqual(['build/koffi/win32_arm64/koffi.node']);
  });

  it('selects one OpenTUI platform library with an explicit file descriptor', () => {
    const linux = resolveTargetDeps('linux-arm64').find((d) => d.id === 'opentui-platform');
    expect(linux?.resolvedName).toBe('@opentui/core-linux-arm64');
    expect(linux?.collect).toBe('explicit-files');
    expect(linux?.nativeFileRelatives).toEqual(['libopentui.so']);

    const windows = resolveTargetDeps('win32-x64').find((d) => d.id === 'opentui-platform');
    expect(windows?.resolvedName).toBe('@opentui/core-win32-x64');
    expect(windows?.nativeFileRelatives).toEqual(['opentui.dll']);
  });

  it('registers the OpenTUI tree-sitter assets for extraction', () => {
    const core = resolveTargetDeps('darwin-arm64').find((d) => d.id === 'opentui-core-assets');
    expect(core?.resolvedName).toBe('@opentui/core');
    expect(core?.collect).toBe('explicit-files');
    expect(core?.nativeFileRelatives).toContain(
      'assets/javascript/tree-sitter-javascript.wasm',
    );
    expect(core?.nativeFileRelatives).toContain('assets/javascript/highlights.scm');
  });

  it('throws on unsupported target', () => {
    expect(() => resolveTargetDeps('linux-x64-musl')).toThrow(/unsupported/iu);
  });
});

describe('nativeDeps registry shape', () => {
  it('has clipboard host (collect=js-only)', () => {
    const host = nativeDeps.find((d) => d.id === 'clipboard-host');
    expect(host?.collect).toBe('js-only');
  });

  it('has clipboard-target (collect=native-files, parent=clipboard-host)', () => {
    const target = nativeDeps.find((d) => d.id === 'clipboard-target');
    expect(target?.collect).toBe('native-files');
    expect(target?.parent).toBe('clipboard-host');
  });

  it('has koffi (collect=js-and-native-file, parent=pi-tui)', () => {
    const koffi = nativeDeps.find((d) => d.id === 'koffi');
    expect(koffi?.collect).toBe('js-and-native-file');
    expect(koffi?.parent).toBe('pi-tui');
  });

  it('has an OpenTUI platform package nested under core', () => {
    const target = nativeDeps.find((d) => d.id === 'opentui-platform');
    expect(target?.collect).toBe('explicit-files');
    expect(target?.parent).toBe('opentui-core-assets');
  });
});
