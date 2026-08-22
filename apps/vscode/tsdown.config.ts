import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { defineConfig } from 'tsdown';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };
const root = import.meta.dirname;

// Bundled models.dev catalog seed for offline login, injected the same way
// the CLI injects it: read from `PYTHINKER_CODE_BUILT_IN_CATALOG_FILE` at
// build time, replaced with the `undefined` token when the env var is absent.
const BUILT_IN_CATALOG_DEFINE = '__PYTHINKER_CODE_BUILT_IN_CATALOG__';
const BUILT_IN_CATALOG_ENV = 'PYTHINKER_CODE_BUILT_IN_CATALOG_FILE';
function builtInCatalogDefine(): string {
  const file = process.env[BUILT_IN_CATALOG_ENV];
  if (file === undefined || file.length === 0) return 'undefined';
  return JSON.stringify(readFileSync(file, 'utf-8'));
}

export default defineConfig({
  entry: ['./src/extension.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: false,
  dts: false,
  sourcemap: false,
  plugins: [rawTextPlugin()],
  alias: {
    '@pymodel/pythinker-code-sdk': resolve(root, '../../packages/node-sdk/src/index.ts'),
    '@pymodel/agent-core': resolve(root, '../../packages/agent-core/src/index.ts'),
    '@pymodel/pyaos': resolve(root, '../../packages/pyaos/src/index.ts'),
    '@pymodel/pythinker-code-oauth': resolve(root, '../../packages/oauth/src/index.ts'),
    '@pymodel/kosong': resolve(root, '../../packages/kosong/src/index.ts'),
  },
  define: {
    __EXTENSION_VERSION__: JSON.stringify(pkg.version),
    [BUILT_IN_CATALOG_DEFINE]: builtInCatalogDefine(),
  },
  banner: {
    js: [
      "import { fileURLToPath as __cjsShimFileURLToPath } from 'node:url';",
      "import { dirname as __cjsShimDirname } from 'node:path';",
      'const __filename = __cjsShimFileURLToPath(import.meta.url);',
      'const __dirname = __cjsShimDirname(__filename);',
    ].join('\n'),
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: [/^@pymodel\//, 'zod', 'diff'],
    neverBundle: ['vscode'],
  },
  outputOptions: {
    entryFileNames: 'extension.js',
  },
});
