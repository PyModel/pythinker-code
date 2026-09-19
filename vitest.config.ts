import { defineConfig } from 'vitest/config';

import { vscodeProjects } from './apps/vscode/vitest.projects';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      '!packages/minidb',
      'apps/pythinker-code',
      'apps/desktop',
      'apps/pythinker-web',
      'apps/vis/server',
      'apps/vis/web',
      ...vscodeProjects,
    ],
    // Intentionally-parked suites under test/.skip must never execute.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/test/.skip/**',
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
