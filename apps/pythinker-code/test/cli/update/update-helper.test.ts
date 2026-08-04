import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activatePendingUpdate } from '#/cli/update/activation';
import { readUpdateInstallState, writeUpdateInstallState } from '#/cli/update/install-state';
import { runUpdateHelper } from '#/cli/update/update-helper';
import type { UpdatePreparedHomebrew } from '#/cli/update/types';

const mocks = vi.hoisted(() => ({
  prepareHomebrewUpdate: vi.fn(),
}));

vi.mock('../../../src/cli/update/homebrew', async () => {
  const actual = await vi.importActual<typeof import('#/cli/update/homebrew')>(
    '#/cli/update/homebrew',
  );
  return {
    ...actual,
    prepareHomebrewUpdate: mocks.prepareHomebrewUpdate,
  };
});

const JOB_ID = '7e717f78-70c6-4f7c-9745-ceb45822d24b';
let dir: string;

function preparedUpdate(): UpdatePreparedHomebrew {
  return {
    jobId: JOB_ID,
    source: 'homebrew',
    version: '0.5.0',
    preparedAt: '2026-08-04T08:00:00.000Z',
    requestedBy: 'automatic',
    formulaUrl: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
    artifactKind: 'source',
    artifactSha256: 'a'.repeat(64),
    formulaFileSha256: 'b'.repeat(64),
    artifactPath: '/tmp/cache/pythinker-code-0.5.0.tgz',
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pythinker-update-helper-'));
  process.env['PYTHINKER_CODE_HOME'] = dir;
  await writeUpdateInstallState({
    active: {
      version: '0.5.0',
      source: 'homebrew',
      operation: 'prepare',
      jobId: JOB_ID,
      startedAt: '2026-08-04T07:59:00.000Z',
    },
    pending: null,
    lastFailure: null,
    lastSuccess: null,
  });
});

