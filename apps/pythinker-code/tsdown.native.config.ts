import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';
import solid from 'unplugin-solid/rolldown';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';
import { BUILT_IN_CATALOG_DEFINE, builtInCatalogDefine } from './scripts/built-in-catalog.mjs';
import { OPENTUI_TARGETS } from './scripts/native/opentui-target.mjs';
import { solidRuntimeAliasPlugin } from './scripts/solid-runtime.mjs';

const appRoot = import.meta.dirname;
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const optionalNativeDependencies = new Set(['cpu-features']);
const openTuiShimPath = resolve(appRoot, 'src/native/opentui-native-shim.ts');
const openTuiAssetHelperPath = resolve(appRoot, 'src/native/opentui-library.ts');
const openTuiPlatformAliases = Object.fromEntries([
  ...Object.values(OPENTUI_TARGETS).map(({ packageName }) => [
    packageName,
    openTuiShimPath,
  ]),
  ['@opentui/core-linux-arm64-musl', openTuiShimPath],
  ['@opentui/core-linux-x64-musl', openTuiShimPath],
]);
const openTuiAssetPrefix = '\0pythinker-opentui-asset:';

function shouldAlwaysBundle(id: string): boolean {
  if (builtins.has(id) || id.startsWith('node:')) return false;
  if (id === 'node-pty') return false;
  if (optionalNativeDependencies.has(id)) return false;
  // Everything else is force-bundled, which covers `@pythoughts/*` (incl.
  // dashboard-server for `pythinker dashboard`) plus its transitive `hono` / `@hono/node-server`
  // — so the SEA bundle is self-contained (check-bundle.mjs enforces this).
  return true;
}

function buildTarget(): string {
  return process.env['PYTHINKER_CODE_BUILD_TARGET'] ?? `${process.platform}-${process.arch}`;
}

export default defineConfig({
  entry: ['./src/main.ts'],
  format: ['esm'],
  outDir: 'dist-native/intermediates',
  clean: true,
  dts: false,
  fixedExtension: true,
  hash: false,
  platform: 'node',
  target: 'node26',
  banner: { js: '#!/usr/bin/env node' },
  plugins: [
    solidRuntimeAliasPlugin(),
    solid({ include: [/\.[jt]sx$/u], solid: { moduleName: '@opentui/solid', generate: 'universal' } }),
    {
      name: 'opentui-extracted-assets',
      resolveId(source, importer) {
        if (
          /[/\\]@opentui[/\\]core[/\\]/u.test(importer ?? '') &&
          /^\.\/assets\/.+\.(?:scm|wasm)$/u.test(source)
        ) {
          return `${openTuiAssetPrefix}${source.slice(2)}`;
        }
        return null;
      },
      load(id) {
        if (!id.startsWith(openTuiAssetPrefix)) return null;
        const packageRelativePath = id.slice(openTuiAssetPrefix.length);
        return {
          code: [
            `import { getOpenTuiAssetPath } from ${JSON.stringify(openTuiAssetHelperPath)};`,
            `export default getOpenTuiAssetPath(${JSON.stringify(packageRelativePath)});`,
          ].join('\n'),
          map: null,
        };
      },
    },
    rawTextPlugin(),
  ],
  alias: {
    '@': resolve(appRoot, 'src'),
    ...openTuiPlatformAliases,
  },
  define: {
    [BUILT_IN_CATALOG_DEFINE]: builtInCatalogDefine(),
    __PYTHINKER_CODE_VERSION__: JSON.stringify(packageJson.version),
    __PYTHINKER_CODE_CHANNEL__: JSON.stringify(process.env['PYTHINKER_CODE_CHANNEL'] ?? ''),
    __PYTHINKER_CODE_COMMIT__: JSON.stringify(process.env['PYTHINKER_CODE_COMMIT'] ?? ''),
    __PYTHINKER_CODE_BUILD_TARGET__: JSON.stringify(buildTarget()),
    __PYTHINKER_CODE_NATIVE_BUNDLE__: 'true',
  },
  deps: {
    alwaysBundle: shouldAlwaysBundle,
    neverBundle: [...optionalNativeDependencies, 'node-pty'],
    onlyBundle: false,
  },
  outputOptions: {
    codeSplitting: false,
    entryFileNames: 'main.mjs',
  },
  checks: {
    legacyCjs: false,
  },
});
