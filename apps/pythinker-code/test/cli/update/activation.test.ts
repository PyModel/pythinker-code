import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { activatePendingUpdate } from '#/cli/update/activation';
import {
  activateHomebrewUpdate,
  prepareHomebrewUpdate,
  PreparedHomebrewUpdateInvalidError,
  type HomebrewCommandRunner,
} from '#/cli/update/homebrew';
import type { UpdateInstallState, UpdatePreparedHomebrew } from '#/cli/update/types';

function preparedHomebrewUpdate(): UpdatePreparedHomebrew {
  return {
    jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
    source: 'homebrew',
    version: '0.5.0',
    preparedAt: '2026-08-04T08:00:00.000Z',
    requestedBy: 'automatic',
    formulaUrl: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
    artifactKind: 'source',
    artifactSha256: 'a'.repeat(64),
    formulaFileSha256: 'b'.repeat(64),
    artifactPath: '/tmp/homebrew-cache/pythinker-code-0.5.0.tgz',
  };
}

function installState(pending: UpdatePreparedHomebrew): UpdateInstallState {
  return {
    active: null,
    pending,
    lastFailure: null,
    lastSuccess: null,
  };
}

describe('pending update activation', () => {
  it('activates an exactly prepared Homebrew update and leaves finalization to the new process', async () => {
    const pending = preparedHomebrewUpdate();
    const readState = vi.fn().mockResolvedValue(installState(pending));
    const writeState = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn().mockResolvedValue(undefined);
    const activateHomebrew = vi.fn().mockResolvedValue({
      version: '0.5.0',
      executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
    });

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: true,
      deps: {
        readState,
        writeState,
        acquireLock: vi.fn().mockResolvedValue({
          filePath: '/tmp/install.lock',
          release,
        }),
        activateHomebrew,
        detectSource: vi.fn().mockResolvedValue('homebrew'),
        now: () => new Date('2026-08-04T08:05:00.000Z'),
        pid: 42_424,
      },
    })).resolves.toEqual({
      status: 'activated',
      version: '0.5.0',
      executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
    });

    expect(activateHomebrew).toHaveBeenCalledWith(pending);
    expect(writeState).toHaveBeenLastCalledWith(expect.objectContaining({
      pending,
      active: expect.objectContaining({
        version: '0.5.0',
        source: 'homebrew',
        operation: 'activate',
        jobId: pending.jobId,
        pid: 42_424,
      }),
      lastSuccess: null,
    }));
    expect(release).toHaveBeenCalledOnce();
  });

  it('finalizes a prepared update only after the target version starts', async () => {
    const pending = preparedHomebrewUpdate();
    const readState = vi.fn().mockResolvedValue({
      ...installState(pending),
      active: {
        version: '0.5.0',
        source: 'homebrew',
        operation: 'activate',
        jobId: pending.jobId,
        startedAt: '2026-08-04T08:04:00.000Z',
        pid: 42_424,
      },
    });
    const writeState = vi.fn().mockResolvedValue(undefined);

    await expect(activatePendingUpdate('0.5.0', {
      enabled: true,
      automaticEnabled: true,
      deps: {
        readState,
        writeState,
        now: () => new Date('2026-08-04T08:05:00.000Z'),
      },
    })).resolves.toEqual({ status: 'finalized', version: '0.5.0' });

    expect(writeState).toHaveBeenCalledWith({
      active: null,
      pending: null,
      lastFailure: null,
      lastSuccess: {
        version: '0.5.0',
        installedAt: '2026-08-04T08:05:00.000Z',
        notifiedAt: null,
      },
    });
  });

  it('discards a prepared Homebrew update when the active installation source changed', async () => {
    const pending = preparedHomebrewUpdate();
    const writeState = vi.fn().mockResolvedValue(undefined);
    const activateHomebrew = vi.fn();

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: true,
      deps: {
        readState: vi.fn().mockResolvedValue(installState(pending)),
        writeState,
        detectSource: vi.fn().mockResolvedValue('npm-global'),
        activateHomebrew,
      },
    })).resolves.toEqual({ status: 'invalidated', version: '0.5.0' });

    expect(writeState).toHaveBeenCalledWith({
      ...installState(pending),
      active: null,
      pending: null,
    });
    expect(activateHomebrew).not.toHaveBeenCalled();
  });

  it('invalidates stale prepared metadata so preflight can prepare the current formula', async () => {
    const pending = preparedHomebrewUpdate();
    const writeState = vi.fn().mockResolvedValue(undefined);

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: true,
      deps: {
        readState: vi.fn().mockResolvedValue(installState(pending)),
        writeState,
        acquireLock: vi.fn().mockResolvedValue({
          filePath: '/tmp/install.lock',
          release: vi.fn().mockResolvedValue(undefined),
        }),
        activateHomebrew: vi.fn().mockRejectedValue(
          new PreparedHomebrewUpdateInvalidError('formula changed'),
        ),
        detectSource: vi.fn().mockResolvedValue('homebrew'),
        now: () => new Date('2026-08-04T08:05:00.000Z'),
      },
    })).resolves.toEqual({ status: 'invalidated', version: '0.5.0' });

    expect(writeState).toHaveBeenLastCalledWith(expect.objectContaining({
      active: null,
      pending: null,
      lastFailure: expect.objectContaining({
        operation: 'prepare',
        message: 'formula changed',
      }),
    }));
  });

  it('keeps an automatic update pending when automatic installation was disabled', async () => {
    const pending = preparedHomebrewUpdate();
    const detectSource = vi.fn();

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: false,
      deps: {
        readState: vi.fn().mockResolvedValue(installState(pending)),
        detectSource,
      },
    })).resolves.toEqual({ status: 'none' });

    expect(detectSource).not.toHaveBeenCalled();
  });

  it('activates a manually requested update even when automatic installation is disabled', async () => {
    const pending: UpdatePreparedHomebrew = {
      ...preparedHomebrewUpdate(),
      requestedBy: 'manual',
    };

    await expect(activatePendingUpdate('0.4.0', {
      enabled: true,
      automaticEnabled: false,
      deps: {
        readState: vi.fn().mockResolvedValue(installState(pending)),
        writeState: vi.fn().mockResolvedValue(undefined),
        acquireLock: vi.fn().mockResolvedValue({
          filePath: '/tmp/install.lock',
          release: vi.fn().mockResolvedValue(undefined),
        }),
        activateHomebrew: vi.fn().mockResolvedValue({
          version: '0.5.0',
          executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
        }),
        detectSource: vi.fn().mockResolvedValue('homebrew'),
      },
    })).resolves.toEqual(expect.objectContaining({ status: 'activated' }));
  });

  it('does not read update state outside an interactive shell', async () => {
    const readState = vi.fn();

    await expect(activatePendingUpdate('0.4.0', {
      enabled: false,
      automaticEnabled: true,
      deps: { readState },
    })).resolves.toEqual({ status: 'none' });

    expect(readState).not.toHaveBeenCalled();
  });
});

