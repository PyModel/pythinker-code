import { graphemes } from './graphemes';
import type { FindType, VimBuffer } from './types';

type CharacterKind = 'blank' | 'keyword' | 'punctuation';

interface FlatBuffer {
  readonly characters: readonly string[];
  readonly positions: readonly ({ readonly line: number; readonly column: number } | null)[];
  readonly cursorOffset: number;
}

const KEYWORD_CHARACTER = /[\p{Letter}\p{Number}_]/u;
const BLANK_CHARACTER = /\s/u;

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, Math.floor(value));
}

function lineIndex(buffer: VimBuffer): number {
  if (buffer.lines.length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(buffer.line)), buffer.lines.length - 1);
}

function lineCharacters(buffer: VimBuffer, line: number): readonly string[] {
  return graphemes(buffer.lines[line] ?? '');
}

function normalColumn(characters: readonly string[], column: number): number {
  if (characters.length === 0) {
    return 0;
  }
  return Math.min(Math.max(0, Math.floor(column)), characters.length - 1);
}

function at(buffer: VimBuffer, line: number, column: number): VimBuffer {
  return { lines: buffer.lines, line, column };
}

function clampNormal(buffer: VimBuffer): VimBuffer {
  const line = lineIndex(buffer);
  return at(buffer, line, normalColumn(lineCharacters(buffer, line), buffer.column));
}

function firstNonBlankColumn(characters: readonly string[]): number {
  const column = characters.findIndex((character) => !BLANK_CHARACTER.test(character));
  return Math.max(0, column);
}

function characterKind(character: string, bigWord: boolean): CharacterKind {
  if (BLANK_CHARACTER.test(character)) {
    return 'blank';
  }
  if (bigWord || KEYWORD_CHARACTER.test(character)) {
    return 'keyword';
  }
  return 'punctuation';
}

function flatten(buffer: VimBuffer): FlatBuffer {
  const current = clampNormal(buffer);
  const characters: string[] = [];
  const positions: ({ readonly line: number; readonly column: number } | null)[] = [];
  let cursorOffset = 0;

  for (let line = 0; line < buffer.lines.length; line += 1) {
    const linePoints = lineCharacters(buffer, line);
    if (line === current.line) {
      cursorOffset = characters.length + current.column;
    }
    for (let column = 0; column < linePoints.length; column += 1) {
      const character = linePoints[column];
      if (character !== undefined) {
        characters.push(character);
        positions.push({ line, column });
      }
    }
    if (line < buffer.lines.length - 1) {
      characters.push('\n');
      positions.push(null);
    }
  }

  return { characters, positions, cursorOffset };
}

function fromOffset(buffer: VimBuffer, flat: FlatBuffer, offset: number): VimBuffer {
  const position = flat.positions[offset];
  return position === undefined || position === null
    ? clampNormal(buffer)
    : at(buffer, position.line, position.column);
}

function repeatOffset(
  initialOffset: number,
  count: number,
  step: (offset: number) => number | null,
): number {
  let offset = initialOffset;
  const repetitions = nonNegativeInteger(count);
  for (let index = 0; index < repetitions; index += 1) {
    const next = step(offset);
    if (next === null || next === offset) {
      break;
    }
    offset = next;
  }
  return offset;
}

function nextWordOffset(
  characters: readonly string[],
  offset: number,
  bigWord: boolean,
): number | null {
  if (offset >= characters.length) {
    return null;
  }

  let index = offset;
  const initialKind = characterKind(characters[index] ?? '', bigWord);
  if (initialKind === 'blank') {
    while (
      index < characters.length
      && characterKind(characters[index] ?? '', bigWord) === 'blank'
    ) {
      index += 1;
    }
  } else {
    while (
      index < characters.length
      && characterKind(characters[index] ?? '', bigWord) === initialKind
    ) {
      index += 1;
    }
    while (
      index < characters.length
      && characterKind(characters[index] ?? '', bigWord) === 'blank'
    ) {
      index += 1;
    }
  }

  return index < characters.length ? index : null;
}

function previousWordOffset(
  characters: readonly string[],
  offset: number,
  bigWord: boolean,
): number | null {
  let index = offset - 1;
  while (
    index >= 0
    && characterKind(characters[index] ?? '', bigWord) === 'blank'
  ) {
    index -= 1;
  }
  if (index < 0) {
    return null;
  }

  const kind = characterKind(characters[index] ?? '', bigWord);
  while (
    index > 0
    && characterKind(characters[index - 1] ?? '', bigWord) === kind
  ) {
    index -= 1;
  }
  return index;
}

