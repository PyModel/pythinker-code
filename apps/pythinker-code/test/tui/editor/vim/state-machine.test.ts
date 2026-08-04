import { describe, expect, it } from 'vitest';

import {
  applyKey,
  createInitialPersistent,
  createInitialState,
  type CommandState,
  type PersistentState,
  type VimBuffer,
  type VimMode,
  type VimState,
} from '../../../../src/tui/editor/vim';

type Cursor = readonly [line: number, column: number];
interface ExpectedState {
  readonly lines?: readonly string[];
  readonly initialMode?: VimMode;
  readonly initialDesiredColumn?: number | null;
  readonly cursor: Cursor;
  readonly mode: VimMode;
  readonly command?: CommandState;
  readonly lastFind?: PersistentState['lastFind'];
  readonly desiredColumn?: number | null;
  readonly handled?: boolean;
}
type StateCase = readonly [
  name: string,
  initialLines: readonly string[],
  cursor: Cursor,
  keys: string,
  expected: ExpectedState,
];

function initialState(
  mode: VimMode,
  lines: readonly string[],
  cursor: Cursor,
): VimState {
  return mode === 'INSERT'
    ? {
        mode: 'INSERT',
        entry: {
          pendingRepeat: null,
          snapshotLines: [...lines],
          snapshotCursor: { line: cursor[0], column: cursor[1] },
        },
      }
    : createInitialState();
}

function runKeys(
  lines: readonly string[],
  cursor: Cursor,
  keys: string,
  mode: VimMode,
  desiredColumn: number | null,
): ReturnType<typeof applyKey> {
  let state = initialState(mode, lines, cursor);
  let persistent: PersistentState = {
    ...createInitialPersistent(),
    desiredColumn,
  };
  let buffer: VimBuffer = { lines, line: cursor[0], column: cursor[1] };
  let handled = true;

  for (const key of Array.from(keys)) {
    const result = applyKey(state, persistent, buffer, key);
    state = result.state;
    persistent = result.persistent;
    buffer = result.buffer;
    handled = result.handled;
  }

  return { state, persistent, buffer, handled };
}

