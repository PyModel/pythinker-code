import { describe, expect, it } from 'vitest';

import { VIM_OPEN_LINE_COUNT_CAP } from '../../../../src/tui/constant/vim';
import {
  graphemeColumnAtUtf16Offset,
  graphemes,
  utf16OffsetAtGraphemeColumn,
} from '../../../../src/tui/editor/vim/graphemes';
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
type Step =
  | { readonly keys: string }
  | { readonly insert: string }
  | {
      readonly replaceBuffer: {
        readonly lines: readonly string[];
        readonly cursor: Cursor;
      };
    };
interface ExpectedRepeat {
  readonly lines: readonly string[];
  readonly cursor: Cursor;
  readonly mode?: VimState['mode'];
  readonly register?: string;
  readonly registerIsLinewise?: boolean;
}
type RepeatCase = readonly [
  name: string,
  initialLines: readonly string[],
  cursor: Cursor,
  steps: readonly Step[],
  initialRegister: InitialRegister | null,
  expected: ExpectedRepeat,
];

function utf16PositionOffset(buffer: VimBuffer): number {
  let offset = 0;
  for (let line = 0; line < buffer.line; line += 1) {
    offset += (buffer.lines[line] ?? '').length + 1;
  }
  return offset + utf16OffsetAtGraphemeColumn(
    buffer.lines[buffer.line] ?? '',
    buffer.column,
  );
}

function positionFromUtf16Offset(
  lines: readonly string[],
  sourceOffset: number,
): Cursor {
  let offset = sourceOffset;
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line] ?? '';
    if (offset <= text.length || line === lines.length - 1) {
      return [
        line,
        graphemeColumnAtUtf16Offset(text, Math.min(offset, text.length)),
      ];
    }
    offset -= text.length + 1;
  }
  return [0, 0];
}

function insertText(buffer: VimBuffer, text: string): VimBuffer {
  const source = buffer.lines.join('\n');
  const offset = utf16PositionOffset(buffer);
  const lines = `${source.slice(0, offset)}${text}${source.slice(offset)}`.split('\n');
  const cursor = positionFromUtf16Offset(lines, offset + text.length);
  return { lines, line: cursor[0], column: cursor[1] };
}

function runSteps(
  lines: readonly string[],
  cursor: Cursor,
  steps: readonly Step[],
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

  for (const step of steps) {
    if ('insert' in step) {
      for (const key of graphemes(step.insert)) {
        const result = applyKey(state, persistent, buffer, key);
        state = result.state;
        persistent = result.persistent;
        buffer = insertText(result.buffer, key);
        handled = result.handled;
      }
      continue;
    }
    if ('replaceBuffer' in step) {
      buffer = {
        lines: step.replaceBuffer.lines,
        line: step.replaceBuffer.cursor[0],
        column: step.replaceBuffer.cursor[1],
      };
      continue;
    }
    for (const key of graphemes(step.keys)) {
      const result = applyKey(state, persistent, buffer, key);
      state = result.state;
      persistent = result.persistent;
      buffer = result.buffer;
      handled = result.handled;
    }
  }

  return { state, persistent, buffer, handled };
}

function expectedMode(expected: ExpectedRepeat): VimState['mode'] {
  return expected.mode ?? 'NORMAL';
}

