import { describe, expect, it } from 'vitest';

import {
  applyKey,
  createInitialPersistent,
  createInitialState,
  type PersistentState,
  type VimBuffer,
  type VimState,
} from '../../../../src/tui/editor/vim';

type Cursor = readonly [line: number, column: number];
interface InitialRegister {
  readonly content: string;
  readonly linewise: boolean;
}
interface ExpectedVisual {
  readonly lines: readonly string[];
  readonly cursor: Cursor;
  readonly mode: VimState['mode'];
  readonly register?: string;
  readonly registerIsLinewise?: boolean;
  readonly visualKind?: 'char' | 'line';
}
type VisualCase = readonly [
  name: string,
  initialLines: readonly string[],
  cursor: Cursor,
  keys: string,
  initialRegister: InitialRegister | null,
  expected: ExpectedVisual,
];

function runKeys(
  lines: readonly string[],
  cursor: Cursor,
  keys: string,
  initialRegister: InitialRegister | null = null,
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

function expectedState(
  expected: ExpectedVisual,
):
  | { readonly mode: VimState['mode'] }
  | { readonly mode: VimState['mode']; readonly kind: 'char' | 'line' } {
  return expected.visualKind === undefined
    ? { mode: expected.mode }
    : { mode: expected.mode, kind: expected.visualKind };
}

function expectedRegister(
  expected: ExpectedVisual,
  initialRegister: InitialRegister | null,
): InitialRegister {
  return {
    content: expected.register ?? initialRegister?.content ?? '',
    linewise:
      expected.registerIsLinewise
      ?? initialRegister?.linewise
      ?? false,
  };
}

const cases: readonly VisualCase[] = [
  ['charwise visual selection is inclusive', ['abc'], [0, 0], 'vld', null, {
    lines: ['c'], cursor: [0, 0], mode: 'NORMAL', register: 'ab',
  }],
  ['visual delete removes the character under the cursor', ['abc'], [0, 1], 'vd', null, {
    lines: ['ac'], cursor: [0, 1], mode: 'NORMAL', register: 'b',
  }],
  ['a backward visual selection is normalised', ['abc'], [0, 1], 'vhd', null, {
    lines: ['c'], cursor: [0, 0], mode: 'NORMAL', register: 'ab',
  }],
  ['linewise visual delete removes a whole line', ['one', 'two'], [0, 1], 'Vd', null, {
    lines: ['two'], cursor: [0, 0], mode: 'NORMAL', register: 'one',
    registerIsLinewise: true,
  }],
  ['a counted linewise motion extends the selection', ['one', 'two', 'three', 'four', 'five'], [0, 0], 'V3jd', null, {
    lines: ['five'], cursor: [0, 0], mode: 'NORMAL',
    register: 'one\ntwo\nthree\nfour', registerIsLinewise: true,
  }],
  ['o swaps the visual ends before extending', ['abcde'], [0, 2], 'vhold', null, {
    lines: ['ae'], cursor: [0, 1], mode: 'NORMAL', register: 'bcd',
  }],
  ['v then V switches visual kind without exiting', ['abc'], [0, 1], 'vV', null, {
    lines: ['abc'], cursor: [0, 1], mode: 'VISUAL', visualKind: 'line',
  }],
  ['v exits charwise visual mode', ['abc'], [0, 1], 'vv', null, {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['V exits linewise visual mode', ['abc'], [0, 1], 'VV', null, {
    lines: ['abc'], cursor: [0, 1], mode: 'NORMAL',
  }],
  ['v switches linewise visual mode to charwise', ['abc'], [0, 1], 'Vv', null, {
    lines: ['abc'], cursor: [0, 1], mode: 'VISUAL', visualKind: 'char',
  }],
  ['a counted word motion works in visual mode', ['one two three four'], [0, 0], 'v3wd', null, {
    lines: ['our'], cursor: [0, 0], mode: 'NORMAL', register: 'one two three f',
  }],
  ['a visual text object selects the word under the cursor', ['one two'], [0, 5], 'viwd', null, {
    lines: ['one '], cursor: [0, 3], mode: 'NORMAL', register: 'two',
  }],
  ['a null visual text object leaves an empty buffer untouched', [''], [0, 0], 'viwd', null, {
    lines: [''], cursor: [0, 0], mode: 'NORMAL',
  }],
  ['visual yank feeds a following paste', ['abc'], [0, 0], 'vyp', null, {
    lines: ['aabc'], cursor: [0, 1], mode: 'NORMAL', register: 'a',
  }],
  ['visual paste replaces the selection', ['abcde'], [0, 1], 'vlp', {
    content: 'XY', linewise: false,
  }, {
    lines: ['aXYde'], cursor: [0, 2], mode: 'NORMAL', register: 'bc',
  }],
  ['visual paste preserves an end-of-line insertion boundary', ['abcde'], [0, 3], 'vlp', {
    content: 'XY', linewise: false,
  }, {
    lines: ['abcXY'], cursor: [0, 4], mode: 'NORMAL', register: 'de',
  }],
  ['a linewise register replaces a charwise selection as whole lines', ['abcde'], [0, 1], 'vlp', {
    content: 'XX\nYY', linewise: true,
  }, {
    lines: ['a', 'XX', 'YY', 'de'], cursor: [1, 0], mode: 'NORMAL',
    register: 'bc', registerIsLinewise: false,
  }],
  ['a charwise register replaces a linewise selection as its own line', ['one', 'two'], [0, 0], 'Vp', {
    content: 'XY', linewise: false,
  }, {
    lines: ['XY', 'two'], cursor: [0, 0], mode: 'NORMAL', register: 'one',
    registerIsLinewise: true,
  }],
  ['a linewise register replaces a linewise selection as whole lines', ['one', 'two'], [0, 0], 'Vp', {
    content: 'XX\nYY', linewise: true,
  }, {
    lines: ['XX', 'YY', 'two'], cursor: [0, 0], mode: 'NORMAL',
    register: 'one', registerIsLinewise: true,
  }],
  ['an empty linewise register replaces a charwise selection with an empty line', ['abcde'], [0, 1], 'vlp', {
    content: '', linewise: true,
  }, {
    lines: ['a', '', 'de'], cursor: [1, 0], mode: 'NORMAL',
    register: 'bc', registerIsLinewise: false,
  }],
  ['Escape leaves the visual selection untouched', ['abc'], [0, 1], 'vl\u001B', null, {
    lines: ['abc'], cursor: [0, 2], mode: 'NORMAL',
  }],
  ['delete lands at the normalised selection start', ['abcdef'], [0, 3], 'v2hd', null, {
    lines: ['aef'], cursor: [0, 1], mode: 'NORMAL', register: 'bcd',
  }],
  ['a charwise visual delete may span lines', ['abc', 'def'], [0, 1], 'vjd', null, {
    lines: ['af'], cursor: [0, 1], mode: 'NORMAL', register: 'bc\nde',
  }],
  ['visual delete does not apply operator-motion d-special', ['  a', 'b  ', 'c'], [0, 2], 'vjd', null, {
    lines: ['  ', 'c'], cursor: [0, 1], mode: 'NORMAL', register: 'a\nb  ',
  }],
  ['CJK and emoji are selected as whole graphemes', ['\u732B\u{1F600}x'], [0, 0], 'vld', null, {
    lines: ['x'], cursor: [0, 0], mode: 'NORMAL', register: '\u732B\u{1F600}',
  }],
];

describe('vim visual mode', () => {
  it.each(cases)(
    '%s',
    (_name, initialLines, cursor, keys, initialRegister, expected) => {
      const result = runKeys(
        initialLines,
        cursor,
        keys,
        initialRegister,
      );

      expect(result.buffer).toEqual({
        lines: expected.lines,
        line: expected.cursor[0],
        column: expected.cursor[1],
      });
      expect(result.state).toMatchObject(expectedState(expected));
      expect({
        content: result.persistent.register,
        linewise: result.persistent.registerIsLinewise,
      }).toEqual(expectedRegister(expected, initialRegister));
      expect(result.handled).toBe(true);
    },
  );

  it('is pure for a frozen visual anchor', () => {
    const anchor = Object.freeze({ line: 0, column: 0 });
    const command = Object.freeze({ type: 'idle' as const });
    const state = Object.freeze({
      mode: 'VISUAL' as const,
      kind: 'char' as const,
      anchor,
      command,
    });
    const persistent = Object.freeze({
      ...createInitialPersistent(),
    });
    const lines = Object.freeze(['abc']);
    const buffer = Object.freeze({ lines, line: 0, column: 1 });

    const first = applyKey(state, persistent, buffer, 'd');
    const second = applyKey(state, persistent, buffer, 'd');

    expect(first).toEqual(second);
    expect(state).toEqual({
      mode: 'VISUAL',
      kind: 'char',
      anchor: { line: 0, column: 0 },
      command: { type: 'idle' },
    });
    expect(persistent).toEqual({
      ...createInitialPersistent(),
    });
    expect(buffer).toEqual({ lines: ['abc'], line: 0, column: 1 });
  });
});
