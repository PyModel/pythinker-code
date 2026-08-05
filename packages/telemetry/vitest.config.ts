import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'pythinker-telemetry',
    include: ['test/**/*.test.ts'],
  },
});
