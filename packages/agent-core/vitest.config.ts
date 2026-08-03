import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'pythinker-core',
    include: ['test/**/*.{test,e2e}.ts'],
  },
});
