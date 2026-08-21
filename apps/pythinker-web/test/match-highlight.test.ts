import { describe, expect, it } from 'vitest';
import {
  computeSlashRanges,
  matchPositions,
  mergeRanges,
  splitByRanges,
  splitHits,
} from '../src/lib/matchHighlight';

describe('matchPositions', () => {
  it('returns [] for an empty query or no match', () => {
    expect(matchPositions('', 'src/App.ts')).toEqual([]);
    expect(matchPositions('zzz', 'src/App.ts')).toEqual([]);
  });

  it('collects every character of every occurrence (case-insensitive)', () => {
    expect(matchPositions('app', 'src/App.vue')).toEqual([4, 5, 6]);
    expect(matchPositions('a', 'src/a.ts, src/a.tsx')).toEqual([4, 14]);
  });

  it('collects multiple occurrences', () => {
    expect(matchPositions('ts', 'src/a.ts and docs/b.ts')).toEqual([6, 7, 20, 21]);
  });
});

describe('splitHits', () => {
  it('returns a single non-hit piece for empty positions', () => {
    expect(splitHits('App.ts', [])).toEqual([{ text: 'App.ts', hit: false }]);
    expect(splitHits('App.ts', undefined)).toEqual([{ text: 'App.ts', hit: false }]);
  });

  it('marks the matched substring as a hit', () => {
    expect(splitHits('App.ts', [0, 1, 2])).toEqual([
      { text: 'App', hit: true },
      { text: '.ts', hit: false },
    ]);
  });

  it('handles positions at the end and multiple runs', () => {
    expect(splitHits('a/b.ts', [0, 1, 4, 5])).toEqual([
      { text: 'a/', hit: true },
      { text: 'b.', hit: false },
      { text: 'ts', hit: true },
    ]);
  });

  it('applies and clamps the offset (positions relative to a longer string)', () => {
    expect(splitHits('App.vue', [4, 5, 6], 4)).toEqual([
      { text: 'App', hit: true },
      { text: '.vue', hit: false },
    ]);
    // Out-of-range positions leave the text unhighlighted.
    expect(splitHits('App.vue', [9, 10], 0)).toEqual([{ text: 'App.vue', hit: false }]);
  });
});

describe('mergeRanges', () => {
  it('merges overlapping and adjacent ranges and sorts', () => {
    expect(mergeRanges([[4, 6], [0, 2], [2, 7]])).toEqual([[0, 7]]);
    expect(mergeRanges([[1, 3], [5, 8]])).toEqual([[1, 3], [5, 8]]);
  });
});

describe('splitByRanges', () => {
  it('splits on exclusive [start, end) ranges', () => {
    expect(splitByRanges('src/main.ts', [[0, 3]])).toEqual([
      { text: 'src', hit: true },
      { text: '/main.ts', hit: false },
    ]);
  });

  it('handles no ranges and clamps out-of-bounds ranges', () => {
    expect(splitByRanges('abc', undefined)).toEqual([{ text: 'abc', hit: false }]);
    expect(splitByRanges('abc', [[-2, 10]])).toEqual([{ text: 'abc', hit: true }]);
    expect(splitByRanges('abc', [[2, 2]])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('computeSlashRanges', () => {
  const item = { name: '/plan', desc: 'Turn plan mode on' };

  it('returns {} for an empty query (with or without /)', () => {
    expect(computeSlashRanges('', item.name, item.desc)).toEqual({});
    expect(computeSlashRanges('/', item.name, item.desc)).toEqual({});
    expect(computeSlashRanges('  ', item.name, item.desc)).toEqual({});
  });

  it('finds a contiguous match in name and description', () => {
    expect(computeSlashRanges('plan', item.name, item.desc)).toEqual({
      name: [[1, 5]],
      desc: [[5, 9]],
    });
  });

  it('case-insensitive matching', () => {
    expect(computeSlashRanges('PLAN', item.name, item.desc)).toEqual({
      name: [[1, 5]],
      desc: [[5, 9]],
    });
  });

  it('falls back to a subsequence match for names', () => {
    expect(computeSlashRanges('pln', item.name, item.desc)).toEqual({
      name: [[1, 5]],
      desc: undefined,
    });
  });

  it('no ranges when nothing matches', () => {
    expect(computeSlashRanges('zzz', item.name, item.desc)).toEqual({});
  });
});