import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'pythinker-oauth',
    include: ['test/**/*.test.ts'],
  },
});
