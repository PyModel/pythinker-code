import { defineConfig } from 'vitest/config';
import { vscodeProjects } from './vitest.projects';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/test/.skip/**'],
    projects: vscodeProjects,
  },
});
