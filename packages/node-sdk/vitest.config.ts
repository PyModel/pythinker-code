import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pymodel/agent-core': fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
      '@pymodel/pythinker-code-oauth/oauth-pages': fileURLToPath(
        new URL('../oauth/src/oauth-pages.ts', import.meta.url),
      ),
      '@pymodel/pythinker-code-oauth': fileURLToPath(
        new URL('../oauth/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'pythinker-sdk',
    env: {
      PYTHINKER_LOG_LEVEL: 'off',
    },
    include: ['test/**/*.test.ts'],
  },
});
