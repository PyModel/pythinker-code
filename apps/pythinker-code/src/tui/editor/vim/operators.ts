import { graphemes } from './graphemes';
import {
  applyFind,
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
} from './motions';
import type { FindType, Operator, Position, VimBuffer } from './types';

export type RangeKind =
  | 'charwise-exclusive'
  | 'charwise-inclusive'
  | 'linewise';

export interface OperatorRange {
  readonly kind: RangeKind;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface OperatorResult {
  readonly buffer: VimBuffer;
  readonly register: string;
  readonly registerIsLinewise: boolean;
  readonly enterInsert: boolean;
  readonly applied: boolean;
}

interface OrderedOffsets {
  readonly start: number;
  readonly end: number;
}

interface WordForwardResult {
  readonly target: VimBuffer;
  readonly exhausted: boolean;
  readonly finalStepStart: VimBuffer | null;
}

const BLANK_CHARACTER = /\s/u;

function linePoints(buffer: VimBuffer, line: number): readonly string[] {
  return graphemes(buffer.lines[line] ?? '');
}

function clampedLine(buffer: VimBuffer, line: number): number {
  return Math.min(
    Math.max(0, Math.floor(line)),
    Math.max(0, buffer.lines.length - 1),
  );
}

function clampedNormalColumn(points: readonly string[], column: number): number {
  if (points.length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(column)), points.length - 1);
}

function normalBuffer(buffer: VimBuffer): VimBuffer {
  const line = clampedLine(buffer, buffer.line);
  return {
    lines: buffer.lines.length === 0 ? [''] : buffer.lines,
    line,
    column: clampedNormalColumn(linePoints(buffer, line), buffer.column),
  };
}

function firstNonBlank(points: readonly string[]): number {
  const column = points.findIndex((point) => !BLANK_CHARACTER.test(point));
  return Math.max(0, column);
}

function onlyBlank(points: readonly string[]): boolean {
  return points.every((point) => BLANK_CHARACTER.test(point));
}

function leadingIndent(value: string): string {
  const points = graphemes(value);
  let end = 0;
  while (end < points.length && BLANK_CHARACTER.test(points[end] ?? '')) {
    end += 1;
  }
  return points.slice(0, end).join('');
}

function lineStartOffset(lines: readonly string[], targetLine: number): number {
  const line = Math.min(
    Math.max(0, Math.floor(targetLine)),
    Math.max(0, lines.length - 1),
  );
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    offset += graphemes(lines[index] ?? '').length + 1;
  }
  return offset;
}

function positionOffset(
  lines: readonly string[],
  line: number,
  column: number,
): number {
  const targetLine = Math.min(
    Math.max(0, Math.floor(line)),
    Math.max(0, lines.length - 1),
  );
  const points = graphemes(lines[targetLine] ?? '');
  const targetColumn = Math.min(Math.max(0, Math.floor(column)), points.length);
  return lineStartOffset(lines, targetLine) + targetColumn;
}

function positionFromOffset(
  lines: readonly string[],
  sourceOffset: number,
): { readonly line: number; readonly column: number } {
  const safeLines = lines.length === 0 ? [''] : lines;
  let remaining = Math.max(0, Math.floor(sourceOffset));
  for (let line = 0; line < safeLines.length; line += 1) {
    const length = graphemes(safeLines[line] ?? '').length;
    if (remaining <= length || line === safeLines.length - 1) {
      return { line, column: Math.min(remaining, length) };
    }
    remaining -= length + 1;
  }
  return { line: 0, column: 0 };
}

export function graphemeOffset(
  lines: readonly string[],
  position: Position,
): number {
  return positionOffset(lines, position.line, position.column);
}

export function positionAtGraphemeOffset(
  lines: readonly string[],
  offset: number,
): Position {
  return positionFromOffset(lines, offset);
}

function orderedOffsets(
  lines: readonly string[],
  range: OperatorRange,
): OrderedOffsets {
  const first = positionOffset(
    lines,
    range.startLine,
    range.startColumn,
  );
  const second = positionOffset(
    lines,
    range.endLine,
    range.endColumn,
  );
  const start = Math.min(first, second);
  const high = Math.max(first, second);
  return {
    start,
    end: range.kind === 'charwise-inclusive' ? high + 1 : high,
  };
}

function emptyResult(buffer: VimBuffer): OperatorResult {
  return {
    buffer: normalBuffer(buffer),
    register: '',
    registerIsLinewise: false,
    enterInsert: false,
    applied: false,
  };
}

function linewiseRange(
  buffer: VimBuffer,
  startLine: number,
  endLine: number,
): OperatorRange {
  const start = clampedLine(buffer, Math.min(startLine, endLine));
  const end = clampedLine(buffer, Math.max(startLine, endLine));
  return {
    kind: 'linewise',
    startLine: start,
    startColumn: 0,
    endLine: end,
    endColumn: 0,
  };
}

