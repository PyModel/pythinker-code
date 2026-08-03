export const OPENTUI_TARGETS = Object.freeze({
  'darwin-arm64': Object.freeze({
    packageName: '@opentui/core-darwin-arm64',
    libraryFile: 'libopentui.dylib',
  }),
  'darwin-x64': Object.freeze({
    packageName: '@opentui/core-darwin-x64',
    libraryFile: 'libopentui.dylib',
  }),
  'linux-arm64': Object.freeze({
    packageName: '@opentui/core-linux-arm64',
    libraryFile: 'libopentui.so',
  }),
  'linux-x64': Object.freeze({
    packageName: '@opentui/core-linux-x64',
    libraryFile: 'libopentui.so',
  }),
  'win32-arm64': Object.freeze({
    packageName: '@opentui/core-win32-arm64',
    libraryFile: 'opentui.dll',
  }),
  'win32-x64': Object.freeze({
    packageName: '@opentui/core-win32-x64',
    libraryFile: 'opentui.dll',
  }),
});

export function resolveOpenTuiTarget(target) {
  if (target.startsWith('linux-') && target.endsWith('-musl')) {
    throw new Error(`OpenTUI musl target is unsupported: ${target}`);
  }
  const entry = OPENTUI_TARGETS[target];
  if (entry === undefined) {
    throw new Error(`Unsupported OpenTUI target: ${target}`);
  }
  return entry;
}
