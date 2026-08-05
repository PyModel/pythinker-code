import { describe, expect, it } from 'vitest';

import {
  findTextObject,
  type OperatorRange,
  type TextObjScope,
  type VimBuffer,
} from '../../../../src/tui/editor/vim';

type Cursor = readonly [line: number, column: number];
type TextObjectCase = readonly [
  name: string,
  lines: readonly string[],
  cursor: Cursor,
  scope: TextObjScope,
  kind: string,
  expected: OperatorRange | null,
];

const cases: readonly TextObjectCase[] = [
  ['iw selects a keyword run', ['one two'], [0, 5], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 7,
  }],
  ['iw selects a whitespace run', ['one   two'], [0, 4], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 3, endLine: 0, endColumn: 6,
  }],
  ['aw includes trailing whitespace', ['one two three'], [0, 5], 'around', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 8,
  }],
  ['aw includes leading whitespace when trailing whitespace is absent', ['one two'], [0, 5], 'around', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 3, endLine: 0, endColumn: 7,
  }],
  ['inner quote excludes its delimiters', ['say "hello" now'], [0, 7], 'inner', '"', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 5, endLine: 0, endColumn: 10,
  }],
  ['around quote includes delimiters and a trailing space', ['say "hello" now'], [0, 7], 'around', '"', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 12,
  }],
  ['single quotes are line-local', ["'one' and 'two'"], [0, 12], 'inner', "'", {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 11, endLine: 0, endColumn: 14,
  }],
  ['backticks are supported', ['use `name` now'], [0, 6], 'around', '`', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 11,
  }],
  ['an unmatched quote returns null', ['say "open'], [0, 6], 'inner', '"', null],
  ['quotes never span lines', ['"open', 'close"'], [0, 2], 'inner', '"', null],
  ['inner parentheses choose the innermost nested pair', ['f(g(x))'], [0, 4], 'inner', '(', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 5,
  }],
  ['the closing parenthesis key selects parentheses', ['f(g(x))'], [0, 4], 'around', ')', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 3, endLine: 0, endColumn: 6,
  }],
  ['b aliases parentheses', ['f(g(x))'], [0, 4], 'inner', 'b', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 4, endLine: 0, endColumn: 5,
  }],
  ['square brackets may be nested', ['a[b[c]d]e'], [0, 4], 'around', ']', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 3, endLine: 0, endColumn: 6,
  }],
  ['around braces may span lines', ['a {', '  b', '} c'], [1, 2], 'around', '{', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 2, endLine: 2, endColumn: 1,
  }],
  ['B aliases braces', ['{x}'], [0, 1], 'inner', 'B', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 1, endLine: 0, endColumn: 2,
  }],
  ['angle brackets are supported', ['a <b> c'], [0, 3], 'around', '>', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 2, endLine: 0, endColumn: 5,
  }],
  ['an unmatched bracket returns null', ['a (b'], [0, 3], 'inner', '(', null],
  ['a cursor outside a paired bracket returns null', ['(a) b'], [0, 4], 'inner', '(', null],
  ['a CJK word is selected by grapheme boundaries', ['\u732B\u72D7 bird'], [0, 1], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 0, endLine: 0, endColumn: 2,
  }],
  ['a combining sequence stays inside its keyword run', ['e\u0301x y'], [0, 0], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 0, endLine: 0, endColumn: 2,
  }],
  ['a flag is selected as one grapheme', ['a 🇺🇸 b'], [0, 2], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 2, endLine: 0, endColumn: 3,
  }],
  ['a ZWJ emoji before a quote occupies one column', ['👩‍💻 "e\u0301"'], [0, 3], 'inner', '"', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 3, endLine: 0, endColumn: 4,
  }],
  ['an emoji punctuation run is selected whole', ['a \u{1F600} b'], [0, 2], 'inner', 'w', {
    kind: 'charwise-exclusive', startLine: 0, startColumn: 2, endLine: 0, endColumn: 3,
  }],
];

describe('vim text objects', () => {
  it.each(cases)('%s', (_name, lines, cursor, scope, kind, expected) => {
    const frozenLines = Object.freeze([...lines]);
    const buffer: VimBuffer = Object.freeze({
      lines: frozenLines,
      line: cursor[0],
      column: cursor[1],
    });
    const before = { lines: [...frozenLines], line: buffer.line, column: buffer.column };

    expect(findTextObject(buffer, scope, kind)).toEqual(expected);
    expect(buffer).toEqual(before);
  });
});
