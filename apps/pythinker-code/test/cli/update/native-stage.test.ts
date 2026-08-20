import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UPDATE_DISABLED_MESSAGE } from '#/cli/update/cdn';
import { readStagedNativeUpdate, stageNativeUpdate } from '#/cli/update/native-stage';
import { getNativeStagedStateFile, getNativeStagingDir } from '#/utils/paths';

describe('stageNativeUpdate', () => {
  let workDir: string;
  let exePath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'pythinker-stage-test-'));
    exePath = join(workDir, 'bin', 'pythinker');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('rejects with the disabled-update message', async () => {
    await expect(
      stageNativeUpdate({ version: '0.7.0', exePath, platform: 'linux', arch: 'x64' }),
    ).rejects.toThrowError(new Error(UPDATE_DISABLED_MESSAGE));
  });

  it('creates no staging state when updates are disabled', async () => {
    await expect(
      stageNativeUpdate({
        version: '0.7.0',
        exePath,
        platform: 'linux',
        arch: 'x64',
      }),
    ).rejects.toThrowError(new Error(UPDATE_DISABLED_MESSAGE));

    await expect(stat(getNativeStagingDir(exePath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(getNativeStagedStateFile(exePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('readStagedNativeUpdate', () => {
  let workDir: string;
  let exePath: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'pythinker-staged-read-test-'));
    exePath = join(workDir, 'bin', 'pythinker');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('returns null for malformed staged.json content', async () => {
    await mkdir(getNativeStagingDir(exePath), { recursive: true });
    await writeFile(getNativeStagedStateFile(exePath), '{not json', 'utf-8');

    expect(await readStagedNativeUpdate(exePath)).toBeNull();
  });

  it('returns null when exeFileName is not a plain file name', async () => {
    await mkdir(getNativeStagingDir(exePath), { recursive: true });
    await writeFile(
      getNativeStagedStateFile(exePath),
      JSON.stringify({
        version: '0.7.0',
        target: 'linux-x64',
        exeFileName: '../../evil',
        sha256: 'a'.repeat(64),
        exeSize: 42,
        stagedAt: new Date().toISOString(),
      }),
      'utf-8',
    );

    expect(await readStagedNativeUpdate(exePath)).toBeNull();
  });

  it('returns null when the exe size drifted from the metadata', async () => {
    const stagingDir = getNativeStagingDir(exePath);
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, 'pythinker-0.7.0'), Buffer.alloc(43));
    await writeFile(
      getNativeStagedStateFile(exePath),
      JSON.stringify({
        version: '0.7.0',
        target: 'linux-x64',
        exeFileName: 'pythinker-0.7.0',
        sha256: 'a'.repeat(64),
        exeSize: 42,
        stagedAt: new Date().toISOString(),
      }),
      'utf-8',
    );

    expect(await readStagedNativeUpdate(exePath)).toBeNull();
  });
});