afterEach(async () => {
  delete process.env['PYTHINKER_CODE_HOME'];
  await rm(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('update helper', () => {
  it('owns preparation completion after the launching process hands off', async () => {
    mocks.prepareHomebrewUpdate.mockImplementation(async () => {
      const running = await readUpdateInstallState();
      expect(running.active).toEqual(expect.objectContaining({
        jobId: JOB_ID,
        operation: 'prepare',
        pid: process.pid,
      }));
      return preparedUpdate();
    });

    await expect(
      runUpdateHelper(['prepare-homebrew', JOB_ID, '0.5.0', 'automatic']),
    ).resolves.toBe(0);

    expect(mocks.prepareHomebrewUpdate).toHaveBeenCalledWith(
      { jobId: JOB_ID, requestedVersion: '0.5.0', requestedBy: 'automatic' },
      expect.anything(),
    );
    await expect(readUpdateInstallState()).resolves.toEqual({
      active: null,
      pending: preparedUpdate(),
      lastFailure: null,
      lastSuccess: null,
    });
  });

  it('persists a preparation failure with a retry count and diagnostic message', async () => {
    mocks.prepareHomebrewUpdate.mockRejectedValue(new Error('formula checksum mismatch'));

    await expect(
      runUpdateHelper(['prepare-homebrew', JOB_ID, '0.5.0', 'automatic']),
    ).resolves.toBe(1);

    await expect(readUpdateInstallState()).resolves.toEqual(expect.objectContaining({
      active: null,
      pending: null,
      lastFailure: expect.objectContaining({
        version: '0.5.0',
        attempts: 1,
        operation: 'prepare',
        message: 'formula checksum mismatch',
      }),
    }));
  });

  it('rejects malformed helper arguments without changing install state', async () => {
    const before = await readUpdateInstallState();

    await expect(runUpdateHelper(['prepare-homebrew', 'bad-id', 'nope'])).resolves.toBe(2);

    await expect(readUpdateInstallState()).resolves.toEqual(before);
    expect(mocks.prepareHomebrewUpdate).not.toHaveBeenCalled();
  });

  it('finishes preparation in a detached process after its parent exits', async () => {
    const fakeBin = join(dir, 'bin');
    const fixtureDir = join(dir, 'fixtures');
    const formulaPath = join(fixtureDir, 'pythinker-code.rb');
    const artifactPath = join(fixtureDir, 'pythinker-code-0.5.0.tgz');
    const artifact = Buffer.from('verified package archive');
    const artifactSha256 = createHash('sha256').update(artifact).digest('hex');
    await Promise.all([mkdir(fakeBin), mkdir(fixtureDir)]);
    await writeFile(formulaPath, 'class PythinkerCode < Formula\nend\n');

    const fakeBrewPath = join(fakeBin, 'brew');
    await writeFile(fakeBrewPath, `#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2).join(' ');
if (args === 'update') process.exit(0);
if (args === 'info --json=v2 pythinker-code') {
  process.stdout.write(${JSON.stringify(homebrewInfoFixture(artifactSha256))});
  process.exit(0);
}
if (args === 'formula pythinker-code') {
  process.stdout.write(${JSON.stringify(`${formulaPath}\n`)});
  process.exit(0);
}
if (args === '--cache --build-from-source --formula pythinker-code') {
  process.stdout.write(${JSON.stringify(`${artifactPath}\n`)});
  process.exit(0);
}
if (args === '--prefix pythinker-code') {
  process.stdout.write('/opt/homebrew/opt/pythinker-code\\n');
  process.exit(0);
}
if (args === 'fetch --build-from-source --retry --formula pythinker-code') {
  await new Promise((resolve) => setTimeout(resolve, 250));
  await writeFile(${JSON.stringify(artifactPath)}, Buffer.from('verified package archive'));
  process.exit(0);
}
process.stderr.write('unexpected fake brew command: ' + args + '\\n');
process.exit(1);
`);
    await chmod(fakeBrewPath, 0o755);

    const repoRoot = resolve(import.meta.dirname, '../../../../..');
    const appRoot = join(repoRoot, 'apps', 'pythinker-code');
    const rawTextLoader = join(repoRoot, 'build', 'register-raw-text-loader.mjs');
    const mainPath = join(appRoot, 'src', 'main.ts');
    const tsconfigPath = join(dir, 'tsx-tsconfig.json');
    await writeFile(tsconfigPath, JSON.stringify({
      extends: join(appRoot, 'tsconfig.json'),
      include: [join(appRoot, 'src/**/*.ts'), join(repoRoot, 'packages/**/*.ts')],
    }));
    const helperOutputPath = join(dir, 'helper-output.log');
    const parentPath = join(dir, 'detached-parent.mjs');
    await writeFile(parentPath, `
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
const output = openSync(${JSON.stringify(helperOutputPath)}, 'a');
const child = spawn(process.execPath, [
  '--import', ${JSON.stringify(rawTextLoader)},
  '--import', 'tsx',
  ${JSON.stringify(mainPath)},
  '__update_helper',
  'prepare-homebrew',
  ${JSON.stringify(JOB_ID)},
  '0.5.0',
  'automatic',
], { detached: true, env: process.env, stdio: ['ignore', output, output] });
child.once('error', () => { process.exitCode = 1; });
child.once('spawn', () => { child.unref(); closeSync(output); });
`);

    await runProcess(process.execPath, [parentPath], {
      ...process.env,
      PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      PYTHINKER_CODE_HOME: dir,
      PYTHINKER_CODE_UPDATE_HELPER: '1',
      TSX_TSCONFIG_PATH: tsconfigPath,
    });

    try {
      await vi.waitFor(async () => {
        const state = await readUpdateInstallState();
        expect(state.pending).toEqual(expect.objectContaining({
          jobId: JOB_ID,
          version: '0.5.0',
          requestedBy: 'automatic',
          artifactSha256,
        }));
        expect(state.active).toBeNull();
      }, { timeout: 8_000, interval: 50 });
    } catch (error) {
      const helperOutput = await readFile(helperOutputPath, 'utf-8').catch(() => '<missing>');
      throw new Error(`detached helper did not finish: ${helperOutput}`, { cause: error });
    }

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: true,
      deps: {
        detectSource: async () => 'homebrew',
        activateHomebrew: async (prepared) => ({
          version: prepared.version,
          executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
        }),
      },
    })).resolves.toEqual({
      status: 'activated',
      version: '0.5.0',
      executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
    });

    await expect(activatePendingUpdate('0.5.0', {
      enabled: true,
      automaticEnabled: true,
    })).resolves.toEqual({ status: 'finalized', version: '0.5.0' });
    await expect(readUpdateInstallState()).resolves.toEqual(expect.objectContaining({
      active: null,
      pending: null,
      lastSuccess: expect.objectContaining({ version: '0.5.0' }),
    }));
  }, 12_000);
});

function homebrewInfoFixture(artifactSha256: string): string {
  return JSON.stringify({
    formulae: [{
      name: 'pythinker-code',
      versions: { stable: '0.5.0' },
      urls: {
        stable: {
          url: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
          checksum: artifactSha256,
        },
      },
      linked_keg: '0.4.0',
      pinned: false,
    }],
  });
}

async function runProcess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolveProcess, reject) => {
    const child = spawn(command, [...args], { env, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveProcess();
        return;
      }
      reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}
