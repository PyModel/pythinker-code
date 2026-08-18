import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePythinkerHome, resolveConfigPath, resolvePythinkerHome } from '#/app/bootstrap/bootstrap';

describe('bootstrap path helpers', () => {
  describe('resolvePythinkerHome', () => {
    it('uses explicit homeDir when provided', () => {
      expect(resolvePythinkerHome('/tmp/pythinker')).toBe('/tmp/pythinker');
    });

    it('falls back to PYTHINKER_CODE_HOME env', () => {
      const prev = process.env['PYTHINKER_CODE_HOME'];
      process.env['PYTHINKER_CODE_HOME'] = '/env/pythinker';
      try {
        expect(resolvePythinkerHome()).toBe('/env/pythinker');
      } finally {
        if (prev === undefined) delete process.env['PYTHINKER_CODE_HOME'];
        else process.env['PYTHINKER_CODE_HOME'] = prev;
      }
    });
  });

  describe('resolveConfigPath', () => {
    it('uses explicit configPath when provided', () => {
      expect(resolveConfigPath({ configPath: '/x/config.toml' })).toBe('/x/config.toml');
    });

    it('joins homeDir with config.toml', () => {
      expect(resolveConfigPath({ homeDir: '/tmp/pythinker' })).toBe('/tmp/pythinker/config.toml');
    });
  });

  describe('ensurePythinkerHome', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('creates the directory with 0700 permissions', () => {
      dir = join(mkdtempSync(join(tmpdir(), 'pythinker-home-')), 'nested');
      ensurePythinkerHome(dir);
      expect(existsSync(dir)).toBe(true);
    });
  });
});
