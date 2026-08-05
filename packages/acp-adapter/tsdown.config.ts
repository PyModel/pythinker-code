import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
  deps: {
    neverBundle: [
      '@agentclientprotocol/sdk',
      '@pythoughts/agent-core',
      '@pythoughts/pythinker-code-sdk',
      '@pythoughts/kosong',
      '@pythoughts/kaos',
    ],
  },
});
