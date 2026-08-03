import { graphemes } from './graphemes';
import type { OperatorRange } from './operators';
import type { TextObjScope, VimBuffer } from './types';

type CharacterKind = 'blank' | 'keyword' | 'punctuation';

interface BracketPair {
  readonly start: number;
  readonly end: number;
}

const KEYWORD_CHARACTER = /[\p{Letter}\p{Number}_]/u;
const BLANK_CHARACTER = /\s/u;

const BRACKETS: Readonly<
  Record<string, readonly [open: string, close: string]>
> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
  '<': ['<', '>'],
  '>': ['<', '>'],
};

function characterKind(point: string): CharacterKind {
  if (BLANK_CHARACTER.test(point)) {
    return 'blank';
  }
  return KEYWORD_CHARACTER.test(point) ? 'keyword' : 'punctuation';
}

function currentLine(buffer: VimBuffer): number {
  return Math.min(
    Math.max(0, Math.floor(buffer.line)),
    Math.max(0, buffer.lines.length - 1),
  );
}

function currentColumn(points: readonly string[], column: number): number {
  if (points.length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(column)), points.length - 1);
}

function exclusiveRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): OperatorRange {
  return {
    kind: 'charwise-exclusive',
    startLine,
    startColumn,
    endLine,
    endColumn,
  };
}

function findWordObject(
  buffer: VimBuffer,
  scope: TextObjScope,
): OperatorRange | null {
  const line = currentLine(buffer);
  const points = graphemes(buffer.lines[line] ?? '');
  if (points.length === 0) {
    return null;
  }
  const column = currentColumn(points, buffer.column);
  const kind = characterKind(points[column] ?? '');
  let start = column;
  let end = column + 1;
  while (
    start > 0
    && characterKind(points[start - 1] ?? '') === kind
  ) {
    start -= 1;
  }
  while (
    end < points.length
    && characterKind(points[end] ?? '') === kind
  ) {
    end += 1;
  }

  if (scope === 'around' && kind !== 'blank') {
    if (
      end < points.length
      && characterKind(points[end] ?? '') === 'blank'
    ) {
      while (
        end < points.length
        && characterKind(points[end] ?? '') === 'blank'
      ) {
        end += 1;
      }
    } else {
      while (
        start > 0
        && characterKind(points[start - 1] ?? '') === 'blank'
      ) {
        start -= 1;
      }
    }
  }
  return exclusiveRange(line, start, line, end);
}

function findQuoteObject(
  buffer: VimBuffer,
  scope: TextObjScope,
  quote: string,
): OperatorRange | null {
  const line = currentLine(buffer);
  const points = graphemes(buffer.lines[line] ?? '');
  if (points.length === 0) {
    return null;
  }
  const column = currentColumn(points, buffer.column);
  const quoteColumns: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (points[index] === quote) {
      quoteColumns.push(index);
    }
  }
  for (let index = 0; index + 1 < quoteColumns.length; index += 2) {
    const open = quoteColumns[index];
    const close = quoteColumns[index + 1];
    if (
      open !== undefined
      && close !== undefined
      && open <= column
      && column <= close
    ) {
      if (scope === 'inner') {
        return exclusiveRange(line, open + 1, line, close);
      }
      const trailingSpace = points[close + 1] === ' ' ? 1 : 0;
      return exclusiveRange(line, open, line, close + 1 + trailingSpace);
    }
  }
  return null;
}

function flatten(buffer: VimBuffer): {
  readonly points: readonly string[];
  readonly lineStarts: readonly number[];
} {
  const points: string[] = [];
  const lineStarts: number[] = [];
  const lines = buffer.lines.length === 0 ? [''] : buffer.lines;
  for (let line = 0; line < lines.length; line += 1) {
    lineStarts.push(points.length);
    points.push(...graphemes(lines[line] ?? ''));
    if (line < lines.length - 1) {
      points.push('\n');
    }
  }
  return { points, lineStarts };
}

function flatOffset(
  buffer: VimBuffer,
  lineStarts: readonly number[],
): number {
  const line = currentLine(buffer);
  const points = graphemes(buffer.lines[line] ?? '');
  return (lineStarts[line] ?? 0) + currentColumn(points, buffer.column);
}

function boundaryPosition(
  buffer: VimBuffer,
  lineStarts: readonly number[],
  offset: number,
): { readonly line: number; readonly column: number } {
  const lines = buffer.lines.length === 0 ? [''] : buffer.lines;
  for (let line = lines.length - 1; line >= 0; line -= 1) {
    const start = lineStarts[line] ?? 0;
    if (offset >= start) {
      return {
        line,
        column: Math.min(offset - start, graphemes(lines[line] ?? '').length),
      };
    }
  }
  return { line: 0, column: 0 };
}

function bracketPairs(
  points: readonly string[],
  open: string,
  close: string,
): readonly BracketPair[] {
  const stack: number[] = [];
  const pairs: BracketPair[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === open) {
      stack.push(index);
    } else if (point === close) {
      const start = stack.pop();
      if (start !== undefined) {
        pairs.push({ start, end: index });
      }
    }
  }
  return pairs;
}

function findBracketObject(
  buffer: VimBuffer,
  scope: TextObjScope,
  open: string,
  close: string,
): OperatorRange | null {
  const flat = flatten(buffer);
  const cursor = flatOffset(buffer, flat.lineStarts);
  const containing = bracketPairs(flat.points, open, close)
    .filter((pair) => pair.start <= cursor && cursor <= pair.end)
    .toSorted((first, second) => second.start - first.start)[0];
  if (containing === undefined) {
    return null;
  }
  const startOffset =
    scope === 'inner' ? containing.start + 1 : containing.start;
  const endOffset =
    scope === 'inner' ? containing.end : containing.end + 1;
  const start = boundaryPosition(buffer, flat.lineStarts, startOffset);
  const end = boundaryPosition(buffer, flat.lineStarts, endOffset);
  return exclusiveRange(start.line, start.column, end.line, end.column);
}

export function findTextObject(
  buffer: VimBuffer,
  scope: TextObjScope,
  kind: string,
): OperatorRange | null {
  if (kind === 'w') {
    return findWordObject(buffer, scope);
  }
  if (kind === '"' || kind === "'" || kind === '`') {
    return findQuoteObject(buffer, scope, kind);
  }
  const pair = BRACKETS[kind];
  return pair === undefined
    ? null
    : findBracketObject(buffer, scope, pair[0], pair[1]);
}
