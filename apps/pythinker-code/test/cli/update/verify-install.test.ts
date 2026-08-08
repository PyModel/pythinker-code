import { describe, expect, it, vi } from 'vitest';

import { parseVersionOutput, verifyInstalledVersion } from '#/cli/update/verify-install';

const NEVER_PROBED = {
  probeExecutableVersion: vi.fn(async () => {
    throw new Error('the binary must not be probed for this source');
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

  // Fail open, but say so: an antivirus scan or a slow first start must never
  // turn a good install into a recorded failure that parks the version after
  // two attempts — and the note is what makes the next report diagnosable.
  it('accepts the install unverified when the probe cannot run', async () => {
    await expect(
      verifyInstalledVersion('native', '0.13.1', {
        execPath: '/usr/local/bin/pythinker',
        probeExecutableVersion: async () => {
          throw new Error('ETIMEDOUT');
        },
      }),
    ).resolves.toEqual({
      ok: true,
      unverified: expect.stringContaining('/usr/local/bin/pythinker could not be run'),
    });
  });

  it('accepts the install unverified when the output carries no version', async () => {
    await expect(
      verifyInstalledVersion('native', '0.13.1', {
        probeExecutableVersion: async () => '',
      }),
    ).resolves.toEqual({ ok: true, unverified: expect.stringContaining('printed no version') });
  });

  it('accepts the install unverified when the target is not a version', async () => {
    await expect(
      verifyInstalledVersion('native', 'latest', NEVER_PROBED),
    ).resolves.toEqual({ ok: true, unverified: expect.stringContaining('latest') });
  });
});

describe('verifyInstalledVersion other sources', () => {
  // A global reinstall rewrites the directory this process was loaded from,
  // so nothing readable here proves what the next launch will run.
  it('leaves every non-native source unverified without probing', async () => {
    for (const source of [
      'npm-global',
      'pnpm-global',
      'yarn-global',
      'bun-global',
      'homebrew',
      'unsupported',
    ] as const) {
      await expect(
        verifyInstalledVersion(source, '0.13.1', NEVER_PROBED),
      ).resolves.toEqual({ ok: true, unverified: `not verified for ${source} installs` });
    }
    expect(NEVER_PROBED.probeExecutableVersion).not.toHaveBeenCalled();
  });
});
