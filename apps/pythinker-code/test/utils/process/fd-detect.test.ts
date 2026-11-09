import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectFdPath, ensureFdPath } from '#/utils/process/fd-detect';
import { getBinDir } from '#/utils/paths';

const mocks = vi.hoisted(() => ({
  resolveCommandPath: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('#/utils/process/resolve-command', () => ({
  resolveCommandPath: mocks.resolveCommandPath,
}));
vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }));

const originalEnv = { ...process.env };
let tempHome: string | undefined;

afterEach(() => {
  if (tempHome !== undefined) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
  process.env = { ...originalEnv };
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('detectFdPath', () => {
  it('returns the absolute resolved path for a system fd binary', () => {
    tempHome = mkdtempSync(join(tmpdir(), 'pythinker-fd-home-'));
    process.env['PYTHINKER_CODE_HOME'] = tempHome;
    mocks.resolveCommandPath.mockImplementation((name: string) =>
      name === 'fd' ? '/usr/local/bin/fd' : undefined,
    );
    mocks.spawnSync.mockReturnValue({ status: 0 });

    expect(detectFdPath()).toBe('/usr/local/bin/fd');
    expect(mocks.spawnSync).toHaveBeenCalledWith('/usr/local/bin/fd', ['--version'], {
      stdio: 'ignore',
    });
  });

  it('does not download fd when no local binary is available', async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'pythinker-fd-home-'));
    process.env['PYTHINKER_CODE_HOME'] = tempHome;
    mocks.resolveCommandPath.mockReturnValue(undefined);
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    await expect(ensureFdPath()).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prefers the managed fd binary under PYTHINKER_CODE_HOME', () => {
    tempHome = mkdtempSync(join(tmpdir(), 'pythinker-fd-home-'));
    process.env['PYTHINKER_CODE_HOME'] = tempHome;
    mkdirSync(getBinDir(), { recursive: true });

    const binaryPath = join(getBinDir(), process.platform === 'win32' ? 'fd.exe' : 'fd');
    if (process.platform === 'win32') {
      // Creating a real Windows PE executable in a unit test is not practical;
      // the asset-name tests still cover Windows selection logic.
      return;
    }

    writeFileSync(binaryPath, '#!/bin/sh\necho fd 10.4.2\n');
    chmodSync(binaryPath, 0o755);

    expect(detectFdPath()).toBe(binaryPath);
  });
});
