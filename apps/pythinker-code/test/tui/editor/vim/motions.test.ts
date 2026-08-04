import { describe, expect, it } from 'vitest';

import {
  findBackward,
  findForward,
  moveBigWordBackward,
  moveBigWordEnd,
  moveBigWordForward,
  moveDown,
  moveFirstNonBlank,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveToFirstLine,
  moveToLastLine,
  moveUp,
  moveWordBackward,
  moveWordEnd,
  moveWordForward,
  tillBackward,
  tillForward,
  type VimBuffer,
} from '../../../../src/tui/editor/vim';

type Cursor = readonly [line: number, column: number];
type MotionCase = readonly [
  name: string,
  initialLines: readonly string[],
  cursor: Cursor,
  keys: string,
  expected: Cursor,
];

function runMotion(lines: readonly string[], cursor: Cursor, keys: string): VimBuffer {
  const buffer: VimBuffer = { lines, line: cursor[0], column: cursor[1] };
  const parsed = /^([1-9][0-9]*)?(gg|[hljkwWbBeE0^$GfFtT])(.*)$/u.exec(keys);
  if (parsed === null) {
    throw new Error(`Invalid motion fixture: ${keys}`);
  }

  const count = parsed[1] === undefined ? 1 : Number.parseInt(parsed[1], 10);
  const motion = parsed[2];
  if (motion === undefined) {
    throw new Error(`Missing motion fixture: ${keys}`);
  }
  const target = parsed[3] ?? '';

  switch (motion) {
    case 'h':
      return moveLeft(buffer, count);
    case 'l':
      return moveRight(buffer, count);
    case 'j':
      return moveDown(buffer, count, buffer.column);
    case 'k':
      return moveUp(buffer, count, buffer.column);
    case 'w':
      return moveWordForward(buffer, count);
    case 'W':
      return moveBigWordForward(buffer, count);
    case 'b':
      return moveWordBackward(buffer, count);
    case 'B':
      return moveBigWordBackward(buffer, count);
    case 'e':
      return moveWordEnd(buffer, count);
    case 'E':
      return moveBigWordEnd(buffer, count);
    case '0':
      return moveLineStart(buffer, count);
    case '^':
      return moveFirstNonBlank(buffer, count);
    case '$':
      return moveLineEnd(buffer, count);
    case 'gg':
      return moveToFirstLine(buffer, count);
    case 'G':
      return moveToLastLine(buffer, parsed[1] === undefined ? undefined : count);
    case 'f':
      return findForward(buffer, count, target);
    case 'F':
      return findBackward(buffer, count, target);
    case 't':
      return tillForward(buffer, count, target);
    case 'T':
      return tillBackward(buffer, count, target);
  }

  throw new Error(`Unsupported motion fixture: ${motion}`);
}

