import { fileURLToPath } from 'node:url';

import { defineConfig } from 'tsdown';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: false,
  outDir: 'dist',
  clean: true,
  plugins: [rawTextPlugin()],
  banner: {
    js: [
      "import { fileURLToPath as __cjsShimFileURLToPath } from 'node:url';",
      "import { dirname as __cjsShimDirname } from 'node:path';",
      'const __filename = __cjsShimFileURLToPath(import.meta.url);',
      'const __dirname = __cjsShimDirname(__filename);',
    ].join('\n'),
  },
  alias: {
    '@pythoughts/agent-core': fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
    '@pythoughts/kaos': fileURLToPath(new URL('../kaos/src/index.ts', import.meta.url)),
    '@pythoughts/pythinker-code-oauth': fileURLToPath(new URL('../oauth/src/index.ts', import.meta.url)),
    '@pythoughts/kosong': fileURLToPath(new URL('../kosong/src/index.ts', import.meta.url)),
  },
  deps: {
    alwaysBundle: [/^@pythoughts\//],
    neverBundle: [],
  },
});
