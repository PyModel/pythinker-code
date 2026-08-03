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
  readonly lines: readonly string[];
  readonly cursor: Cursor;
  readonly mode: VimMode;
  readonly command?: CommandState;
  readonly lastFind?: PersistentState['lastFind'];
  readonly register?: string;
  readonly registerIsLinewise?: boolean;
  readonly initialRegister?: InitialRegister;
}
interface InitialRegister {
  readonly content: string;
  readonly linewise: boolean;
}
type OperatorCase = readonly [
  name: string,
  initialLines: readonly string[],
  cursor: Cursor,
  keys: string,
  expected: ExpectedState,
];

function runKeys(
  lines: readonly string[],
  cursor: Cursor,
  keys: string,
  initialRegister?: InitialRegister,
): ReturnType<typeof applyKey> {
  let state: VimState = createInitialState();
  let persistent: PersistentState = {
    ...createInitialPersistent(),
    register: initialRegister?.content ?? '',
    registerIsLinewise: initialRegister?.linewise ?? false,
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

const cases: readonly OperatorCase[] = [
  ['dw deletes from the middle of a word to the next word', ['foo bar'], [0, 1], 'dw', {
    lines: ['fbar'], cursor: [0, 1], mode: 'NORMAL', register: 'oo ',
  }],
  ['dw on the last word does not join the next line', ['foo', 'bar'], [0, 0], 'dw', {
    lines: ['', 'bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo',
  }],
  ['dw on an empty line deletes that line linewise', ['', 'bar'], [0, 0], 'dw', {
    lines: ['bar'], cursor: [0, 0], mode: 'NORMAL', register: '',
    registerIsLinewise: true,
  }],
  ['dW on an empty line deletes that line linewise', ['', 'bar'], [0, 0], 'dW', {
    lines: ['bar'], cursor: [0, 0], mode: 'NORMAL', register: '',
    registerIsLinewise: true,
  }],
  ['dw on trailing whitespace preserves the next line', ['foo ', 'bar'], [0, 3], 'dw', {
    lines: ['foo', 'bar'], cursor: [0, 2], mode: 'NORMAL', register: ' ',
  }],
  ['d2w from trailing whitespace preserves the line after an empty line', ['foo ', '', 'bar'], [0, 3], 'd2w', {
    lines: ['foo', 'bar'], cursor: [0, 2], mode: 'NORMAL', register: ' \n',
  }],
  ['d2W from trailing whitespace preserves the line after an empty line', ['foo ', '', 'bar'], [0, 3], 'd2W', {
    lines: ['foo', 'bar'], cursor: [0, 2], mode: 'NORMAL', register: ' \n',
  }],
  ['d2w from trailing whitespace still reaches a following word', ['foo ', 'bar baz'], [0, 3], 'd2w', {
    lines: ['foobaz'], cursor: [0, 3], mode: 'NORMAL', register: ' \nbar ',
  }],
  ['dW on a whitespace-only line preserves the next line', ['   ', 'bar'], [0, 0], 'dW', {
    lines: ['', 'bar'], cursor: [0, 0], mode: 'NORMAL', register: '   ',
  }],
  ['d2w counts an empty line and preserves target indentation', ['foo', '', '  bar'], [0, 0], 'd2w', {
    lines: ['  bar'], cursor: [0, 2], mode: 'NORMAL', register: 'foo\n',
    registerIsLinewise: true,
  }],
  ['d2W counts an empty line and preserves target indentation', ['foo', '', '  bar'], [0, 0], 'd2W', {
    lines: ['  bar'], cursor: [0, 2], mode: 'NORMAL', register: 'foo\n',
    registerIsLinewise: true,
  }],
  ['y2w makes a final empty-line hop linewise', ['foo', '', '  bar'], [0, 0], 'y2w', {
    lines: ['foo', '', '  bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo\n',
    registerIsLinewise: true,
  }],
  ['y2W makes a final empty-line hop linewise', ['foo', '', '  bar'], [0, 0], 'y2W', {
    lines: ['foo', '', '  bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo\n',
    registerIsLinewise: true,
  }],
  ['d3w applies delete-special after a counted cross-line motion', ['foo', '', 'bar', 'baz'], [0, 0], 'd3w', {
    lines: ['baz'], cursor: [0, 0], mode: 'NORMAL', register: 'foo\n\nbar',
    registerIsLinewise: true,
  }],
  ['d2w through the final word deletes to EOF linewise', ['foo', 'bar'], [0, 0], 'd2w', {
    lines: [''], cursor: [0, 0], mode: 'NORMAL', register: 'foo\nbar',
    registerIsLinewise: true,
  }],
  ['d2W through the final word deletes to EOF linewise', ['foo', 'bar'], [0, 0], 'd2W', {
    lines: [''], cursor: [0, 0], mode: 'NORMAL', register: 'foo\nbar',
    registerIsLinewise: true,
  }],
  ['y2w through EOF remains charwise', ['foo', 'bar'], [0, 0], 'y2w', {
    lines: ['foo', 'bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo\nbar',
  }],
  ['dw is exclusive of the next word', ['foo bar'], [0, 0], 'dw', {
    lines: ['bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo ',
  }],
  ['de is inclusive of the word end', ['foo bar'], [0, 0], 'de', {
    lines: [' bar'], cursor: [0, 0], mode: 'NORMAL', register: 'foo',
  }],
  ['d$ deletes through the end of the line', ['foo bar'], [0, 4], 'd$', {
    lines: ['foo '], cursor: [0, 3], mode: 'NORMAL', register: 'bar',
  }],
  ['dd deletes one whole line', ['one', 'two'], [0, 1], 'dd', {
    lines: ['two'], cursor: [0, 0], mode: 'NORMAL', register: 'one',
    registerIsLinewise: true,
  }],
  ['3dd deletes three whole lines', ['one', 'two', 'three', 'four'], [0, 0], '3dd', {
    lines: ['four'], cursor: [0, 0], mode: 'NORMAL', register: 'one\ntwo\nthree',
    registerIsLinewise: true,
  }],
  ['counts on both sides multiply', ['one two three four five six seven'], [0, 0], '2d3w', {
    lines: ['seven'], cursor: [0, 0], mode: 'NORMAL',
    register: 'one two three four five six ',
  }],
  ['dj is linewise', ['one', '  two', 'three'], [0, 1], 'dj', {
    lines: ['three'], cursor: [0, 0], mode: 'NORMAL', register: 'one\n  two',
    registerIsLinewise: true,
  }],
  ['dk is linewise in the backward direction', ['one', 'two', 'three'], [1, 1], 'dk', {
    lines: ['three'], cursor: [0, 0], mode: 'NORMAL', register: 'one\ntwo',
    registerIsLinewise: true,
  }],
  ['dG deletes through the final line', ['one', 'two', 'three'], [1, 1], 'dG', {
    lines: ['one'], cursor: [0, 0], mode: 'NORMAL', register: 'two\nthree',
    registerIsLinewise: true,
  }],
  ['dgg deletes through the first line', ['one', 'two', 'three'], [2, 1], 'dgg', {
    lines: [''], cursor: [0, 0], mode: 'NORMAL', register: 'one\ntwo\nthree',
    registerIsLinewise: true,
  }],
  ['cw behaves as ce on a non-blank', ['foo bar'], [0, 0], 'cw', {
    lines: [' bar'], cursor: [0, 0], mode: 'INSERT', register: 'foo',
  }],
  ['cc keeps leading indentation and enters INSERT there', ['  foo', 'bar'], [0, 4], 'cc', {
    lines: ['  ', 'bar'], cursor: [0, 2], mode: 'INSERT', register: '  foo',
    registerIsLinewise: true,
  }],
  ['x deletes the character at end of line', ['abc'], [0, 2], 'x', {
    lines: ['ab'], cursor: [0, 1], mode: 'NORMAL', register: 'c',
  }],
  ['x on an empty line is a no-op', [''], [0, 0], 'x', {
    lines: [''], cursor: [0, 0], mode: 'NORMAL',
  }],
  ['X at column zero is a no-op', ['abc'], [0, 0], 'X', {
    lines: ['abc'], cursor: [0, 0], mode: 'NORMAL',
  }],
  ['s deletes a character and enters INSERT', ['abc'], [0, 1], 's', {
    lines: ['ac'], cursor: [0, 1], mode: 'INSERT', register: 'b',
  }],
  ['S clears a line but keeps its indentation', ['  abc'], [0, 3], 'S', {
    lines: ['  '], cursor: [0, 2], mode: 'INSERT', register: '  abc',
    registerIsLinewise: true,
  }],
  ['o opens an indented line below', ['  one', 'two'], [0, 1], 'o', {
    lines: ['  one', '  ', 'two'], cursor: [1, 2], mode: 'INSERT',
  }],
  ['O opens an indented line above', ['one', '  two'], [1, 2], 'O', {
    lines: ['one', '  ', '  two'], cursor: [1, 2], mode: 'INSERT',
  }],
  ['o opens below an empty final line', ['x', ''], [1, 0], 'o', {
    lines: ['x', '', ''], cursor: [2, 0], mode: 'INSERT',
  }],
  ['O opens above the first line', ['one'], [0, 0], 'O', {
    lines: ['', 'one'], cursor: [0, 0], mode: 'INSERT',
  }],
  ['D is d$', ['abc def'], [0, 4], 'D', {
    lines: ['abc '], cursor: [0, 3], mode: 'NORMAL', register: 'def',
  }],
  ['C is c$', ['abc def'], [0, 4], 'C', {
    lines: ['abc '], cursor: [0, 4], mode: 'INSERT', register: 'def',
  }],
  ['Y then p yanks and pastes a whole line below', ['  one', 'two'], [0, 2], 'Yp', {
    lines: ['  one', '  one', 'two'], cursor: [1, 2], mode: 'NORMAL', register: '  one',
    registerIsLinewise: true,
  }],
  ['charwise p inserts after the cursor and lands on the last pasted character', ['abc'], [0, 1], 'p', {
    lines: ['abXYc'], cursor: [0, 3], mode: 'NORMAL', register: 'XY',
    initialRegister: { content: 'XY', linewise: false },
  }],
  ['charwise P inserts before the cursor and lands on the last pasted character', ['abc'], [0, 1], 'P', {
    lines: ['aXYbc'], cursor: [0, 2], mode: 'NORMAL', register: 'XY',
    initialRegister: { content: 'XY', linewise: false },
  }],
  ['linewise p inserts below and lands on its first non-blank', ['one', 'two'], [0, 0], 'p', {
    lines: ['one', '  alpha', 'beta', 'two'], cursor: [1, 2], mode: 'NORMAL',
    register: '  alpha\nbeta', registerIsLinewise: true,
    initialRegister: { content: '  alpha\nbeta', linewise: true },
  }],
  ['linewise P inserts above and lands on its first non-blank', ['one', 'two'], [1, 0], 'P', {
    lines: ['one', '  alpha', 'beta', 'two'], cursor: [1, 2], mode: 'NORMAL',
    register: '  alpha\nbeta', registerIsLinewise: true,
    initialRegister: { content: '  alpha\nbeta', linewise: true },
  }],
  ['linewise p pastes an empty register as one empty line', ['one', 'two'], [0, 0], 'p', {
    lines: ['one', '', 'two'], cursor: [1, 0], mode: 'NORMAL',
    register: '', registerIsLinewise: true,
    initialRegister: { content: '', linewise: true },
  }],
  ['linewise P pastes an empty register as one empty line', ['one', 'two'], [1, 0], 'P', {
    lines: ['one', '', 'two'], cursor: [1, 0], mode: 'NORMAL',
    register: '', registerIsLinewise: true,
    initialRegister: { content: '', linewise: true },
  }],
  ['diw deletes the word under the cursor', ['one two'], [0, 5], 'diw', {
    lines: ['one '], cursor: [0, 3], mode: 'NORMAL', register: 'two',
  }],
  ['daw includes trailing whitespace', ['one two three'], [0, 5], 'daw', {
    lines: ['one three'], cursor: [0, 4], mode: 'NORMAL', register: 'two ',
  }],
  ['daw includes leading whitespace when there is no trailing whitespace', ['one two'], [0, 5], 'daw', {
    lines: ['one'], cursor: [0, 2], mode: 'NORMAL', register: ' two',
  }],
  ['di" deletes inside quotes', ['say "hello" now'], [0, 7], 'di"', {
    lines: ['say "" now'], cursor: [0, 5], mode: 'NORMAL', register: 'hello',
  }],
  ['da" includes quotes and one trailing space', ['say "hello" now'], [0, 7], 'da"', {
    lines: ['say now'], cursor: [0, 4], mode: 'NORMAL', register: '"hello" ',
  }],
  ['di( selects the innermost nested pair', ['f(g(x))'], [0, 4], 'di(', {
    lines: ['f(g())'], cursor: [0, 4], mode: 'NORMAL', register: 'x',
  }],
  ['da{ deletes a bracket object spanning lines', ['a {', '  b', '} c'], [1, 2], 'da{', {
    lines: ['a  c'], cursor: [0, 2], mode: 'NORMAL', register: '{\n  b\n}',
  }],
  ['a missing text object cancels without modifying the buffer', ['say "open'], [0, 6], 'di"', {
    lines: ['say "open'], cursor: [0, 6], mode: 'NORMAL',
  }],
  ['deleting the only line leaves one empty line', ['only'], [0, 0], 'dd', {
    lines: [''], cursor: [0, 0], mode: 'NORMAL', register: 'only',
    registerIsLinewise: true,
  }],
  ['Escape cancels a pending operator', ['abc'], [0, 1], 'd\u001B', {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['Escape cancels an operator count', ['abc'], [0, 1], 'd2\u001B', {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['Escape cancels an operator find', ['abc'], [0, 1], 'df\u001B', {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['Escape cancels an operator text object', ['abc'], [0, 1], 'di\u001B', {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['Escape cancels operator g', ['one', 'two'], [1, 0], 'dg\u001B', {
    lines: ['one', 'two'], cursor: [1, 0], mode: 'NORMAL',
  }],
  ['a different operator cancels the pending operator', ['abc'], [0, 1], 'dc', {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['i after an operator means inner rather than INSERT', ['one two'], [0, 5], 'di', {
    lines: ['one two'], cursor: [0, 5], mode: 'NORMAL',
    command: { type: 'operatorTextObj', op: 'delete', count: 1, scope: 'inner' },
  }],
  ['df is inclusive of the target character', ['a-b-c'], [0, 0], 'dfb', {
    lines: ['-c'], cursor: [0, 0], mode: 'NORMAL', register: 'a-b',
    lastFind: { type: 'f', char: 'b' },
  }],
  ['dt excludes the target character', ['a-b-c'], [0, 0], 'dtb', {
    lines: ['b-c'], cursor: [0, 0], mode: 'NORMAL', register: 'a-',
    lastFind: { type: 't', char: 'b' },
  }],
  ['semicolon repeats a find recorded by an operator', ['a x b x c x'], [0, 0], 'dfx;', {
    lines: [' b x c x'], cursor: [0, 3], mode: 'NORMAL', register: 'a x',
    lastFind: { type: 'f', char: 'x' },
  }],
  ['dh deletes backward without deleting the cursor character', ['abc'], [0, 1], 'dh', {
    lines: ['bc'], cursor: [0, 0], mode: 'NORMAL', register: 'a',
  }],
  ['d0 deletes backward to the line start', ['abc'], [0, 2], 'd0', {
    lines: ['c'], cursor: [0, 0], mode: 'NORMAL', register: 'ab',
  }],
  ['yank does not modify the buffer', ['one two'], [0, 0], 'yw', {
    lines: ['one two'], cursor: [0, 0], mode: 'NORMAL', register: 'one ',
  }],
  ['x removes an emoji as one character', ['a\u{1F600}b'], [0, 1], 'x', {
    lines: ['ab'], cursor: [0, 1], mode: 'NORMAL', register: '\u{1F600}',
  }],
  ['x removes a combining sequence as one grapheme', ['ae\u0301b'], [0, 1], 'x', {
    lines: ['ab'], cursor: [0, 1], mode: 'NORMAL', register: 'e\u0301',
  }],
  ['x removes a flag as one grapheme', ['a🇺🇸b'], [0, 1], 'x', {
    lines: ['ab'], cursor: [0, 1], mode: 'NORMAL', register: '🇺🇸',
  }],
  ['x removes a ZWJ emoji as one grapheme', ['a👩‍💻b'], [0, 1], 'x', {
    lines: ['ab'], cursor: [0, 1], mode: 'NORMAL', register: '👩‍💻',
  }],
  ['dw across CJK code points does not split a character', ['\u732B \u72D7 bird'], [0, 0], 'dw', {
    lines: ['\u72D7 bird'], cursor: [0, 0], mode: 'NORMAL', register: '\u732B ',
  }],
  ['diw selects an emoji word object whole', ['a \u{1F600} b'], [0, 2], 'diw', {
    lines: ['a  b'], cursor: [0, 2], mode: 'NORMAL', register: '\u{1F600}',
  }],
];

describe('vim operators', () => {
  function expectedVimState(
    expected: ExpectedState,
  ): VimState | { readonly mode: 'INSERT' } {
    return expected.mode === 'INSERT'
      ? { mode: 'INSERT' }
      : {
          mode: 'NORMAL',
          command: expected.command ?? { type: 'idle' },
        };
  }

  function expectedPersistentState(
    expected: ExpectedState,
  ): Omit<PersistentState, 'lastChange'> {
    return {
      lastFind: expected.lastFind ?? null,
      desiredColumn: null,
      register: expected.register ?? expected.initialRegister?.content ?? '',
      registerIsLinewise:
        expected.registerIsLinewise
        ?? expected.initialRegister?.linewise
        ?? false,
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

  it.each(cases)('%s', (_name, initialLines, cursor, keys, expected) => {
    const frozenLines = Object.freeze([...initialLines]);
    const frozenCursor = Object.freeze([...cursor]) as Cursor;
    const beforeLines = [...frozenLines];
    const beforeCursor = [...frozenCursor];

    const result = runKeys(
      frozenLines,
      frozenCursor,
      keys,
      expected.initialRegister,
    );

    expect(result.buffer).toEqual({
      lines: expected.lines,
      line: expected.cursor[0],
      column: expected.cursor[1],
    });
    expect(legacyVimState(result.state)).toEqual(expectedVimState(expected));
    expect(legacyPersistentState(result.persistent)).toEqual(
      expectedPersistentState(expected),
    );
    expect(result.handled).toBe(true);
    expect(frozenLines).toEqual(beforeLines);
    expect(frozenCursor).toEqual(beforeCursor);
  });

  it('is pure for fully frozen operator inputs', () => {
    const state = Object.freeze({
      mode: 'NORMAL' as const,
      command: Object.freeze({
        type: 'operator' as const,
        op: 'delete' as const,
        count: 1,
      }),
    });
    const persistent = Object.freeze({
      ...createInitialPersistent(),
    });
    const lines = Object.freeze(['one two']);
    const buffer = Object.freeze({ lines, line: 0, column: 0 });

    const first = applyKey(state, persistent, buffer, 'w');
    const second = applyKey(state, persistent, buffer, 'w');

    expect(first).toEqual(second);
    expect(state.command).toEqual({ type: 'operator', op: 'delete', count: 1 });
    expect(persistent).toEqual({
      ...createInitialPersistent(),
    });
    expect(buffer).toEqual({ lines: ['one two'], line: 0, column: 0 });
  });
});
