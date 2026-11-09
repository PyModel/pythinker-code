import { defineConfig } from 'tsdown';

import {
  BUILT_IN_CATALOG_DEFINE,
  builtInCatalogDefine,
} from '../../apps/pythinker-code/scripts/built-in-catalog.mjs';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  define: {
    [BUILT_IN_CATALOG_DEFINE]: builtInCatalogDefine(),
  },
});
