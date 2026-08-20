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
      '@pymodel/agent-core',
      '@pymodel/pythinker-code-sdk',
      '@pymodel/kosong',
      '@pymodel/pyaos',
    ],
  },
});
