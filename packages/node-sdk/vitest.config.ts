import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pythoughts/agent-core': fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
      '@pythoughts/pythinker-code-oauth/oauth-pages': fileURLToPath(
        new URL('../oauth/src/oauth-pages.ts', import.meta.url),
      ),
      '@pythoughts/pythinker-code-oauth': fileURLToPath(
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
