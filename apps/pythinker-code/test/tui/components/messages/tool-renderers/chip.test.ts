import { describe, expect, it } from 'vitest';

import {
  computeEditStats,
  computeWriteStats,
  pickChip,
} from '#/tui/components/messages/tool-renderers/chip';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

function call(name: string, args: Record<string, unknown> = {}): ToolCallBlockData {
  return { id: 'tc', name, args };
}

function result(output: string, isError = false): ToolResultBlockData {
  return { tool_call_id: 'tc', output, is_error: isError };
}

function chipFor(name: string, args: Record<string, unknown>, out: ToolResultBlockData): string {
  const provider = pickChip(name);
  return strip(provider?.(call(name, args), out) ?? '');
}

describe('chip registry', () => {
  it('Bash has no chip (exit code is not surfaced)', () => {
    expect(pickChip('Bash')).toBeUndefined();
  });

  it('Edit chip shows +N -M from args diff', () => {
    const c = chipFor(
      'Edit',
      { path: 'foo.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' },
      result('Replaced 1 occurrence in foo.ts'),
    );
    expect(c).toMatch(/\+\d+/);
    expect(c).toMatch(/-\d+/);
  });

  it('Write chip shows N lines from content arg', () => {
    expect(chipFor('Write', { path: 'a.txt', content: 'a\nb\nc\n' }, result('Wrote a.txt'))).toBe(
      '3 lines',
    );
  });

  it('Read chip shows line count', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo\n2\tbar\n3\tbaz'))).toBe('3 lines');
  });

  it('Read chip handles single line as singular', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo'))).toBe('1 line');
  });

  it('Grep chip shows match count', () => {
    expect(chipFor('Grep', { pattern: 'foo' }, result('a.ts\nb.ts\nc.ts'))).toBe('3 matches');
  });

  it('Grep chip says "no matches" on empty result', () => {
    expect(chipFor('Grep', { pattern: 'foo' }, result(''))).toBe('no matches');
  });

  it('Glob chip shows file count', () => {
    expect(chipFor('Glob', { pattern: '**/*.ts' }, result('a.ts\nb.ts'))).toBe('2 files');
  });

  it('counts only paths on a Glob page with a continuation notice', () => {
    const output = [
      'Showing matches 1\u2013100 of 347.',
      'Continue with the same search arguments and offset=100.',
      'To remove the match-count limit, omit offset and use head_limit=0.',
      ...Array.from({ length: 100 }, (_, i) => `file-${String(i)}.ts`),
    ].join('\n');
    expect(chipFor('Glob', {}, result(output))).toBe('100+ files');
  });

  it.each([
    'No more matches at offset=347 in the current result set (347 matches).',
    'No matches collected; search incomplete.',
    'No non-sensitive matches found (3 sensitive file(s) filtered).',
    'No matches found',
  ])('does not count an empty Glob page as a file: %s', (output) => {
    expect(chipFor('Glob', {}, result(output))).toBe('no files');
  });

  it('ignores Glob footers on a complete page', () => {
    expect(
      chipFor('Glob', {}, result('a.ts\nb.ts\nFiltered 2 sensitive file(s).')),
    ).toBe('2 files');
    expect(chipFor('Glob', {}, result('a.ts\nb.ts\nFound 2 matches'))).toBe('2 files');
  });

  it('ignores Glob warnings that precede a page header', () => {
    const output = [
      'Glob timed out after 15s; partial results returned.',
      'Glob completed with warnings; some directories could not be read: rg: /deep/a: Permission denied',
      'rg: /deep/b: Permission denied',
      'Showing matches 1\u20132 of 2 collected matches (partial result set).',
      'a.ts',
      'b.ts',
    ].join('\n');
    expect(chipFor('Glob', {}, result(output))).toBe('2+ files');
  });

  it('reports no files when a multi-line warning precedes an empty page', () => {
    const output = [
      'Glob completed with warnings; some directories could not be read: rg: /deep/a: Permission denied',
      'rg: /deep/b: Permission denied',
      'No more matches at offset=9 in the collected partial result set (4 matches).',
    ].join('\n');
    expect(chipFor('Glob', {}, result(output))).toBe('no files');
  });

  it('distinguishes the last Glob page from a partial result set', () => {
    expect(chipFor('Glob', {}, result('Showing matches 3\u20134 of 4.\nc.ts\nd.ts'))).toBe('2 files');
    expect(
      chipFor(
        'Glob',
        {},
        result('Showing matches 3\u20134 of 4 collected matches (partial result set).\nc.ts\nd.ts'),
      ),
    ).toBe('2+ files');
  });

  it('keeps notice-like file names and leaves Grep interpretation unchanged', () => {
    expect(
      chipFor('Glob', {}, result('Showing matches.ts\nContinue with.txt\nNo more matches.ts')),
    ).toBe('3 files');
    expect(chipFor('Grep', {}, result('Showing matches 1\u20132 of 3.'))).toBe('1 match');
  });

  it('FetchURL chip shows size and is non-empty', () => {
    const out = chipFor('FetchURL', { url: 'https://example.com' }, result('hello world'));
    expect(out).toMatch(/\d+\s*B/);
  });

  it('WebSearch chip shows result count', () => {
    expect(chipFor('WebSearch', { query: 'pythinker' }, result('1. Alpha\n2. Beta\n3. Gamma'))).toBe(
      '3 results',
    );
  });

  it('Think tool has no chip', () => {
    expect(pickChip('Think')).toBeUndefined();
  });

  it('GetGoal chip shows the current status', () => {
    expect(chipFor('GetGoal', {}, result('{"goal":{"status":"active"}}'))).toBe('active');
  });

  it('GetGoal chip shows when there is no current goal', () => {
    expect(chipFor('GetGoal', {}, result('{"goal":null}'))).toBe('no goal');
  });

  it('CreateGoal chip shows the created status', () => {
    expect(chipFor('CreateGoal', { objective: 'Ship feature X' }, result('{"goal":{"status":"active"}}'))).toBe('active');
  });

  it('SetGoalBudget has no chip because the budget is in the header argument', () => {
    expect(pickChip('SetGoalBudget')).toBeUndefined();
  });

  it('UpdateGoal has no chip because the status is in the header label', () => {
    expect(pickChip('UpdateGoal')).toBeUndefined();
  });

  it('Unknown tools have no chip', () => {
    expect(pickChip('SomethingElse')).toBeUndefined();
  });
});

describe('computeWriteStats', () => {
  it('returns zero lines for empty content', () => {
    expect(computeWriteStats({})).toEqual({ lines: 0 });
    expect(computeWriteStats({ content: '' })).toEqual({ lines: 0 });
  });

  it('counts a single line with no trailing newline', () => {
    expect(computeWriteStats({ content: 'hello' })).toEqual({ lines: 1 });
  });

  it('ignores trailing newline so "a\\nb\\n" is 2 lines', () => {
    expect(computeWriteStats({ content: 'a\nb\n' })).toEqual({ lines: 2 });
    expect(computeWriteStats({ content: 'a\nb' })).toEqual({ lines: 2 });
  });
});

describe('computeEditStats', () => {
  it('returns zero when both strings are empty', () => {
    expect(computeEditStats({})).toEqual({ added: 0, removed: 0 });
    expect(computeEditStats({ old_string: '', new_string: '' })).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it('counts added and removed lines for a replacement', () => {
    const stats = computeEditStats({ old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' });
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });

  it('counts only adds when old is empty', () => {
    const stats = computeEditStats({ old_string: '', new_string: 'x\ny\nz' });
    expect(stats.added).toBe(3);
    expect(stats.removed).toBe(0);
  });
});