function wordEndOffset(
  characters: readonly string[],
  offset: number,
  bigWord: boolean,
): number | null {
  if (offset >= characters.length) {
    return null;
  }

  let index = offset;
  let kind = characterKind(characters[index] ?? '', bigWord);
  if (kind === 'blank') {
    while (
      index < characters.length
      && characterKind(characters[index] ?? '', bigWord) === 'blank'
    ) {
      index += 1;
    }
    if (index >= characters.length) {
      return null;
    }
    kind = characterKind(characters[index] ?? '', bigWord);
  } else if (
    index + 1 >= characters.length
    || characterKind(characters[index + 1] ?? '', bigWord) !== kind
  ) {
    index += 1;
    while (
      index < characters.length
      && characterKind(characters[index] ?? '', bigWord) === 'blank'
    ) {
      index += 1;
    }
    if (index >= characters.length) {
      return null;
    }
    kind = characterKind(characters[index] ?? '', bigWord);
  }

  while (
    index + 1 < characters.length
    && characterKind(characters[index + 1] ?? '', bigWord) === kind
  ) {
    index += 1;
  }
  return index;
}

function moveWord(
  buffer: VimBuffer,
  count: number,
  bigWord: boolean,
  step: (
    characters: readonly string[],
    offset: number,
    bigWord: boolean,
  ) => number | null,
): VimBuffer {
  const flat = flatten(buffer);
  const offset = repeatOffset(flat.cursorOffset, count, (current) =>
    step(flat.characters, current, bigWord),
  );
  return fromOffset(buffer, flat, offset);
}

function targetCharacter(character: string): string | null {
  const characters = graphemes(character);
  return characters.length === 1 ? characters[0] ?? null : null;
}

function findColumn(
  buffer: VimBuffer,
  count: number,
  character: string,
  direction: 1 | -1,
  skipAdjacentTarget = false,
): number | null {
  const current = clampNormal(buffer);
  const target = targetCharacter(character);
  if (target === null) {
    return null;
  }

  const characters = lineCharacters(current, current.line);
  let remaining = Math.max(1, nonNegativeInteger(count));
  let firstColumn = current.column + direction;
  if (skipAdjacentTarget && characters[firstColumn] === target) {
    firstColumn += direction;
  }
  for (
    let column = firstColumn;
    column >= 0 && column < characters.length;
    column += direction
  ) {
    if (characters[column] === target) {
      remaining -= 1;
      if (remaining === 0) {
        return column;
      }
    }
  }
  return null;
}

/**
 * Moves left by grapheme without wrapping to another line.
 */
export function moveLeft(buffer: VimBuffer, count: number): VimBuffer {
  const current = clampNormal(buffer);
  return at(
    buffer,
    current.line,
    Math.max(0, current.column - nonNegativeInteger(count)),
  );
}

/**
 * Moves right by grapheme without wrapping to another line.
 */
export function moveRight(buffer: VimBuffer, count: number): VimBuffer {
  const current = clampNormal(buffer);
  const characters = lineCharacters(current, current.line);
  return at(
    buffer,
    current.line,
    normalColumn(characters, current.column + nonNegativeInteger(count)),
  );
}

/**
 * Moves down while preserving an explicit desired column through short lines.
 *
 * The desired column is supplied by the caller so this pure module does not
 * retain hidden mutable cursor state.
 */
export function moveDown(
  buffer: VimBuffer,
  count: number,
  desiredColumn: number,
): VimBuffer {
  const current = clampNormal(buffer);
  const lastLine = Math.max(0, buffer.lines.length - 1);
  const targetLine = Math.min(lastLine, current.line + nonNegativeInteger(count));
  return at(
    buffer,
    targetLine,
    normalColumn(
      lineCharacters(buffer, targetLine),
      nonNegativeInteger(desiredColumn),
    ),
  );
}

/**
 * Moves up while preserving an explicit desired column through short lines.
 *
 * The desired column is supplied by the caller so this pure module does not
 * retain hidden mutable cursor state.
 */
export function moveUp(
  buffer: VimBuffer,
  count: number,
  desiredColumn: number,
): VimBuffer {
  const current = clampNormal(buffer);
  const targetLine = Math.max(0, current.line - nonNegativeInteger(count));
  return at(
    buffer,
    targetLine,
    normalColumn(
      lineCharacters(buffer, targetLine),
      nonNegativeInteger(desiredColumn),
    ),
  );
}

/** Moves to the start of the next small word. */
export function moveWordForward(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, false, nextWordOffset);
}

/** Moves to the start of the next whitespace-delimited WORD. */
export function moveBigWordForward(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, true, nextWordOffset);
}

/** Moves to the start of the previous small word. */
export function moveWordBackward(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, false, previousWordOffset);
}

/** Moves to the start of the previous whitespace-delimited WORD. */
export function moveBigWordBackward(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, true, previousWordOffset);
}