function homebrewInfo(linkedVersion: string | null, version = '0.5.0'): string {
  return JSON.stringify({
    formulae: [{
      name: 'pythinker-code',
      versions: { stable: version },
      urls: {
        stable: {
          url: `https://registry.example.com/pythinker-code-${version}.tgz`,
          checksum: 'a'.repeat(64),
        },
      },
      linked_keg: linkedVersion,
      pinned: false,
    }],
  });
}

function homebrewRunner(formulaVersion = '0.5.0'): {
  run: HomebrewCommandRunner;
  calls: { args: readonly string[]; options: unknown }[];
} {
  let upgraded = false;
  const calls: { args: readonly string[]; options: unknown }[] = [];
  const run: HomebrewCommandRunner = vi.fn(async (args, options) => {
    calls.push({ args, options });
    const command = args.join(' ');
    if (command === 'update' || command.startsWith('fetch ')) return { stdout: '', stderr: '' };
    if (command === 'upgrade --formula --build-from-source --no-ask pythinker-code') {
      upgraded = true;
      return { stdout: '', stderr: '' };
    }
    if (command === 'info --json=v2 pythinker-code') {
      return {
        stdout: homebrewInfo(upgraded ? formulaVersion : '0.4.0', formulaVersion),
        stderr: '',
      };
    }
    if (command === 'formula pythinker-code') {
      return { stdout: '/tmp/tap/Formula/pythinker-code.rb\n', stderr: '' };
    }
    if (command === '--cache --build-from-source --formula pythinker-code') {
      return { stdout: '/tmp/cache/pythinker-code-0.5.0.tgz\n', stderr: '' };
    }
    if (command === '--prefix pythinker-code') {
      return { stdout: '/opt/homebrew/opt/pythinker-code\n', stderr: '' };
    }
    throw new Error(`unexpected brew command: ${command}`);
  });
  return { run, calls };
}

