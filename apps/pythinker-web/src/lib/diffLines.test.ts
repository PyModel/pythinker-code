import { describe, expect, it } from 'vitest';

import { computeLineChangeStat } from './diffLines';

describe('computeLineChangeStat', () => {
  it('counts nothing for identical content', () => {
    const text = 'a\nb\nc\n';
    expect(computeLineChangeStat(text, text)).toEqual({ added: 0, removed: 0 });
  });

  it('counts a small edit inside unchanged context', () => {
    expect(computeLineChangeStat('a\nb\nc\nd\n', 'a\nb\nX\nd\n')).toEqual({ added: 1, removed: 1 });
  });

  it('handles pure insertions and deletions', () => {
    expect(computeLineChangeStat('a\nb\n', 'a\nx\ny\nb\n')).toEqual({ added: 2, removed: 0 });
    expect(computeLineChangeStat('a\nx\ny\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 2 });
  });

  it('treats a missing before as all additions', () => {
    expect(computeLineChangeStat(null, 'a\nb\n')).toEqual({ added: 2, removed: 0 });
  });

  it('ignores a trailing newline difference', () => {
    expect(computeLineChangeStat('a\nb', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
  });

  it('falls back to the conservative estimate for huge changed regions', () => {
    const big = Array.from({ length: 700 }, (_, i) => `old ${i}`).join('\n');
    const bigAfter = Array.from({ length: 700 }, (_, i) => `new ${i}`).join('\n');
    expect(computeLineChangeStat(big, bigAfter)).toEqual({ added: 700, removed: 700 });
  });

  it('stays exact for a small edit inside a large file', () => {
    const before = [
      ...Array.from({ length: 900 }, (_, i) => `ctx ${i}`),
      'target',
      ...Array.from({ length: 900 }, (_, i) => `ctx2 ${i}`),
    ].join('\n');
    const after = before.replace('target', 'replaced');
    expect(computeLineChangeStat(before, after)).toEqual({ added: 1, removed: 1 });
  });
});
