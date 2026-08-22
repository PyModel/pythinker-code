import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureRgPath,
  findExistingRg,
  rgUnavailableMessage,
} from '../../src/tools/support/rg-locator';

describe('rg locator', () => {
  let fakeShare: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    fakeShare = mkdtempSync(join(tmpdir(), 'pythinker-rg-'));
    mkdirSync(join(fakeShare, 'bin'), { recursive: true });
    savedPath = process.env['PATH'];
    process.env['PATH'] = '';
  });

  afterEach(() => {
    rmSync(fakeShare, { recursive: true, force: true });
    if (savedPath === undefined) delete process.env['PATH'];
    else process.env['PATH'] = savedPath;
    vi.unstubAllGlobals();
  });

  it('resolves a cached shared binary', async () => {
    const cached = join(fakeShare, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
    writeFileSync(cached, 'fake rg');

    await expect(findExistingRg(fakeShare)).resolves.toEqual({
      path: cached,
      source: 'share-bin-cached',
    });
  });

  it('returns the existing rg unavailable error without downloading', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);

    await expect(ensureRgPath({ shareDir: fakeShare })).rejects.toThrow(
      'ripgrep (rg) is not available on PATH',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the user-facing install hints', () => {
    const message = rgUnavailableMessage(new Error('not found'));

    expect(message).toContain('not found');
    expect(message).toContain('brew install ripgrep');
  });
});
