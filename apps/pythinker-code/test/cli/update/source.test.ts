import { describe, expect, it, vi } from 'vitest';

import {
  classifyByPathHeuristic,
  classifyInstallSource,
  detectInstallSource,
} from '#/cli/update/source';
import { resolveCommandPath } from '#/utils/process/resolve-command';

vi.mock('#/utils/process/resolve-command', () => ({
  resolveCommandPath: vi.fn(),
}));

describe('classifyByPathHeuristic', () => {
  it('returns null for an npm-style global path (handled by classifyInstallSource)', () => {
    expect(classifyByPathHeuristic('/usr/local/lib/node_modules/@pymodel/pythinker-code')).toBeNull();
  });

  it('detects pnpm global on macOS', () => {
    expect(
      classifyByPathHeuristic('/Users/me/Library/pnpm/global/5/node_modules/@pymodel/pythinker-code'),
    ).toBe('pnpm-global');
  });

  it('detects pnpm global on Linux', () => {
    expect(
      classifyByPathHeuristic('/home/me/.local/share/pnpm/global/5/node_modules/@pymodel/pythinker-code'),
    ).toBe('pnpm-global');
  });

  it('detects pnpm global on Windows (normalized backslashes)', () => {
    expect(
      classifyByPathHeuristic('C:\\Users\\me\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@pymodel/pythinker-code'),
    ).toBe('pnpm-global');
  });

  it('detects yarn classic global', () => {
    expect(
      classifyByPathHeuristic('/Users/me/.config/yarn/global/node_modules/@pymodel/pythinker-code'),
    ).toBe('yarn-global');
  });

  it('detects yarn berry global (~/.yarn/global)', () => {
    expect(
      classifyByPathHeuristic('/Users/me/.yarn/global/node_modules/@pymodel/pythinker-code'),
    ).toBe('yarn-global');
  });

  it('detects bun global', () => {
    expect(
      classifyByPathHeuristic('/Users/me/.bun/install/global/node_modules/@pymodel/pythinker-code'),
    ).toBe('bun-global');
  });

  it('detects homebrew on macOS (Cellar path)', () => {
    expect(
      classifyByPathHeuristic('/opt/homebrew/Cellar/pythinker-code/0.5.0/libexec/lib/node_modules/@pymodel/pythinker-code'),
    ).toBe('homebrew');
  });

  it('detects homebrew on Linux (Linuxbrew)', () => {
    expect(
      classifyByPathHeuristic('/home/linuxbrew/.linuxbrew/Cellar/pythinker-code/0.5.0/libexec/lib/node_modules/@pymodel/pythinker-code'),
    ).toBe('homebrew');
  });

  it('does not treat npm-global under Homebrew prefix as homebrew', () => {
    expect(
      classifyByPathHeuristic('/opt/homebrew/lib/node_modules/@pymodel/pythinker-code'),
    ).toBeNull();
  });

  it('returns null for an unknown layout', () => {
    expect(classifyByPathHeuristic('/Users/me/dev/@pymodel/pythinker-code')).toBeNull();
  });
});

describe('classifyInstallSource (npm prefix matching)', () => {
  it('matches a macOS/Linux npm global package path', () => {
    expect(
      classifyInstallSource('/usr/local/lib/node_modules/@pymodel/pythinker-code', '/usr/local', 'darwin'),
    ).toBe('npm-global');
  });

  it('returns unsupported when the package path does not match the prefix', () => {
    expect(
      classifyInstallSource('/Users/me/dev/@pymodel/pythinker-code', '/usr/local', 'darwin'),
    ).toBe('unsupported');
  });
});

describe('detectInstallSource', () => {
  // Every launch calls this. A layout with no reachable package.json used to
  // throw out of the preflight instead of classifying as unsupported.
  it('returns unsupported when the package root cannot be resolved', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => {
          throw new Error('Could not locate package.json near /opt/pythinker');
        },
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'linux',
      }),
    ).resolves.toBe('unsupported');
  });


  it('returns pnpm-global when packageRoot matches pnpm heuristic', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () =>
          '/Users/me/Library/pnpm/global/5/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('pnpm-global');
  });

  it('returns yarn-global when packageRoot matches yarn heuristic', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/Users/me/.config/yarn/global/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('yarn-global');
  });

  it('returns bun-global when packageRoot matches bun heuristic', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/Users/me/.bun/install/global/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('bun-global');
  });

  it('returns npm-global when packageRoot matches npm prefix', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/usr/local/lib/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('npm-global');
  });

  it('returns homebrew when packageRoot matches Cellar heuristic', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () =>
          '/opt/homebrew/Cellar/pythinker-code/0.5.0/libexec/lib/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('homebrew');
  });

  it('returns native when SEA isSea() is true (highest priority)', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/usr/local/lib/node_modules/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => true,
        platform: 'darwin',
      }),
    ).resolves.toBe('native');
  });

  it('returns unsupported when nothing matches', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/Users/me/dev/@pymodel/pythinker-code',
        getGlobalPrefix: async () => '/usr/local',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('unsupported');
  });

  it('returns unsupported when npm prefix lookup throws', async () => {
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/Users/me/dev/@pymodel/pythinker-code',
        getGlobalPrefix: async () => {
          throw new Error('prefix failed');
        },
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('unsupported');
  });

  it('returns unsupported when npm cannot be resolved outside the cwd', async () => {
    // The default prefix lookup spawns npm; when it can only be found inside
    // the current directory (or not at all), detection must degrade to
    // 'unsupported' rather than run a planted binary.
    vi.mocked(resolveCommandPath).mockReturnValue(undefined);
    await expect(
      detectInstallSource({
        getPackageRoot: () => '/Users/me/dev/@pymodel/pythinker-code',
        detectNative: () => false,
        platform: 'darwin',
      }),
    ).resolves.toBe('unsupported');
    expect(resolveCommandPath).toHaveBeenCalledWith('npm');
  });
});
