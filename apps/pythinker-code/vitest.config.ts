import { resolve } from 'node:path';

import solid from 'unplugin-solid/vite';
import { defineConfig } from 'vitest/config';

import { solidRuntimeAlias } from './scripts/solid-runtime.mjs';

const appRoot = import.meta.dirname;

export default defineConfig({
  plugins: [solid({ ssr: true, include: [/\.[jt]sx$/u], solid: { moduleName: '@opentui/solid', generate: 'universal' } })],
  resolve: {
    alias: [
      solidRuntimeAlias,
      {
        find: '@',
        replacement: resolve(appRoot, 'src'),
      },
    ],
  },
  test: {
    name: 'cli',
    env: {
      PYTHINKER_LOG_LEVEL: 'off',
    },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
