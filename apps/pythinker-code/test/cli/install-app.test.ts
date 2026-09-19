import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PythinkerRegionProfile } from '@pymodel/pythinker-code-oauth';

import { registerInstallAppCommand } from '#/cli/sub/install-app';

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  currentPythinkerProfile: vi.fn(() => ({ siteBase: 'https://example.com' }) as unknown as PythinkerRegionProfile),
}));

vi.mock('#/utils/open-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/utils/open-url')>();
  return { ...actual, openUrl: mocks.openUrl };
});

vi.mock('#/utils/region', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/utils/region')>();
  return { ...actual, currentPythinkerProfile: mocks.currentPythinkerProfile };
});

describe('pythinker install-app', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the region-derived desktop app page URL and opens it in the browser', async () => {
    const program = new Command('pythinker');
    registerInstallAppCommand(program);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await program.parseAsync(['node', 'pythinker', 'install-app']);

    expect(write).toHaveBeenCalledWith('https://example.com/code\n');
    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/code');
  });
});
