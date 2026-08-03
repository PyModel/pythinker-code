import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

function readJson(path: string): {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
} {
  return JSON.parse(readRepositoryFile(path));
}

function extractTsdownTarget(path: string): string | undefined {
  return readRepositoryFile(path).match(/\btarget:\s*['"]([^'"]+)['"]/)?.[1];
}

describe('Node.js version floor', () => {
  it('keeps every runtime and build surface on Node.js 26.4', () => {
    const rootPackage = readJson('package.json');
    const appPackage = readJson('apps/pythinker-code/package.json');

    expect(readRepositoryFile('.nvmrc').trim()).toBe('26.4.0');
    expect(rootPackage.engines?.node).toBe('>=26.4.0');
    expect(appPackage.engines?.node).toBe('>=26.4.0');
    expect(appPackage.devDependencies?.['@types/node']).toBe('^26.1.1');
    expect(extractTsdownTarget('apps/pythinker-code/tsdown.config.ts')).toBe('node26');
    expect(extractTsdownTarget('apps/pythinker-code/tsdown.native.config.ts')).toBe(
      'node26',
    );
  });

  it('keeps the native build guard at Node.js 26.4.0', () => {
    const source = readRepositoryFile('apps/pythinker-code/scripts/native/build.mjs');
    const minimumVersion = source.match(
      /const MINIMUM_NODE_VERSION = \[(\d+),\s*(\d+),\s*(\d+)\];/,
    );
    const guardStart = source.indexOf('const MINIMUM_NODE_VERSION');
    const guardEnd = source.indexOf('function ensureNodeVersion');
    const context: {
      versions: string[];
      results?: boolean[];
    } = {
      versions: [
        '25.99.99',
        '26.3.99',
        '26.4.0-rc.1',
        'invalid',
        '26.4.0',
        '26.4.0+build.1',
        '26.4.1-rc.1',
        '26.4.1',
        '27.0.0-rc.1',
        '27.0.0',
      ],
    };

    expect(minimumVersion?.slice(1).map(Number)).toEqual([26, 4, 0]);
    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(source).toContain(
      'isNodeVersionBelow(process.versions.node, MINIMUM_NODE_VERSION)',
    );

    runInNewContext(
      `${source.slice(guardStart, guardEnd)}
       results = versions.map((version) =>
         isNodeVersionBelow(version, MINIMUM_NODE_VERSION),
       );`,
      context,
    );

    expect(context.results).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
