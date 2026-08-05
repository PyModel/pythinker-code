import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(import.meta.dirname, '../..');
const runtimeScript = resolve(appRoot, 'scripts/dev-vite-runtime.mjs');

const ffiEnabled =
  process.execArgv.some((arg) => arg.includes('experimental-ffi')) ||
  (process.env['NODE_OPTIONS'] ?? '').includes('experimental-ffi');

describe.skipIf(!ffiEnabled)('dev Vite runtime', () => {
  it('updates OpenTUI output through the shared Solid runtime', async () => {
    const child = spawn(
      process.execPath,
      ['--experimental-ffi', runtimeScript],
      {
        cwd: appRoot,
        env: { ...process.env, PYTHINKER_CODE_OPENTUI_SMOKE: '1' },
        stdio: 'pipe',
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const reactiveMarker = 'OpenTUI reactive smoke passed: BEFORE -> AFTER';
    try {
      await expect.poll(() => stdout, { timeout: 5000 }).toContain(reactiveMarker);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }

    expect(stderr).not.toContain('React is not defined');
    expect(stderr).not.toContain('OpenTUI lifecycle probe failed');
    expect(stdout).toContain(reactiveMarker);
  }, 15000);
});
