import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const pkg = JSON.parse(
  readFileSync(new URL('../pythinker-code/package.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  plugins: [vue()],
  build: { target: 'es2022' },
  define: { __PYTHINKER_VERSION__: JSON.stringify(pkg.version) },
});
