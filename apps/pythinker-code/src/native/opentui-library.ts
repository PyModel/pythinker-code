import { resolveOpenTuiTarget } from '../../scripts/native/opentui-target.mjs';
import { getNativeAssetFilePath, type NativeAssetOptions } from './native-assets';

function runtimeTarget(): string {
  if (process.env['OPENTUI_LIBC'] === 'musl') {
    return `linux-${process.arch}-musl`;
  }
  return `${process.platform}-${process.arch}`;
}

export function getOpenTuiLibraryPath(options: NativeAssetOptions = {}): string {
  const target = resolveOpenTuiTarget(runtimeTarget());
  const path = getNativeAssetFilePath(target.packageName, target.libraryFile, options);
  if (path === null) {
    throw new Error(`OpenTUI native library is not available: ${target.packageName}`);
  }
  return path;
}

export function getOpenTuiAssetPath(
  packageRelativePath: string,
  options: NativeAssetOptions = {},
): string {
  const path = getNativeAssetFilePath('@opentui/core', packageRelativePath, options);
  if (path === null) {
    throw new Error(`OpenTUI asset is not available: ${packageRelativePath}`);
  }
  return path;
}