const FORMULA_SOURCE = 'class PythinkerCode < Formula\nend\n';

function homebrewDeps(run: HomebrewCommandRunner) {
  return {
    run,
    hashFile: vi.fn().mockResolvedValue('a'.repeat(64)),
    readFormula: vi.fn().mockResolvedValue(FORMULA_SOURCE),
    ensureExecutable: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-08-04T08:00:00.000Z'),
  };
}

describe('Homebrew update adapter', () => {
  it('refuses to prepare a formula version outside the selected rollout target', async () => {
    const { run, calls } = homebrewRunner('0.6.0');

    await expect(prepareHomebrewUpdate({
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      requestedVersion: '0.5.0',
      requestedBy: 'automatic',
    }, { deps: homebrewDeps(run) })).rejects.toThrow(
      'Homebrew formula 0.6.0 does not match requested update 0.5.0',
    );
    expect(calls.some(({ args }) => args[0] === 'fetch')).toBe(false);
  });

  it('prepares and verifies the exact source artifact in the background', async () => {
    const { run, calls } = homebrewRunner();
    const deps = homebrewDeps(run);

    const prepared = await prepareHomebrewUpdate({
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      requestedVersion: '0.5.0',
      requestedBy: 'automatic',
    }, { deps });

    expect(prepared).toEqual({
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      source: 'homebrew',
      version: '0.5.0',
      preparedAt: '2026-08-04T08:00:00.000Z',
      requestedBy: 'automatic',
      formulaUrl: 'https://registry.example.com/pythinker-code-0.5.0.tgz',
      artifactKind: 'source',
      artifactSha256: 'a'.repeat(64),
      formulaFileSha256: createHash('sha256').update(FORMULA_SOURCE).digest('hex'),
      artifactPath: '/tmp/cache/pythinker-code-0.5.0.tgz',
    });
    expect(calls.some(({ args }) =>
      args.join(' ') === 'fetch --build-from-source --retry --formula pythinker-code'
    )).toBe(true);
    expect(deps.hashFile).toHaveBeenCalledWith('/tmp/cache/pythinker-code-0.5.0.tgz');
  });

  it('freezes Homebrew metadata, installs, verifies the linked keg, and returns the new executable', async () => {
    const { run, calls } = homebrewRunner();
    const deps = homebrewDeps(run);
    const prepared = await prepareHomebrewUpdate({
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      requestedVersion: '0.5.0',
      requestedBy: 'automatic',
    }, { deps });

    await expect(activateHomebrewUpdate(prepared, { deps })).resolves.toEqual({
      version: '0.5.0',
      executable: '/opt/homebrew/opt/pythinker-code/bin/pythinker',
    });

    const upgrade = calls.find(({ args }) => args[0] === 'upgrade');
    expect(upgrade).toEqual(expect.objectContaining({
      options: expect.objectContaining({
        inheritOutput: true,
        env: expect.objectContaining({
          HOMEBREW_NO_AUTO_UPDATE: '1',
          HOMEBREW_NO_INSTALL_CLEANUP: '1',
        }),
      }),
    }));
    expect(deps.ensureExecutable).toHaveBeenCalledWith(
      '/opt/homebrew/opt/pythinker-code/bin/pythinker',
    );
  });

  it('refuses activation when the formula changed after preparation', async () => {
    const { run } = homebrewRunner();
    const deps = homebrewDeps(run);
    const prepared = await prepareHomebrewUpdate({
      jobId: '7e717f78-70c6-4f7c-9745-ceb45822d24b',
      requestedVersion: '0.5.0',
      requestedBy: 'automatic',
    }, { deps });
    deps.readFormula.mockResolvedValue('class ChangedFormula < Formula\nend\n');

    await expect(activateHomebrewUpdate(prepared, { deps })).rejects.toThrow(
      'Homebrew formula changed after the update was prepared',
    );
    expect(run).not.toHaveBeenCalledWith(
      expect.arrayContaining(['upgrade']),
      expect.anything(),
    );
  });
});
