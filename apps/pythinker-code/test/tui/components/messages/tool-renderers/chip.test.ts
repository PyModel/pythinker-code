import { describe, expect, it } from 'vitest';

import {
  computeEditStats,
  computeWriteStats,
  pickChip,
} from '#/tui/components/messages/tool-renderers/chip';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
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

  it('NotebookEdit chip shows one edited cell', () => {
    expect(
      chipFor(
        'NotebookEdit',
        { notebook_path: 'a.ipynb', cell_id: 'cell-0', new_source: 'print("ok")' },
        result('Updated notebook cell cell-0'),
      ),
    ).toBe('1 cell');
  });

  it('Read chip shows line count', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo\n2\tbar\n3\tbaz'))).toBe('3 lines');
  });

  it('Read chip handles single line as singular', () => {
    expect(chipFor('Read', { path: 'a.ts' }, result('1\tfoo'))).toBe('1 line');
  });

  it('Read chip shows notebook cell count for text and media results', () => {
    const notebookText =
      '<cell id="cell-0">a</cell id="cell-0">\n<cell id="cell-1">b</cell id="cell-1">';
    expect(chipFor('Read', { path: 'a.ipynb' }, result(notebookText))).toBe('2 cells');
    expect(
      chipFor(
        'Read',
        { path: 'a.ipynb' },
        result(JSON.stringify([{ type: 'text', text: notebookText }, { type: 'image_url' }])),
      ),
    ).toBe('2 cells');
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

  it('FetchURL chip shows size and is non-empty', () => {
    const out = chipFor('FetchURL', { url: 'https://example.com' }, result('hello world'));
    expect(out).toMatch(/\d+\s*B/);
  });

  it('WebSearch chip shows result count', () => {
    expect(chipFor('WebSearch', { query: 'pythinker' }, result('1. Alpha\n2. Beta\n3. Gamma'))).toBe(
      '3 results',
    );
  });

  it('MCP resource chips summarize list and read results', () => {
    expect(
      chipFor(
        'ListMcpResourcesTool',
        {},
        result(JSON.stringify([{ uri: 'a' }, { uri: 'b' }])),
      ),
    ).toBe('2 resources');
    expect(
      chipFor(
        'ReadMcpResourceTool',
        {},
        result(JSON.stringify({ contents: [{ text: 'a' }] })),
      ),
    ).toBe('1 content');
  });

  it('project task chips summarize task ids and list size', () => {
    expect(
      chipFor(
        'TaskCreate',
        { subject: 'Port task graph', description: 'Match project task behavior' },
        result('Task #7 created successfully: Port task graph'),
      ),
    ).toBe('task #7');
    expect(chipFor('TaskGet', { taskId: '7' }, result('Task #7: Port task graph'))).toBe(
      'task #7',
    );
    expect(
      chipFor('TaskUpdate', { taskId: '7', status: 'completed' }, result('Task #7 updated: status')),
    ).toBe('task #7');
    expect(
      chipFor(
        'TaskList',
        {},
        result('#1 [completed] Audit\n#7 [in_progress] Port task graph'),
      ),
    ).toBe('2 tasks');
  });

  it('team chips summarize the team and message destination', () => {
    expect(
      chipFor(
        'TeamCreate',
        { team_name: 'porters' },
        result('{"team_name":"porters","lead_agent_id":"main"}'),
      ),
    ).toBe('porters');
    expect(
      chipFor(
        'SendMessage',
        { to: 'runtime', summary: 'Start task', message: 'Claim task #1.' },
        result('{"success":true}'),
      ),
    ).toBe('@runtime');
    expect(
      chipFor(
        'SendMessage',
        { to: '*', summary: 'Status', message: 'Runtime is ready.' },
        result('{"success":true,"recipients":["runtime","tests"]}'),
      ),
    ).toBe('2 teammates');
    expect(
      chipFor('TeamDelete', {}, result('{"success":true,"team_name":"porters"}')),
    ).toBe('deleted');
  });

  it('worktree chips summarize enter and exit outcomes', () => {
    expect(
      chipFor(
        'EnterWorktree',
        { name: 'feature' },
        result(
          'Created worktree at /home/example/.pythinker-code/worktrees/example-feature on branch pythinker-worktree-feature.',
        ),
      ),
    ).toBe('feature');
    expect(
      chipFor(
        'ExitWorktree',
        { action: 'keep' },
        result('Exited worktree. Work is preserved at /tmp/example-feature.'),
      ),
    ).toBe('kept');
    expect(
      chipFor(
        'ExitWorktree',
        { action: 'remove' },
        result('Exited and removed worktree at /tmp/example-feature.'),
      ),
    ).toBe('removed');
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
