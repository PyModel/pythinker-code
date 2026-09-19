import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      '!packages/minidb',
      'apps/pythinker-code',
      'apps/vis/server',
      'apps/vis/web',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/*/src/**/*.ts',
        'apps/*/src/**/*.ts',
        'apps/vis/*/src/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      reporter: ['text', 'html'],
    },
  },
});
