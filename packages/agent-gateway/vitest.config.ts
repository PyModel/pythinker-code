import { defineConfig } from 'vitest/config';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

// `rawTextPlugin` is required because server-v2 pulls in agent-core-v2's full
// barrel, which imports `*.md?raw` prompt templates.
export default defineConfig({
  plugins: [rawTextPlugin()],
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/.skip/**'],
    name: 'agent-gateway',
    include: ['test/**/*.{test,e2e}.ts'],
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/globalSetup.ts'],
    testTimeout: 15_000,
  },
});
