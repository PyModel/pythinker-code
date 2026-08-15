import { defineConfig } from 'tsdown'

/** Bundle the Electron main entry while preserving Electron as a runtime builtin. */
export default defineConfig({
  entry: ['src/main.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
