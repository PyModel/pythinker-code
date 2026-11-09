import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { resolveLegacySourceHome, sameLegacyPath } from '#/migration/legacy-source';

const HOME = '/home/user';
const CWD = '/work/project';

describe('resolveLegacySourceHome', () => {
  it('defaults to ~/.pythinker when PYTHINKER_SHARE_DIR is unset', () => {
    const r = resolveLegacySourceHome({}, HOME, CWD);
    expect(r).toEqual({ sourceHome: join(HOME, '.pythinker'), origin: 'default' });
  });

  it('defaults to ~/.pythinker when PYTHINKER_SHARE_DIR is empty or blank', () => {
    expect(resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: '' }, HOME, CWD).origin).toBe('default');
    expect(resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: '   ' }, HOME, CWD).origin).toBe('default');
  });

  it('uses an absolute PYTHINKER_SHARE_DIR verbatim', () => {
    const r = resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: '/data/pythinker' }, HOME, CWD);
    expect(r.sourceHome).toBe('/data/pythinker');
    expect(r.origin).toBe('share-dir');
  });

  it('resolves a relative PYTHINKER_SHARE_DIR against the process CWD (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: 'relative/pythinker' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, 'relative', 'pythinker'));
    expect(r.origin).toBe('share-dir');
  });

  it('does not expand ~ in PYTHINKER_SHARE_DIR (old-CLI rule)', () => {
    const r = resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: '~/custom' }, HOME, CWD);
    expect(r.sourceHome).toBe(join(CWD, '~/custom'));
  });

  it('resolves skills from ~/.pythinker when the share dir is redirected', () => {
    const r = resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: '/data/pythinker' }, HOME, CWD);
    expect(r.skillsSourceHome).toBe(join(HOME, '.pythinker'));
  });

  it('keeps a single source when PYTHINKER_SHARE_DIR points at ~/.pythinker itself', () => {
    const r = resolveLegacySourceHome({ PYTHINKER_SHARE_DIR: join(HOME, '.pythinker') }, HOME, CWD);
    expect(r.skillsSourceHome).toBeUndefined();
  });
});

describe('sameLegacyPath', () => {
  it('matches identical and redundant forms', () => {
    expect(sameLegacyPath('/a/b', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/b/', '/a/b')).toBe(true);
    expect(sameLegacyPath('/a/./b', '/a/b')).toBe(true);
  });

  it('rejects different paths', () => {
    expect(sameLegacyPath('/a/b', '/a/c')).toBe(false);
  });
});