/** Moves to the end of a small word. */
export function moveWordEnd(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, false, wordEndOffset);
}

/** Moves to the end of a whitespace-delimited WORD. */
export function moveBigWordEnd(buffer: VimBuffer, count: number): VimBuffer {
  return moveWord(buffer, count, true, wordEndOffset);
}

/** Moves to column zero of the current line. */
export function moveLineStart(buffer: VimBuffer, _count: number): VimBuffer {
  const current = clampNormal(buffer);
  return at(buffer, current.line, 0);
}

/** Moves to the first non-blank character of the current line. */
export function moveFirstNonBlank(buffer: VimBuffer, _count: number): VimBuffer {
  const current = clampNormal(buffer);
  return at(
    buffer,
    current.line,
    firstNonBlankColumn(lineCharacters(current, current.line)),
  );
}

/** Moves to the final character of the current line. */
export function moveLineEnd(buffer: VimBuffer, _count: number): VimBuffer {
  const current = clampNormal(buffer);
  const characters = lineCharacters(current, current.line);
  return at(buffer, current.line, characters.length === 0 ? 0 : characters.length - 1);
}

/** Moves to a one-based counted line, defaulting to the first line. */
export function moveToFirstLine(buffer: VimBuffer, count: number): VimBuffer {
  const lastLine = Math.max(0, buffer.lines.length - 1);
  const targetLine = Math.min(lastLine, Math.max(0, nonNegativeInteger(count) - 1));
  return at(
    buffer,
    targetLine,
    firstNonBlankColumn(lineCharacters(buffer, targetLine)),
  );
}

/**
 * Moves to the final line, or to a one-based line number when a count is
 * supplied.
 */
export function moveToLastLine(buffer: VimBuffer, count?: number): VimBuffer {
  const lastLine = Math.max(0, buffer.lines.length - 1);
  const targetLine =
    count === undefined
      ? lastLine
      : Math.min(lastLine, Math.max(0, nonNegativeInteger(count) - 1));
  return at(
    buffer,
    targetLine,
    firstNonBlankColumn(lineCharacters(buffer, targetLine)),
  );
}

/** Finds the counted next occurrence of a character and lands on it. */
export function findForward(
  buffer: VimBuffer,
  count: number,
  character: string,
): VimBuffer {
  const current = clampNormal(buffer);
  const column = findColumn(current, count, character, 1);
  return column === null ? current : at(buffer, current.line, column);
}

/** Finds the counted previous occurrence of a character and lands on it. */
export function findBackward(
  buffer: VimBuffer,
  count: number,
  character: string,
): VimBuffer {
  const current = clampNormal(buffer);
  const column = findColumn(current, count, character, -1);
  return column === null ? current : at(buffer, current.line, column);
}

/** Finds forward and lands immediately before the target character. */
export function tillForward(
  buffer: VimBuffer,
  count: number,
  character: string,
): VimBuffer {
  const current = clampNormal(buffer);
  const column = findColumn(current, count, character, 1);
  return column === null
    ? current
    : at(buffer, current.line, Math.max(current.column, column - 1));
}

/** Finds backward and lands immediately after the target character. */
export function tillBackward(
  buffer: VimBuffer,
  count: number,
  character: string,
): VimBuffer {
  const current = clampNormal(buffer);
  const column = findColumn(current, count, character, -1);
  return column === null
    ? current
    : at(buffer, current.line, Math.min(current.column, column + 1));
}

/**
 * Repeats a find, skipping the adjacent target for till motions so another
 * repetition can advance instead of rediscovering the same character.
 */
export function repeatFind(
  buffer: VimBuffer,
  count: number,
  find: FindType,
  character: string,
): VimBuffer {
  const current = clampNormal(buffer);
  switch (find) {
    case 'f':
      return findForward(current, count, character);
    case 'F':
      return findBackward(current, count, character);
    case 't': {
      const column = findColumn(current, count, character, 1, true);
      return column === null
        ? current
        : at(buffer, current.line, Math.max(current.column, column - 1));
    }
    case 'T': {
      const column = findColumn(current, count, character, -1, true);
      return column === null
        ? current
        : at(buffer, current.line, Math.min(current.column, column + 1));
    }
  }
}

/** Applies a find command by its discriminant. */
export function applyFind(
  buffer: VimBuffer,
  count: number,
  find: FindType,
  character: string,
): VimBuffer {
  switch (find) {
    case 'f':
      return findForward(buffer, count, character);
    case 'F':
      return findBackward(buffer, count, character);
    case 't':
      return tillForward(buffer, count, character);
    case 'T':
      return tillBackward(buffer, count, character);
  }
}