export function doubledOperatorRange(
  buffer: VimBuffer,
  count: number,
): OperatorRange {
  const current = normalBuffer(buffer);
  const repetitions = Math.max(1, Math.floor(count));
  return linewiseRange(
    current,
    current.line,
    current.line + repetitions - 1,
  );
}

function charwiseRange(
  kind: Exclude<RangeKind, 'linewise'>,
  start: VimBuffer,
  end: VimBuffer,
): OperatorRange {
  return {
    kind,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

function sameCursor(first: VimBuffer, second: VimBuffer): boolean {
  return first.line === second.line && first.column === second.column;
}

// One `w`/`W` step: move with the plain motion, but treat an empty line
// between the start and the landed position as a hop target of its own.
// Returns undefined when the motion cannot advance at all.
function nextWordForwardTarget(
  buffer: VimBuffer,
  current: VimBuffer,
  bigWord: boolean,
): VimBuffer | undefined {
  const move = bigWord ? moveBigWordForward : moveWordForward;
  const moved = move(current, 1);
  const searchEnd = sameCursor(current, moved)
    ? buffer.lines.length - 1
    : moved.line;
  for (let line = current.line + 1; line <= searchEnd; line += 1) {
    if ((buffer.lines[line] ?? '') === '') {
      return { lines: buffer.lines, line, column: 0 };
    }
  }
  return sameCursor(current, moved) ? undefined : moved;
}

// Applies `count` forward word steps, reporting whether the motion was
// exhausted early and where the final step started (used by operator ranges
// to decide linewise vs charwise deletion).
function wordForwardTarget(
  buffer: VimBuffer,
  count: number,
  bigWord: boolean,
): WordForwardResult {
  let target = buffer;
  let finalStepStart: VimBuffer | null = null;
  const repetitions = Math.max(1, Math.floor(count));
  for (let index = 0; index < repetitions; index += 1) {
    const stepStart = target;
    const next = nextWordForwardTarget(buffer, stepStart, bigWord);
    if (next === undefined) {
      return { target, exhausted: true, finalStepStart };
    }
    finalStepStart = stepStart;
    target = next;
  }
  return { target, exhausted: false, finalStepStart };
}

export function operatorRangeForFind(
  buffer: VimBuffer,
  count: number,
  find: FindType,
  character: string,
): OperatorRange | null {
  const current = normalBuffer(buffer);
  const target = applyFind(current, count, find, character);
  if (sameCursor(current, target)) {
    return null;
  }
  return charwiseRange('charwise-inclusive', current, target);
}

export function operatorRangeForMotion(
  buffer: VimBuffer,
  motion: string,
  count: number,
  hasExplicitCount = false,
): OperatorRange | null {
  const current = normalBuffer(buffer);
  let target: VimBuffer;
  let kind: RangeKind;

  switch (motion) {
    case 'h':
      target = moveLeft(current, count);
      kind = 'charwise-exclusive';
      break;
    case 'l':
      target = moveRight(current, count);
      kind = 'charwise-exclusive';
      break;
    case 'j':
      target = moveDown(current, count, current.column);
      return sameCursor(current, target)
        ? null
        : linewiseRange(current, current.line, target.line);
    case 'k':
      target = moveUp(current, count, current.column);
      return sameCursor(current, target)
        ? null
        : linewiseRange(current, current.line, target.line);
    case 'w':
    case 'W': {
      const motionResult = wordForwardTarget(current, count, motion === 'W');
      target = motionResult.target;
      if (motionResult.exhausted) {
        return {
          kind: 'charwise-exclusive',
          startLine: current.line,
          startColumn: current.column,
          endLine: target.line,
          endColumn: linePoints(current, target.line).length,
        };
      }

      const finalStepStart = motionResult.finalStepStart;
      if (finalStepStart !== null && finalStepStart.line < target.line) {
        if ((current.lines[finalStepStart.line] ?? '') === '') {
          const endLine = target.line - 1;
          if (
            current.column
            <= firstNonBlank(linePoints(current, current.line))
          ) {
            return linewiseRange(current, current.line, endLine);
          }
          return {
            kind: 'charwise-exclusive',
            startLine: current.line,
            startColumn: current.column,
            endLine,
            endColumn: linePoints(current, endLine).length,
          };
        }
        return {
          kind: 'charwise-exclusive',
          startLine: current.line,
          startColumn: current.column,
          endLine: finalStepStart.line,
          endColumn: linePoints(current, finalStepStart.line).length,
        };
      }
      return charwiseRange('charwise-exclusive', current, target);
    }
    case 'b':
      target = moveWordBackward(current, count);
      kind = 'charwise-exclusive';
      break;
    case 'B':
      target = moveBigWordBackward(current, count);
      kind = 'charwise-exclusive';
      break;
    case 'e':
      target = moveWordEnd(current, count);
      kind = 'charwise-inclusive';
      break;
    case 'E':
      target = moveBigWordEnd(current, count);
      kind = 'charwise-inclusive';
      break;
    case '0':
      target = moveLineStart(current, count);
      kind = 'charwise-exclusive';
      break;
    case '^':
      target = moveFirstNonBlank(current, count);
      kind = 'charwise-exclusive';
      break;
    case '$':
      target = moveLineEnd(current, count);
      kind = 'charwise-inclusive';
      break;
    case 'G':
      target = moveToLastLine(
        current,
        hasExplicitCount ? count : undefined,
      );
      return linewiseRange(current, current.line, target.line);
    case 'gg':
      target = moveToFirstLine(current, count);
      return linewiseRange(current, current.line, target.line);
    default:
      return null;
  }

  if (
    sameCursor(current, target)
    && kind === 'charwise-exclusive'
  ) {
    return null;
  }
  return charwiseRange(kind, current, target);
}

function applyLinewise(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorResult {
  const current = normalBuffer(buffer);
  const startLine = Math.min(range.startLine, range.endLine);
  const endLine = Math.max(range.startLine, range.endLine);
  const register = current.lines.slice(startLine, endLine + 1).join('\n');
  if (op === 'yank') {
    return {
      buffer: current,
      register,
      registerIsLinewise: true,
      enterInsert: false,
      applied: true,
    };
  }

  if (op === 'change') {
    const indent = leadingIndent(current.lines[startLine] ?? '');
    const lines = [
      ...current.lines.slice(0, startLine),
      indent,
      ...current.lines.slice(endLine + 1),
    ];
    return {
      buffer: { lines, line: startLine, column: graphemes(indent).length },
      register,
      registerIsLinewise: true,
      enterInsert: true,
      applied: true,
    };
  }

  const remaining = [
    ...current.lines.slice(0, startLine),
    ...current.lines.slice(endLine + 1),
  ];
  const lines = remaining.length === 0 ? [''] : remaining;
  const line = Math.min(startLine, lines.length - 1);
  return {
    buffer: {
      lines,
      line,
      column: firstNonBlank(graphemes(lines[line] ?? '')),
    },
    register,
    registerIsLinewise: true,
    enterInsert: false,
    applied: true,
  };
}

function applyCharwise(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorResult {
  const current = normalBuffer(buffer);
  const source = graphemes(current.lines.join('\n'));
  const offsets = orderedOffsets(current.lines, range);
  const start = Math.min(offsets.start, source.length);
  const end = Math.min(Math.max(start, offsets.end), source.length);
  if (start === end) {
    return emptyResult(current);
  }

  const register = source.slice(start, end).join('');
  if (op === 'yank') {
    return {
      buffer: current,
      register,
      registerIsLinewise: false,
      enterInsert: false,
      applied: true,
    };
  }

  const nextSource = [...source.slice(0, start), ...source.slice(end)];
  const lines = nextSource.join('').split('\n');
  const insertion = positionFromOffset(lines, start);
  if (op === 'change') {
    return {
      buffer: { lines, line: insertion.line, column: insertion.column },
      register,
      registerIsLinewise: false,
      enterInsert: true,
      applied: true,
    };
  }

  const points = graphemes(lines[insertion.line] ?? '');
  return {
    buffer: {
      lines,
      line: insertion.line,
      column: clampedNormalColumn(points, insertion.column),
    },
    register,
    registerIsLinewise: false,
    enterInsert: false,
    applied: true,
  };
}

// `d` followed by a word motion over blank text (e.g. `dw` on an empty or
// whitespace-only line) deletes whole lines, matching Vim: the range is
// promoted to linewise when everything before the cursor on the start line
// and everything after the target on the end line is blank.
function deleteSpecialRange(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorRange {
  if (
    op !== 'delete'
    || range.kind === 'linewise'
    || range.startLine >= range.endLine
  ) {
    return range;
  }

  const current = normalBuffer(buffer);
  const startPoints = linePoints(current, range.startLine);
  const endPoints = linePoints(current, range.endLine);
  const trailingStart =
    range.kind === 'charwise-inclusive'
      ? range.endColumn + 1
      : range.endColumn;
  if (
    !onlyBlank(startPoints.slice(0, range.startColumn))
    || !onlyBlank(endPoints.slice(trailingStart))
  ) {
    return range;
  }
  return linewiseRange(current, range.startLine, range.endLine);
}

function applyRange(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorResult {
  return range.kind === 'linewise'
    ? applyLinewise(buffer, op, range)
    : applyCharwise(buffer, op, range);
}

// Operator-motion path: applies the d-special blank-line promotion above.
export function applyOperator(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorResult {
  return applyRange(buffer, op, deleteSpecialRange(buffer, op, range));
}

// Visual-mode path: the user's explicit selection is honored verbatim and
// never widened by the operator-motion special case.
export function applyVisualOperator(
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange,
): OperatorResult {
  return applyRange(buffer, op, range);
}

export function replaceRangeWithRegister(
  buffer: VimBuffer,
  range: OperatorRange,
  register: string,
  registerIsLinewise: boolean,
): OperatorResult {
  const current = normalBuffer(buffer);
  if (register.length === 0 && !registerIsLinewise) {
    return emptyResult(current);
  }
  const deleted = applyVisualOperator(current, 'delete', range);
  if (!deleted.applied) {
    return deleted;
  }

  if (range.kind === 'linewise') {
    const startLine = clampedLine(
      current,
      Math.min(range.startLine, range.endLine),
    );
    const endLine = clampedLine(
      current,
      Math.max(range.startLine, range.endLine),
    );
    const replacementLines = register.split('\n');
    const lines = [
      ...current.lines.slice(0, startLine),
      ...replacementLines,
      ...current.lines.slice(endLine + 1),
    ];
    return {
      buffer: {
        lines,
        line: startLine,
        column: firstNonBlank(graphemes(replacementLines[0] ?? '')),
      },
      register: deleted.register,
      registerIsLinewise: deleted.registerIsLinewise,
      enterInsert: false,
      applied: true,
    };
  }

  const source = graphemes(current.lines.join('\n'));
  const offsets = orderedOffsets(current.lines, range);
  const start = Math.min(offsets.start, source.length);
  const end = Math.min(Math.max(start, offsets.end), source.length);
  const replacement = graphemes(register);
  if (registerIsLinewise) {
    const nextSource = [
      ...source.slice(0, start),
      '\n',
      ...replacement,
      '\n',
      ...source.slice(end),
    ];
    const lines = nextSource.join('').split('\n');
    const cursor = positionFromOffset(lines, start + 1);
    return {
      buffer: {
        lines,
        line: cursor.line,
        column: firstNonBlank(graphemes(lines[cursor.line] ?? '')),
      },
      register: deleted.register,
      registerIsLinewise: deleted.registerIsLinewise,
      enterInsert: false,
      applied: true,
    };
  }

  const nextSource = [
    ...source.slice(0, start),
    ...replacement,
    ...source.slice(end),
  ];
  const lines = nextSource.join('').split('\n');
  const cursor = positionFromOffset(
    lines,
    start + replacement.length - 1,
  );
  return {
    buffer: { lines, line: cursor.line, column: cursor.column },
    register: deleted.register,
    registerIsLinewise: deleted.registerIsLinewise,
    enterInsert: false,
    applied: true,
  };
}

export function pasteRegister(
  buffer: VimBuffer,
  register: string,
  registerIsLinewise: boolean,
  after: boolean,
  count: number,
): VimBuffer {
  const current = normalBuffer(buffer);
  // An empty linewise register still pastes one empty line; only an empty
  // charwise register is a no-op.
  if (register.length === 0 && !registerIsLinewise) {
    return current;
  }
  const repetitions = Math.max(1, Math.floor(count));

  if (registerIsLinewise) {
    const registerLines = register.split('\n');
    const repeatedLines: string[] = [];
    for (let index = 0; index < repetitions; index += 1) {
      repeatedLines.push(...registerLines);
    }
    const insertLine = after ? current.line + 1 : current.line;
    const lines = [
      ...current.lines.slice(0, insertLine),
      ...repeatedLines,
      ...current.lines.slice(insertLine),
    ];
    return {
      lines,
      line: insertLine,
      column: firstNonBlank(graphemes(lines[insertLine] ?? '')),
    };
  }

  const source = graphemes(current.lines.join('\n'));
  const content = graphemes(register.repeat(repetitions));
  const currentOffset = positionOffset(
    current.lines,
    current.line,
    current.column,
  );
  const insertOffset =
    after && linePoints(current, current.line).length > 0
      ? currentOffset + 1
      : currentOffset;
  const nextSource = [
    ...source.slice(0, insertOffset),
    ...content,
    ...source.slice(insertOffset),
  ];
  const lines = nextSource.join('').split('\n');
  const cursor = positionFromOffset(
    lines,
    insertOffset + Math.max(0, content.length - 1),
  );
  return { lines, line: cursor.line, column: cursor.column };
}