function expectedRegister(
  expected: ExpectedRepeat,
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

const cases: readonly RepeatCase[] = [
  ['dw then dot repeats the operator motion', ['one two three'], [0, 0], [
    { keys: 'dw.' },
  ], null, {
    lines: ['three'], cursor: [0, 0], register: 'two ',
  }],
  ['dw then dot deletes the empty line left by the first change', ['foo', 'bar'], [0, 0], [
    { keys: 'dw.' },
  ], null, {
    lines: ['bar'], cursor: [0, 0], register: '', registerIsLinewise: true,
  }],
  ['dW then dot deletes the empty line left by the first change', ['foo', 'bar'], [0, 0], [
    { keys: 'dW.' },
  ], null, {
    lines: ['bar'], cursor: [0, 0], register: '', registerIsLinewise: true,
  }],
  ['a count on dot replaces the recorded count', ['abcdef'], [0, 0], [
    { keys: 'x3.' },
  ], null, {
    lines: ['ef'], cursor: [0, 0], register: 'bcd',
  }],
  ['dd then dot repeats the linewise operator', ['one', 'two', 'three'], [0, 0], [
    { keys: 'dd.' },
  ], null, {
    lines: ['three'], cursor: [0, 0], register: 'two',
    registerIsLinewise: true,
  }],
  ['ciw replays typed text on another word', ['one two'], [0, 0], [
    { keys: 'ciw' },
    { insert: 'X' },
    { keys: '\u001Bw.' },
  ], null, {
    lines: ['X X'], cursor: [0, 2], register: 'two',
  }],
  ['A replays typed text at another line end', ['one', 'two'], [0, 0], [
    { keys: 'A' },
    { insert: '!' },
    { keys: '\u001Bj.' },
  ], null, {
    lines: ['one!', 'two!'], cursor: [1, 3],
  }],
  ['dot replays a combining mark that joins the preceding grapheme', ['e', 'e'], [0, 0], [
    { keys: 'A' },
    { insert: '\u0301' },
    { keys: '\u001Bj.' },
  ], null, {
    lines: ['e\u0301', 'e\u0301'], cursor: [1, 0],
  }],
  ['o opens a new line and dot repeats it below', ['one', 'two'], [0, 0], [
    { keys: 'o' },
    { insert: 'X' },
    { keys: '\u001B.' },
  ], null, {
    lines: ['one', 'X', 'X', 'two'], cursor: [2, 0],
  }],
  ['O opens a new line and dot repeats it above', ['one', 'two'], [1, 0], [
    { keys: 'O' },
    { insert: 'X' },
    { keys: '\u001B.' },
  ], null, {
    lines: ['one', 'X', 'X', 'two'], cursor: [1, 0],
  }],
  ['a counted o inserts the typed text on separate lines', ['one', 'two'], [0, 0], [
    { keys: '3o' },
    { insert: 'X' },
    { keys: '\u001B' },
  ], null, {
    lines: ['one', 'X', 'X', 'X', 'two'], cursor: [3, 0],
  }],
  ['a counted O inserts the typed text on separate lines', ['one', 'two'], [1, 0], [
    { keys: '3O' },
    { insert: 'X' },
    { keys: '\u001B' },
  ], null, {
    lines: ['one', 'X', 'X', 'X', 'two'], cursor: [3, 0],
  }],
  ['dot replays every line from a counted o', ['one', 'two'], [0, 0], [
    { keys: '2o' },
    { insert: 'X' },
    { keys: '\u001B.' },
  ], null, {
    lines: ['one', 'X', 'X', 'X', 'X', 'two'], cursor: [4, 0],
  }],
  ['dot replays a counted o without inserted text', ['one', 'two'], [0, 0], [
    { keys: '3o\u001B.' },
  ], null, {
    lines: ['one', '', '', '', '', '', '', 'two'], cursor: [6, 0],
  }],
  ['dot replays a counted O without inserted text', ['one', 'two'], [1, 0], [
    { keys: '3O\u001B.' },
  ], null, {
    lines: ['one', '', '', '', '', '', '', 'two'], cursor: [5, 0],
  }],
  ['paste then dot repeats the paste', ['abc'], [0, 0], [
    { keys: 'p.' },
  ], { content: 'X', linewise: false }, {
    lines: ['aXXbc'], cursor: [0, 2], register: 'X',
  }],
  ['yank then dot is a no-op without an earlier change', ['one two'], [0, 0], [
    { keys: 'yw.' },
  ], null, {
    lines: ['one two'], cursor: [0, 0], register: 'one ',
  }],
  ['dot before any change is a no-op', ['abc'], [0, 1], [
    { keys: '.' },
  ], null, {
    lines: ['abc'], cursor: [0, 1],
  }],
  ['a visual delete repeats the same span at the new cursor', ['abcdef'], [0, 0], [
    { keys: 'vldl.' },
  ], null, {
    lines: ['cf'], cursor: [0, 1], register: 'de',
  }],
  ['a counted insert multiplies the typed text', ['x'], [0, 0], [
    { keys: '3i' },
    { insert: 'ab' },
    { keys: '\u001B' },
  ], null, {
    lines: ['abababx'], cursor: [0, 5],
  }],
  ['dot replays a counted insert', ['--'], [0, 0], [
    { keys: '3i' },
    { insert: 'ab' },
    { keys: '\u001B$.' },
  ], null, {
    lines: ['ababab-ababab-'], cursor: [0, 12],
  }],
  ['dot replays inserted text that spans lines', ['ab', 'cd'], [0, 0], [
    { keys: 'A' },
    { insert: 'X\nY' },
    { keys: '\u001BG.' },
  ], null, {
    lines: ['abX', 'Y', 'cdX', 'Y'], cursor: [3, 0],
  }],
  ['yank preserves an earlier repeatable change', ['abc def'], [0, 0], [
    { keys: 'xyw.' },
  ], null, {
    lines: ['c def'], cursor: [0, 0], register: 'b',
  }],
  ['dot replays a visual change with inserted text', ['abcdef'], [0, 0], [
    { keys: 'vlc' },
    { insert: 'X' },
    { keys: '\u001Bl.' },
  ], null, {
    lines: ['XXef'], cursor: [0, 1], register: 'cd',
  }],
  ['dot repeats substitute on an empty line', ['', ''], [0, 0], [
    { keys: 's' },
    { insert: 'X' },
    { keys: '\u001Bj.' },
  ], null, {
    lines: ['X', 'X'], cursor: [1, 0],
  }],
];

describe('vim dot repeat', () => {
  it.each(cases)(
    '%s',
    (_name, initialLines, cursor, steps, initialRegister, expected) => {
      const result = runSteps(
        initialLines,
        cursor,
        steps,
        initialRegister,
      );

      expect(result.buffer).toEqual({
        lines: expected.lines,
        line: expected.cursor[0],
        column: expected.cursor[1],
      });
      expect(result.state.mode).toBe(expectedMode(expected));
      expect({
        content: result.persistent.register,
        linewise: result.persistent.registerIsLinewise,
      }).toEqual(expectedRegister(expected, initialRegister));
      expect(result.handled).toBe(true);
    },
  );

  it.each(['o', 'O'] as const)(
    'caps a huge %s count for allocation, replication, and the repeat spec',
    (command) => {
      const result = runSteps(['one'], [0, 0], [
        { keys: `999999999${command}` },
        { insert: 'X' },
        { keys: '\u001B' },
      ]);

      expect(result.buffer.lines).toHaveLength(VIM_OPEN_LINE_COUNT_CAP + 1);
      expect(result.buffer.lines.filter((line) => line === 'X')).toHaveLength(
        VIM_OPEN_LINE_COUNT_CAP,
      );
      expect(result.persistent.lastChange).toEqual({
        kind: 'insert',
        key: command,
        count: VIM_OPEN_LINE_COUNT_CAP,
        insertedText: 'X',
      });
    },
  );

  it.each(['o', 'O'] as const)(
    'caps a count-replacing dot replay for %s',
    (command) => {
      const result = runSteps(['one'], [0, 0], [
        { keys: command },
        { insert: 'X' },
        { keys: '\u001B999999999.' },
      ]);

      expect(result.buffer.lines).toHaveLength(VIM_OPEN_LINE_COUNT_CAP + 2);
      expect(result.buffer.lines.filter((line) => line === 'X')).toHaveLength(
        VIM_OPEN_LINE_COUNT_CAP + 1,
      );
      expect(result.persistent.lastChange).toEqual({
        kind: 'insert',
        key: command,
        count: VIM_OPEN_LINE_COUNT_CAP,
        insertedText: 'X',
      });
    },
  );

  it('records null inserted text when the buffer changes elsewhere', () => {
    const result = runSteps(['abc'], [0, 1], [
      { keys: 'i' },
      { replaceBuffer: { lines: ['zabc'], cursor: [0, 2] } },
      { keys: '\u001B.' },
    ]);

    expect(result.buffer.lines).toEqual(['zabc']);
    expect(result.persistent.lastChange).toEqual({
      kind: 'insert',
      key: 'i',
      count: 1,
      insertedText: null,
    });
  });

  it('is pure for a frozen INSERT entry', () => {
    const pendingRepeat = Object.freeze({
      kind: 'insert' as const,
      key: 'i',
      count: 1,
      insertedText: null,
    });
    const snapshotCursor = Object.freeze({ line: 0, column: 1 });
    const snapshotLines = Object.freeze(['abc']);
    const entry = Object.freeze({
      pendingRepeat,
      snapshotLines,
      snapshotCursor,
    });
    const state = Object.freeze({ mode: 'INSERT' as const, entry });
    const persistent = Object.freeze({
      ...createInitialPersistent(),
    });
    const lines = Object.freeze(['aXbc']);
    const buffer = Object.freeze({ lines, line: 0, column: 2 });

    const first = applyKey(state, persistent, buffer, '\u001B');
    const second = applyKey(state, persistent, buffer, '\u001B');

    expect(first).toEqual(second);
    expect(entry).toEqual({
      pendingRepeat: {
        kind: 'insert',
        key: 'i',
        count: 1,
        insertedText: null,
      },
      snapshotLines: ['abc'],
      snapshotCursor: { line: 0, column: 1 },
    });
    expect(persistent).toEqual({
      ...createInitialPersistent(),
    });
    expect(buffer).toEqual({ lines: ['aXbc'], line: 0, column: 2 });
  });
});