const cases: readonly StateCase[] = [
  ['i enters INSERT at the cursor', ['abc'], [0, 1], 'i', { cursor: [0, 1], mode: 'INSERT' }],
  ['I enters INSERT at first non-blank', ['  abc'], [0, 4], 'I', { cursor: [0, 2], mode: 'INSERT' }],
  ['a enters INSERT one character right', ['abc'], [0, 1], 'a', { cursor: [0, 2], mode: 'INSERT' }],
  ['a enters INSERT after the final character', ['abc'], [0, 2], 'a', { cursor: [0, 3], mode: 'INSERT' }],
  ['A enters INSERT at line end', ['abc'], [0, 0], 'A', { cursor: [0, 3], mode: 'INSERT' }],
  ['o opens a blank line below before entering INSERT', ['abc'], [0, 1], 'o', { lines: ['abc', ''], cursor: [1, 0], mode: 'INSERT' }],
  ['O opens a blank line above before entering INSERT', ['abc'], [0, 1], 'O', { lines: ['', 'abc'], cursor: [0, 0], mode: 'INSERT' }],
  ['entering INSERT resets the desired column', ['abc'], [0, 1], 'i', { initialDesiredColumn: 4, cursor: [0, 1], mode: 'INSERT' }],
  ['Escape leaves INSERT and moves left', ['abc'], [0, 2], '\u001B', { initialMode: 'INSERT', cursor: [0, 1], mode: 'NORMAL' }],
  ['Escape leaves INSERT clamped at zero', ['abc'], [0, 0], '\u001B', { initialMode: 'INSERT', cursor: [0, 0], mode: 'NORMAL' }],
  ['Escape clamps an INSERT cursor before moving left', ['abc'], [0, 20], '\u001B', { initialMode: 'INSERT', cursor: [0, 1], mode: 'NORMAL' }],
  ['Escape clamps an empty INSERT line to zero', [''], [0, 20], '\u001B', { initialMode: 'INSERT', cursor: [0, 0], mode: 'NORMAL' }],
  ['INSERT delegates every non-Escape key', ['abc'], [0, 1], 'x', { initialMode: 'INSERT', cursor: [0, 1], mode: 'INSERT', handled: false }],
  ['3w applies a word count', ['one two three four'], [0, 0], '3w', { cursor: [0, 14], mode: 'NORMAL' }],
  ['a direct motion resets the desired column', ['one two'], [0, 0], 'w', { initialDesiredColumn: 5, cursor: [0, 4], mode: 'NORMAL' }],
  ['12j applies a multi-digit count', Array.from({ length: 15 }, (_, index) => `${index}`), [0, 0], '12j', { cursor: [12, 0], mode: 'NORMAL', desiredColumn: 0 }],
  ['sequential vertical motions preserve the desired column', ['abcdef', 'x', 'abcdef'], [0, 4], 'jj', { cursor: [2, 4], mode: 'NORMAL', desiredColumn: 4 }],
  ['a vertical motion reuses a saved desired column', ['abcdef', 'x', 'abcdef'], [1, 0], 'j', { initialDesiredColumn: 4, cursor: [2, 4], mode: 'NORMAL', desiredColumn: 4 }],
  ['a horizontal motion resets vertical column preservation', ['abcdef', 'x', 'abcdef'], [0, 4], 'jhj', { cursor: [2, 0], mode: 'NORMAL', desiredColumn: 0 }],
  ['$ then j aims for the end of the next line', ['abc', 'abcdefgh'], [0, 0], '$j', { cursor: [1, 7], mode: 'NORMAL', desiredColumn: Number.POSITIVE_INFINITY }],
  ['0 is a motion without a pending count', ['abc'], [0, 2], '0', { cursor: [0, 0], mode: 'NORMAL' }],
  ['0 extends an existing count in 10j', Array.from({ length: 12 }, () => 'x'), [0, 0], '10j', { cursor: [10, 0], mode: 'NORMAL', desiredColumn: 0 }],
  ['g enters its pending state', ['a', 'b'], [1, 0], 'g', { cursor: [1, 0], mode: 'NORMAL', command: { type: 'g', count: 1 } }],
  ['gg moves to the first line', ['a', 'b'], [1, 0], 'gg', { cursor: [0, 0], mode: 'NORMAL' }],
  ['3gg moves to a counted line', ['a', 'b', '  c', 'd'], [0, 0], '3gg', { cursor: [2, 2], mode: 'NORMAL' }],
  ['3G moves to a counted line', ['a', 'b', '  c', 'd'], [0, 0], '3G', { cursor: [2, 2], mode: 'NORMAL' }],
  ['G without a count moves to the final line', ['a', 'b', '  c'], [0, 0], 'G', { cursor: [2, 2], mode: 'NORMAL' }],
  ['find plus semicolon and comma repeats and reverses', ['a x x'], [0, 0], 'fx;,', { cursor: [0, 2], mode: 'NORMAL', lastFind: { type: 'f', char: 'x' } }],
  ['repeated t advances past each adjacent target', ['a x x x'], [0, 0], 'tx;;', { cursor: [0, 5], mode: 'NORMAL', lastFind: { type: 't', char: 'x' } }],
  ['repeated T advances past each adjacent target', ['x x x a'], [0, 6], 'Tx;;', { cursor: [0, 1], mode: 'NORMAL', lastFind: { type: 'T', char: 'x' } }],
  ['comma reverses T and advances past an adjacent target', ['x a x x x'], [0, 2], 'Tx,,', { cursor: [0, 5], mode: 'NORMAL', lastFind: { type: 'T', char: 'x' } }],
  ['semicolon before a find is a no-op', ['a x'], [0, 0], ';', { cursor: [0, 0], mode: 'NORMAL', lastFind: null }],
  ['a counted find selects the nth target', ['a x x'], [0, 0], '2fx', { cursor: [0, 4], mode: 'NORMAL', lastFind: { type: 'f', char: 'x' } }],
  ['an unknown g continuation cancels to idle', ['abc'], [0, 1], 'gx', { cursor: [0, 1], mode: 'NORMAL' }],
  ['an unknown counted key cancels to idle', ['abc'], [0, 1], '3q', { cursor: [0, 1], mode: 'NORMAL' }],
  ['Escape cancels a pending command', ['abc'], [0, 1], 'g\u001B', { cursor: [0, 1], mode: 'NORMAL' }],
  ['emoji can be a find target', ['a😀b😀'], [0, 0], '2f😀', { cursor: [0, 3], mode: 'NORMAL', lastFind: { type: 'f', char: '😀' } }],
];

