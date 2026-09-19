import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/.skip/**'],
    name: 'remote-control',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
