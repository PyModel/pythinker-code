import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentPythinkerRegion, refreshPythinkerRegion } from '#/utils/region';

const originalEnv = { ...process.env };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'pythinker-region-test-'));
  process.env['PYTHINKER_CODE_HOME'] = home;
  delete process.env['PYTHINKER_CODE_REGION_MARKER'];
  refreshPythinkerRegion();
});

afterEach(() => {
  process.env = { ...originalEnv };
  refreshPythinkerRegion();
  rmSync(home, { recursive: true, force: true });
});

describe('currentPythinkerRegion', () => {
  it('follows the install-channel marker', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    expect(refreshPythinkerRegion()).toBe('global');
    expect(currentPythinkerRegion()).toBe('global');
  });

  it('defaults to mainland China when the marker is missing', () => {
    expect(currentPythinkerRegion()).toBe('mainland-cn');
  });

  it('ignores the marker when marker reads are disabled', () => {
    writeFileSync(join(home, 'region'), 'global\n');
    process.env['PYTHINKER_CODE_REGION_MARKER'] = 'off';
    expect(refreshPythinkerRegion()).toBe('mainland-cn');
  });
});