describe('vim state machine', () => {
  function runCase(
    initialLines: readonly string[],
    cursor: Cursor,
    keys: string,
    expected: ExpectedState,
  ): ReturnType<typeof applyKey> {
    return runKeys(
      initialLines,
      cursor,
      keys,
      expected.initialMode ?? 'NORMAL',
      expected.initialDesiredColumn ?? null,
    );
  }

  function expectedVimState(
    expected: ExpectedState,
  ): VimState | { readonly mode: 'INSERT' } {
    if (expected.mode === 'INSERT') {
      return { mode: 'INSERT' };
    }
    if (expected.command !== undefined) {
      return { mode: 'NORMAL', command: expected.command };
    }
    return createInitialState();
  }

  function expectedPersistentState(
    expected: ExpectedState,
  ): Omit<PersistentState, 'lastChange'> {
    return {
      lastFind: expected.lastFind ?? null,
      desiredColumn: expected.desiredColumn ?? null,
      register: '',
      registerIsLinewise: false,
    };
  }

  function legacyVimState(
    state: VimState,
  ): Exclude<VimState, { readonly mode: 'INSERT' }>
    | { readonly mode: 'INSERT' } {
    switch (state.mode) {
      case 'INSERT':
        return { mode: 'INSERT' };
      case 'NORMAL':
      case 'VISUAL':
        return state;
    }
  }

  function legacyPersistentState(
    persistent: PersistentState,
  ): Omit<PersistentState, 'lastChange'> {
    return {
      lastFind: persistent.lastFind,
      desiredColumn: persistent.desiredColumn,
      register: persistent.register,
      registerIsLinewise: persistent.registerIsLinewise,
    };
  }

  function expectedHandled(expected: ExpectedState): boolean {
    return expected.handled ?? true;
  }

  it.each(cases)('%s', (_name, initialLines, cursor, keys, expected) => {
    const result = runCase(initialLines, cursor, keys, expected);

    expect(result.buffer).toEqual({
      lines: expected.lines ?? initialLines,
      line: expected.cursor[0],
      column: expected.cursor[1],
    });
    expect(legacyVimState(result.state)).toEqual(expectedVimState(expected));
    expect(legacyPersistentState(result.persistent)).toEqual(
      expectedPersistentState(expected),
    );
    expect(result.handled).toBe(expectedHandled(expected));
  });

  it.each([
    ['combining sequence', 'ae\u0301b', 'e\u0301'],
    ['flag', 'a🇺🇸b', '🇺🇸'],
    ['ZWJ emoji', 'a👩‍💻b', '👩‍💻'],
  ])('accepts a %s as one find target grapheme', (_name, line, target) => {
    const result = applyKey(
      { mode: 'NORMAL', command: { type: 'find', find: 'f', count: 1 } },
      createInitialPersistent(),
      { lines: [line], line: 0, column: 0 },
      target,
    );

    expect(result).toEqual({
      state: { mode: 'NORMAL', command: { type: 'idle' } },
      persistent: {
        ...createInitialPersistent(),
        lastFind: { type: 'f', char: target },
      },
      buffer: { lines: [line], line: 0, column: 1 },
      handled: true,
    });
  });

  it.each(['ArrowRight', 'bc'])(
    'cancels a find pending state when %s is not one grapheme',
    (key) => {
      const result = applyKey(
        { mode: 'NORMAL', command: { type: 'find', find: 'f', count: 1 } },
        createInitialPersistent(),
        { lines: ['abc'], line: 0, column: 0 },
        key,
      );

      expect(result).toEqual({
        state: { mode: 'NORMAL', command: { type: 'idle' } },
        persistent: createInitialPersistent(),
        buffer: { lines: ['abc'], line: 0, column: 0 },
        handled: true,
      });
    },
  );

  it('never leaks a NORMAL-mode key to the editor', () => {
    const keys = ['h', 'q', 'x', '\n', 'ArrowLeft', '😀'];
    for (const key of keys) {
      const result = applyKey(
        { mode: 'NORMAL', command: { type: 'idle' } },
        createInitialPersistent(),
        { lines: ['abc'], line: 0, column: 1 },
        key,
      );
      expect(result.handled, key).toBe(true);
    }
  });

  it('is pure for frozen inputs', () => {
    const state = Object.freeze({
      mode: 'NORMAL' as const,
      command: Object.freeze({ type: 'count' as const, digits: '2' }),
    });
    const lastFind = Object.freeze({ type: 'f' as const, char: 'x' });
    const persistent = Object.freeze({
      ...createInitialPersistent(),
      lastFind,
    });
    const lines = Object.freeze(['one two three']);
    const buffer = Object.freeze({ lines, line: 0, column: 0 });

    const first = applyKey(state, persistent, buffer, 'w');
    const second = applyKey(state, persistent, buffer, 'w');

    expect(first).toEqual(second);
    expect(state).toEqual({
      mode: 'NORMAL',
      command: { type: 'count', digits: '2' },
    });
    expect(persistent).toEqual({
      ...createInitialPersistent(),
      lastFind: { type: 'f', char: 'x' },
    });
    expect(buffer).toEqual({ lines: ['one two three'], line: 0, column: 0 });
  });
});
