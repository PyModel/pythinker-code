import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(import.meta.dirname, '../..');

function readAppFile(path: string): string {
  return readFileSync(resolve(appRoot, path), 'utf8');
}

describe('OpenTUI build wiring', () => {
  it('preserves Solid JSX with the OpenTUI JSX runtime', () => {
    const tsconfig = JSON.parse(readAppFile('tsconfig.json')) as {
      compilerOptions?: { jsx?: string; jsxImportSource?: string };
    };

    expect(tsconfig.compilerOptions?.jsx).toBe('preserve');
    expect(tsconfig.compilerOptions?.jsxImportSource).toBe('@opentui/solid');
  });

  it('applies the Solid transform to npm, native, and Vitest builds', () => {
    const npmConfig = readAppFile('tsdown.config.ts');
    const nativeConfig = readAppFile('tsdown.native.config.ts');
    const vitestConfig = readAppFile('vitest.config.ts');

    expect(npmConfig).toContain("from 'unplugin-solid/rolldown'");
    expect(nativeConfig).toContain("from 'unplugin-solid/rolldown'");
    expect(vitestConfig).toContain("from 'unplugin-solid/vite'");
    for (const config of [npmConfig, nativeConfig, vitestConfig]) {
      expect(config).toContain("moduleName: '@opentui/solid'");
      expect(config).toContain("generate: 'universal'");
    }
    expect(npmConfig).toContain('rawTextPlugin()');
    expect(nativeConfig).toContain('rawTextPlugin()');
  });

  it('emits launcher.mjs and main.mjs while externalizing native packages', () => {
    const npmConfig = readAppFile('tsdown.config.ts');

    expect(npmConfig).toContain("entry: ['./src/launcher.ts', './src/main.ts']");
    expect(npmConfig).toContain("entryFileNames: '[name].mjs'");
    expect(npmConfig).toContain('/^@opentui\\//u');
    expect(npmConfig).toContain("'node-pty'");
  });

  it('routes npm and production development through launcher.mjs', () => {
    const packageJson = JSON.parse(readAppFile('package.json')) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(packageJson.bin?.['pythinker']).toBe('dist/launcher.mjs');
    expect(packageJson.scripts?.['dev:prod']).toBe('node dist/launcher.mjs');
  });
});
