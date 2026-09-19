import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/.skip/**'],
    name: 'pythinker-oauth',
    include: ['test/**/*.test.ts'],
  },
});
