import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'dashboard-server',
    include: ['test/**/*.test.ts'],
  },
});
