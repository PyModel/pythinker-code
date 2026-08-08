import { describe, expect, it, vi } from 'vitest';

import { parseVersionOutput, verifyInstalledVersion } from '#/cli/update/verify-install';

const NEVER_CALLED = {
  probeExecutableVersion: vi.fn(async () => {
    throw new Error('probe must not run for this source');
  }),
  readPackageVersion: vi.fn(async () => {
    throw new Error('package read must not run for this source');
  }),
};

describe('parseVersionOutput', () => {
  it('reads the bare version Commander prints', () => {
    expect(parseVersionOutput('0.13.1\n')).toBe('0.13.1');
  });

  it('finds the version inside surrounding text', () => {
    expect(parseVersionOutput('Pythinker Code v1.2.3 (build 9)')).toBe('1.2.3');
  });

  it('keeps a prerelease suffix', () => {
    expect(parseVersionOutput('2.0.0-rc.1')).toBe('2.0.0-rc.1');
  });

  it('returns null when there is no version to read', () => {
    expect(parseVersionOutput('command not found')).toBeNull();
  });
});

describe('verifyInstalledVersion native', () => {
  it('reports the mismatch when the binary still runs the old version', async () => {
    const result = await verifyInstalledVersion('native', '0.13.1', {
      execPath: 'C:\\Programs\\Pythinker\\pythinker.exe',
      probeExecutableVersion: async () => '0.12.0\n',
    });

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('still reports 0.12.0 (expected 0.13.1)'),
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('pythinker.exe') });
  });

  it('accepts the install when the binary reports the target version', async () => {
    await expect(
      verifyInstalledVersion('native', '0.13.1', {
        probeExecutableVersion: async () => 'v0.13.1',
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('probes the executable that was replaced', async () => {
    const probe = vi.fn(async () => '0.13.1');
    await verifyInstalledVersion('native', '0.13.1', {
      execPath: '/usr/local/bin/pythinker',
      probeExecutableVersion: probe,
    });

    expect(probe).toHaveBeenCalledWith('/usr/local/bin/pythinker');
  });

  // Fail open: an antivirus scan or a slow first start must never turn a good
  // install into a recorded failure that parks the version after two attempts.
  it('accepts the install when the probe cannot run', async () => {
    await expect(
      verifyInstalledVersion('native', '0.13.1', {
        probeExecutableVersion: async () => {
          throw new Error('ETIMEDOUT');
        },
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('accepts the install when the output carries no version', async () => {
    await expect(
      verifyInstalledVersion('native', '0.13.1', {
        probeExecutableVersion: async () => '',
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('verifyInstalledVersion npm family', () => {
  it('reads the installed package rather than spawning the binary', async () => {
    const result = await verifyInstalledVersion('npm-global', '0.13.1', {
      ...NEVER_CALLED,
      readPackageVersion: async () => '0.12.0',
    });

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('still 0.12.0 (expected 0.13.1)'),
    });
    expect(NEVER_CALLED.probeExecutableVersion).not.toHaveBeenCalled();
  });

  it('accepts a package that now carries the target version', async () => {
    for (const source of ['npm-global', 'pnpm-global', 'yarn-global', 'bun-global'] as const) {
      await expect(
        verifyInstalledVersion(source, '0.13.1', {
          ...NEVER_CALLED,
          readPackageVersion: async () => '0.13.1',
        }),
      ).resolves.toEqual({ ok: true });
    }
  });

  it('accepts the install when the package cannot be read', async () => {
    await expect(
      verifyInstalledVersion('npm-global', '0.13.1', {
        ...NEVER_CALLED,
        readPackageVersion: async () => {
          throw new Error('ENOENT');
        },
      }),
    ).resolves.toEqual({ ok: true });
  });
});

describe('verifyInstalledVersion other sources', () => {
  it('checks nothing for homebrew (it installs on the next launch)', async () => {
    await expect(
      verifyInstalledVersion('homebrew', '0.13.1', NEVER_CALLED),
    ).resolves.toEqual({ ok: true });
  });

  it('checks nothing for an unsupported layout', async () => {
    await expect(
      verifyInstalledVersion('unsupported', '0.13.1', NEVER_CALLED),
    ).resolves.toEqual({ ok: true });
  });

  it('checks nothing when the target version is not a version', async () => {
    await expect(
      verifyInstalledVersion('native', 'latest', NEVER_CALLED),
    ).resolves.toEqual({ ok: true });
  });
});