const cases: readonly MotionCase[] = [
  ['h moves left mid-line', ['abcdef'], [0, 3], 'h', [0, 2]],
  ['h clamps at line start', ['abcdef'], [0, 0], 'h', [0, 0]],
  ['h applies a count', ['abcdef'], [0, 5], '3h', [0, 2]],
  ['h clamps an overshooting count', ['abcdef'], [0, 3], '20h', [0, 0]],
  ['h is stable on an empty line', [''], [0, 0], 'h', [0, 0]],
  ['h is stable on one character', ['x'], [0, 0], 'h', [0, 0]],
  ['l moves right mid-line', ['abcdef'], [0, 2], 'l', [0, 3]],
  ['l clamps at line end', ['abcdef'], [0, 5], 'l', [0, 5]],
  ['l applies a count', ['abcdef'], [0, 1], '3l', [0, 4]],
  ['l clamps an overshooting count', ['abcdef'], [0, 2], '20l', [0, 5]],
  ['l is stable on an empty line', [''], [0, 0], 'l', [0, 0]],
  ['l is stable on one character', ['x'], [0, 0], 'l', [0, 0]],
  ['l treats an emoji as one character', ['a😀b'], [0, 0], '2l', [0, 2]],
  ['l treats a combining sequence as one grapheme', ['ae\u0301b'], [0, 0], '2l', [0, 2]],
  ['l treats a flag as one grapheme', ['a🇺🇸b'], [0, 0], '2l', [0, 2]],
  ['l treats a ZWJ emoji as one grapheme', ['a👩‍💻b'], [0, 0], '2l', [0, 2]],

  ['j moves down mid-buffer', ['abcd', 'wxyz'], [0, 2], 'j', [1, 2]],
  ['j clamps at the final line', ['abcd', 'wxyz'], [1, 2], 'j', [1, 2]],
  ['j preserves desired column through a short line', ['abcdef', 'x', 'abcdef'], [0, 4], '2j', [2, 4]],
  ['j clamps an overshooting count', ['abcdef', 'xy'], [0, 4], '20j', [1, 1]],
  ['j clamps onto an empty line', ['abcd', ''], [0, 2], 'j', [1, 0]],
  ['j is stable on a one-character buffer', ['x'], [0, 0], 'j', [0, 0]],
  ['k moves up mid-buffer', ['abcd', 'wxyz'], [1, 2], 'k', [0, 2]],
  ['k clamps at the first line', ['abcd', 'wxyz'], [0, 2], 'k', [0, 2]],
  ['k preserves desired column through a short line', ['abcdef', 'x', 'abcdef'], [2, 4], '2k', [0, 4]],
  ['k clamps an overshooting count', ['xy', 'abcdef'], [1, 4], '20k', [0, 1]],
  ['k clamps onto an empty line', ['', 'abcd'], [1, 2], 'k', [0, 0]],
  ['k is stable on a one-character buffer', ['x'], [0, 0], 'k', [0, 0]],

  ['w moves to the next word', ['one two'], [0, 1], 'w', [0, 4]],
  ['w clamps at the final word', ['one'], [0, 2], 'w', [0, 2]],
  ['w applies a count', ['one two three'], [0, 0], '2w', [0, 8]],
  ['w clamps an overshooting count', ['one two three'], [0, 0], '20w', [0, 8]],
  ['w is stable on an empty line', [''], [0, 0], 'w', [0, 0]],
  ['w is stable on one character', ['x'], [0, 0], 'w', [0, 0]],
  ['w crosses a line boundary', ['one', 'two'], [0, 0], 'w', [1, 0]],
  ['w treats punctuation as a word', ['foo...bar'], [0, 0], '2w', [0, 6]],
  ['w skips multiple spaces', ['foo   bar'], [0, 0], 'w', [0, 6]],
  ['w stops on punctuation in foo.bar baz', ['foo.bar baz'], [0, 0], 'w', [0, 3]],
  ['w crosses Unicode and emoji words without splitting them', ['é 😀 dog'], [0, 0], '2w', [0, 4]],
  ['W moves to the next whitespace-delimited word', ['one two'], [0, 1], 'W', [0, 4]],
  ['W clamps at the final WORD', ['one'], [0, 2], 'W', [0, 2]],
  ['W applies a count', ['one two three'], [0, 0], '2W', [0, 8]],
  ['W clamps an overshooting count', ['one two three'], [0, 0], '20W', [0, 8]],
  ['W is stable on an empty line', [''], [0, 0], 'W', [0, 0]],
  ['W is stable on one character', ['x'], [0, 0], 'W', [0, 0]],
  ['W crosses a line boundary', ['one', 'two'], [0, 0], 'W', [1, 0]],
  ['W keeps punctuation inside a WORD', ['foo.bar baz'], [0, 0], 'W', [0, 8]],
  ['W skips multiple spaces', ['foo   bar'], [0, 0], 'W', [0, 6]],

  ['b moves to the previous word', ['one two'], [0, 6], 'b', [0, 4]],
  ['b clamps at the first word', ['one'], [0, 0], 'b', [0, 0]],
  ['b applies a count', ['one two three'], [0, 8], '2b', [0, 0]],
  ['b clamps an overshooting count', ['one two three'], [0, 8], '20b', [0, 0]],
  ['b is stable on an empty line', [''], [0, 0], 'b', [0, 0]],
  ['b is stable on one character', ['x'], [0, 0], 'b', [0, 0]],
  ['b crosses a line boundary', ['one', 'two'], [1, 0], 'b', [0, 0]],
  ['b treats punctuation as a word', ['foo...bar'], [0, 6], 'b', [0, 3]],
  ['b skips multiple spaces', ['foo   bar'], [0, 6], 'b', [0, 0]],
  ['B moves to the previous whitespace-delimited word', ['one two'], [0, 6], 'B', [0, 4]],
  ['B clamps at the first WORD', ['one'], [0, 0], 'B', [0, 0]],
  ['B applies a count', ['one two three'], [0, 8], '2B', [0, 0]],
  ['B clamps an overshooting count', ['one two three'], [0, 8], '20B', [0, 0]],
  ['B is stable on an empty line', [''], [0, 0], 'B', [0, 0]],
  ['B is stable on one character', ['x'], [0, 0], 'B', [0, 0]],
  ['B crosses a line boundary', ['one', 'two'], [1, 0], 'B', [0, 0]],
  ['B keeps punctuation inside a WORD', ['foo.bar baz'], [0, 8], 'B', [0, 0]],
  ['B skips multiple spaces', ['foo   bar'], [0, 6], 'B', [0, 0]],

  ['e moves to the end of a word', ['one two'], [0, 0], 'e', [0, 2]],
  ['e clamps at the final word end', ['one'], [0, 2], 'e', [0, 2]],
  ['e applies a count', ['one two three'], [0, 0], '2e', [0, 6]],
  ['e clamps an overshooting count', ['one two three'], [0, 0], '20e', [0, 12]],
  ['e is stable on an empty line', [''], [0, 0], 'e', [0, 0]],
  ['e is stable on one character', ['x'], [0, 0], 'e', [0, 0]],
  ['e crosses a line boundary', ['one', 'two'], [0, 0], '2e', [1, 2]],
  ['e treats punctuation as a word', ['foo...bar'], [0, 0], '2e', [0, 5]],
  ['e skips multiple spaces', ['foo   bar'], [0, 2], 'e', [0, 8]],
  ['e stops before punctuation in foo.bar baz', ['foo.bar baz'], [0, 0], 'e', [0, 2]],
  ['E moves to the end of a whitespace-delimited word', ['one two'], [0, 0], 'E', [0, 2]],
  ['E clamps at the final WORD end', ['one'], [0, 2], 'E', [0, 2]],
  ['E applies a count', ['one two three'], [0, 0], '2E', [0, 6]],
  ['E clamps an overshooting count', ['one two three'], [0, 0], '20E', [0, 12]],
  ['E is stable on an empty line', [''], [0, 0], 'E', [0, 0]],
  ['E is stable on one character', ['x'], [0, 0], 'E', [0, 0]],
  ['E crosses a line boundary', ['one', 'two'], [0, 0], '2E', [1, 2]],
  ['E keeps punctuation inside a WORD', ['foo.bar baz'], [0, 0], 'E', [0, 6]],
  ['E skips multiple spaces', ['foo   bar'], [0, 2], 'E', [0, 8]],

  ['0 moves to line start', ['  abc'], [0, 4], '0', [0, 0]],
  ['0 is stable at line start', ['abc'], [0, 0], '0', [0, 0]],
  ['0 ignores a repeated count at its anchor', ['abc'], [0, 2], '30', [0, 0]],
  ['0 clamps an oversized input column', ['abc'], [0, 20], '0', [0, 0]],
  ['0 is stable on an empty line', [''], [0, 0], '0', [0, 0]],
  ['0 is stable on one character', ['x'], [0, 0], '0', [0, 0]],
  ['^ moves to the first non-blank', ['  abc'], [0, 4], '^', [0, 2]],
  ['^ is stable at the first non-blank', ['  abc'], [0, 2], '^', [0, 2]],
  ['^ ignores a count', ['  abc'], [0, 4], '3^', [0, 2]],
  ['^ clamps an oversized input column', ['  abc'], [0, 20], '^', [0, 2]],
  ['^ is stable on an empty line', [''], [0, 0], '^', [0, 0]],
  ['^ is stable on one character', ['x'], [0, 0], '^', [0, 0]],
  ['$ moves to line end', ['abc'], [0, 0], '$', [0, 2]],
  ['$ is stable at line end', ['abc'], [0, 2], '$', [0, 2]],
  ['$ ignores a count', ['abc'], [0, 0], '3$', [0, 2]],
  ['$ clamps an oversized input column', ['abc'], [0, 20], '$', [0, 2]],
  ['$ is stable on an empty line', [''], [0, 0], '$', [0, 0]],
  ['$ is stable on one character', ['x'], [0, 0], '$', [0, 0]],

  ['gg moves to the first line', ['a', '  b', ' c'], [2, 1], 'gg', [0, 0]],
  ['gg is stable at first non-blank on the first line', ['  a', 'b'], [0, 2], 'gg', [0, 2]],
  ['gg uses a count as a one-based line number', ['a', '  b', ' c'], [0, 0], '3gg', [2, 1]],
  ['gg clamps an overshooting count', ['a', '  b'], [0, 0], '20gg', [1, 2]],
  ['gg handles an empty target line', ['', 'b'], [1, 0], 'gg', [0, 0]],
  ['gg is stable on one character', ['x'], [0, 0], 'gg', [0, 0]],
  ['G moves to the final line', ['a', '  b', ' c'], [0, 0], 'G', [2, 1]],
  ['G is stable at first non-blank on the final line', ['a', '  b'], [1, 2], 'G', [1, 2]],
  ['G uses a count as a one-based line number', ['a', '  b', ' c'], [0, 0], '2G', [1, 2]],
  ['G clamps an overshooting count', ['a', '  b'], [0, 0], '20G', [1, 2]],
  ['G handles an empty target line', ['a', ''], [0, 0], 'G', [1, 0]],
  ['G is stable on one character', ['x'], [0, 0], 'G', [0, 0]],

  ['f moves onto a character', ['a x x'], [0, 0], 'fx', [0, 2]],
  ['f is stable when no target follows', ['x a'], [0, 0], 'fx', [0, 0]],
  ['f applies a count', ['a x x'], [0, 0], '2fx', [0, 4]],
  ['f is a no-op when its count overshoots', ['a x x'], [0, 0], '3fx', [0, 0]],
  ['f is stable on an empty line', [''], [0, 0], 'fx', [0, 0]],
  ['f is stable on one character', ['x'], [0, 0], 'fx', [0, 0]],
  ['f finds emoji as a whole character', ['a😀b😀'], [0, 0], '2f😀', [0, 3]],
  ['f finds a combining sequence as one grapheme', ['ae\u0301be\u0301'], [0, 0], '2fe\u0301', [0, 3]],
  ['f finds a flag as one grapheme', ['a🇺🇸b🇺🇸'], [0, 0], '2f🇺🇸', [0, 3]],
  ['f finds a ZWJ emoji as one grapheme', ['a👩‍💻b'], [0, 0], 'f👩‍💻', [0, 1]],
  ['f rejects a multi-grapheme target', ['abc'], [0, 0], 'fbc', [0, 0]],
  ['F moves onto a character', ['x x a'], [0, 4], 'Fx', [0, 2]],
  ['F is stable when no target precedes', ['a x'], [0, 0], 'Fa', [0, 0]],
  ['F applies a count', ['x x a'], [0, 4], '2Fx', [0, 0]],
  ['F is a no-op when its count overshoots', ['x x a'], [0, 4], '3Fx', [0, 4]],
  ['F is stable on an empty line', [''], [0, 0], 'Fx', [0, 0]],
  ['F is stable on one character', ['x'], [0, 0], 'Fx', [0, 0]],
  ['t moves up to a character', ['a x x'], [0, 0], 'tx', [0, 1]],
  ['t clamps before an adjacent target', ['ax'], [0, 0], 'tx', [0, 0]],
  ['t applies a count', ['a x x'], [0, 0], '2tx', [0, 3]],
  ['t is a no-op when its count overshoots', ['a x x'], [0, 0], '3tx', [0, 0]],
  ['t is stable on an empty line', [''], [0, 0], 'tx', [0, 0]],
  ['t is stable on one character', ['x'], [0, 0], 'tx', [0, 0]],
  ['T moves back up to a character', ['x x a'], [0, 4], 'Tx', [0, 3]],
  ['T clamps after an adjacent target', ['xa'], [0, 1], 'Tx', [0, 1]],
  ['T applies a count', ['x x a'], [0, 4], '2Tx', [0, 1]],
  ['T is a no-op when its count overshoots', ['x x a'], [0, 4], '3Tx', [0, 4]],
  ['T is stable on an empty line', [''], [0, 0], 'Tx', [0, 0]],
  ['T is stable on one character', ['x'], [0, 0], 'Tx', [0, 0]],
];

describe('vim motions', () => {
  it.each(cases)('%s', (_name, initialLines, cursor, keys, expected) => {
    const result = runMotion(initialLines, cursor, keys);

    expect(result).toEqual({
      lines: initialLines,
      line: expected[0],
      column: expected[1],
    });
  });
});
