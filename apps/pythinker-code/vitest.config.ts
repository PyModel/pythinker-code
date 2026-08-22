import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const appRoot = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(appRoot, 'src'),
    },
  },
  test: {
    name: 'cli',
    env: {
      PYTHINKER_LOG_LEVEL: 'off',
      PYTHINKER_CODE_TUI_FULL_SCREEN: '0',
    },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
