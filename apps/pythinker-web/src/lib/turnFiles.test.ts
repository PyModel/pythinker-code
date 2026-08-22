import { describe, expect, it } from 'vitest';
import type { ChatTurn, ToolCall } from '../types';
import { turnFileChanges } from './turnFiles';

function edit(
  id: string,
  path: string,
  oldString: string,
  newString: string,
  over: Partial<ToolCall> = {},
): ToolCall {
  return {
    id,
    name: 'edit',
    arg: JSON.stringify({ path, old_string: oldString, new_string: newString }),
    status: 'ok',
    ...over,
  };
}

function turn(tools: ToolCall[]): ChatTurn {
  return {
    id: 'turn-1',
    role: 'assistant',
    no: 1,
    text: '',
    blocks: tools.map((tool) => ({ kind: 'tool', tool })),
  };
}

describe('turnFileChanges', () => {
  it('aggregates two edits to one file and merges their numbered diffs', () => {
    const [change] = turnFileChanges(
      turn([
        edit('a', 'src/a.ts', 'old', 'new'),
        edit('b', 'src/a.ts', 'before', 'after\nextra'),
      ]),
    );

    expect(change).toMatchObject({
      path: 'src/a.ts',
      added: 3,
      removed: 2,
      hasWrite: false,
      statsIncomplete: false,
    });
    expect(change?.diff?.some((line) => line.type === 'hunk' && line.text === '···')).toBe(true);
    expect(change?.diff?.at(-1)?.newNo).toBeGreaterThan(1);
  });

  it('marks writes as incomplete without a synthetic diff', () => {
    const [change] = turnFileChanges(
      turn([
        {
          id: 'w',
          name: 'write',
          arg: JSON.stringify({ path: 'src/new.ts', content: 'new' }),
          status: 'ok',
        },
      ]),
    );
    expect(change).toMatchObject({ hasWrite: true, statsIncomplete: true, diff: null });
  });

  it('ignores error-status edit tools', () => {
    expect(turnFileChanges(turn([edit('a', 'a.ts', 'x', 'y', { status: 'error' })]))).toEqual([]);
  });

  it('collapses normalized relative paths into one entry', () => {
    const changes = turnFileChanges(
      turn([edit('a', 'a/../b.ts', 'x', 'y'), edit('b', 'b.ts', 'one', 'two')]),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.added).toBe(2);
  });

  it('ignores non-edit tools', () => {
    expect(
      turnFileChanges(
        turn([{ id: 'r', name: 'read', arg: JSON.stringify({ path: 'a.ts' }), status: 'ok' }]),
      ),
    ).toEqual([]);
  });
});
