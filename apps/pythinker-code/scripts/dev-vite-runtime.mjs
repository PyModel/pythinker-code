#!/usr/bin/env node
// Runs src/main.ts through a Vite SSR module graph instead of tsx.
//
// tsx (esbuild) can transform TypeScript but has no Solid JSX compiler, so any
// .tsx import throws "React is not defined" under `pnpm dev:cli-only`. Vite
// already runs the same unplugin-solid/vite transform for `*.test.tsx` under
// Vitest; this reuses that plugin in SSR middleware mode so dev gets the
// identical compiled output. Vite's own `import()` rewriting keeps dynamic
// imports (e.g. main.ts's OpenTUI smoke probe) routed through the same
// module graph, so the server must stay open for the life of the process.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import solid from 'unplugin-solid/vite';

import { solidRuntimeAlias } from './solid-runtime.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');

const server = await createServer({
  root: APP_ROOT,
  configFile: false,
  logLevel: 'warn',
  esbuild: {
    // Mirrors tsconfig.json's compilerOptions relevant to esbuild's transform;
    // Vite does not resolve the extends chain in tsconfig.dev.json for
    // dependency-package sources reached via workspace symlinks, so this is
    // inlined rather than pointed at a tsconfig file.
    tsconfigRaw: {
      compilerOptions: {
        target: 'ES2022',
        experimentalDecorators: true,
        allowJs: true,
      },
    },
  },
  plugins: [
    solid({
      ssr: true,
      include: [/\.[jt]sx$/u],
      solid: { moduleName: '@opentui/solid', generate: 'universal' },
    }),
  ],
  ssr: {
    noExternal: ['@opentui/solid', 'solid-js'],
  },
  resolve: {
    alias: [
      solidRuntimeAlias,
      {
        find: '@',
        replacement: resolve(APP_ROOT, 'src'),
      },
    ],
  },
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});

try {
  await server.ssrLoadModule(resolve(APP_ROOT, 'src/main.ts'));
} catch (error) {
  await server.close();
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
}
