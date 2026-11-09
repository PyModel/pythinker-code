import { defineConfig } from 'vitest/config';

import { vscodeProjects } from './apps/vscode/vitest.projects';

// Git hooks (pre-commit, pre-push) run the suite with these set to the real
// repository. Tests that spawn `git` in temp dirs would inherit them and write
// commits and config into the real repository instead. Workers fork after this
// file loads, so clearing them here isolates every project.
for (const name of [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
]) {
  delete process.env[name];
}

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
