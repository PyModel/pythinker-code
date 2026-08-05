import { VIM_OPEN_LINE_COUNT_CAP } from '../../constant/vim';
import {
  graphemeLength,
  graphemes,
  isSingleGrapheme,
  utf16OffsetAtGraphemeColumn,
} from './graphemes';
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
  repeatFind,
} from './motions';
import {
  applyOperator,
  applyVisualOperator,
  doubledOperatorRange,
  graphemeOffset,
  operatorRangeForFind,
  operatorRangeForMotion,
  pasteRegister,
  positionAtGraphemeOffset,
  replaceRangeWithRegister,
  type OperatorRange,
} from './operators';
import { findTextObject } from './text-objects';
import type {
  CommandState,
  FindType,
  InsertEntry,
  Operator,
  PersistentState,
  Position,
  RepeatSpec,
  RepeatTarget,
  TextObjScope,
  VimBuffer,
  VimState,
  VisualKind,
} from './types';
import { selectionRange } from './visual';

interface CommandResult {
  readonly state: VimState;
  readonly persistent: PersistentState;
  readonly buffer: VimBuffer;
}

function normalState(command?: CommandState): VimState {
  return { mode: 'NORMAL', command: command ?? { type: 'idle' } };
}

function visualState(
  kind: VisualKind,
  anchor: Position,
  command?: CommandState,
): VimState {
  return {
    mode: 'VISUAL',
    kind,
    anchor: { line: anchor.line, column: anchor.column },
    command: command ?? { type: 'idle' },
  };
}

function copyRepeatTarget(target: RepeatTarget): RepeatTarget {
  switch (target.kind) {
    case 'motion':
      return { kind: 'motion', key: target.key, char: target.char };
    case 'textObject':
      return {
        kind: 'textObject',
        scope: target.scope,
        object: target.object,
      };
    case 'line':
      return { kind: 'line' };
  }
}

function copyRepeatSpec(repeat: RepeatSpec | null): RepeatSpec | null {
  if (repeat === null) {
    return null;
  }
  switch (repeat.kind) {
    case 'operator':
      return {
        kind: 'operator',
        op: repeat.op,
        count: repeat.count,
        target: copyRepeatTarget(repeat.target),
        insertedText: repeat.insertedText,
      };
    case 'simple':
      return { kind: 'simple', key: repeat.key, count: repeat.count };
    case 'visual':
      return {
        kind: 'visual',
        op: repeat.op,
        visual: repeat.visual,
        lineSpan: repeat.lineSpan,
        columnSpan: repeat.columnSpan,
        insertedText: repeat.insertedText,
      };
    case 'insert':
      return {
        kind: 'insert',
        key: repeat.key,
        count: repeat.count,
        insertedText: repeat.insertedText,
      };
  }
}

export function createInitialState(): VimState {
  return normalState();
}

export function createInitialPersistent(): PersistentState {
  return {
    lastFind: null,
    desiredColumn: null,
    register: '',
    registerIsLinewise: false,
    lastChange: null,
  };
}

function copyLastFind(
  persistent: PersistentState,
): PersistentState['lastFind'] {
  return persistent.lastFind === null
    ? null
    : { type: persistent.lastFind.type, char: persistent.lastFind.char };
}

function copyPersistent(
  persistent: PersistentState,
  desiredColumn = persistent.desiredColumn,
): PersistentState {
  return {
    lastFind: copyLastFind(persistent),
    desiredColumn,
    register: persistent.register,
    registerIsLinewise: persistent.registerIsLinewise,
    lastChange: copyRepeatSpec(persistent.lastChange),
  };
}

function persistentWithRegister(
  persistent: PersistentState,
  register: string,
  registerIsLinewise: boolean,
  lastFind = copyLastFind(persistent),
  lastChange = copyRepeatSpec(persistent.lastChange),
): PersistentState {
  return {
    lastFind,
    desiredColumn: null,
    register,
    registerIsLinewise,
    lastChange,
  };
}

function persistentWithLastChange(
  persistent: PersistentState,
  lastChange: RepeatSpec,
): PersistentState {
  return {
    ...copyPersistent(persistent, null),
    lastChange: copyRepeatSpec(lastChange),
  };
}

function copyBuffer(buffer: VimBuffer): VimBuffer {
  return { lines: buffer.lines, line: buffer.line, column: buffer.column };
}

function normalBuffer(buffer: VimBuffer): VimBuffer {
  return moveLeft(buffer, 0);
}

function countValue(digits: string): number {
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

function multiplyCounts(first: number, second: number): number {
  const value = first * second;
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

// `o`/`O` counts translate into whole opened lines; cap them so a huge count
// cannot allocate an unbounded buffer.
function boundedOpenLineCount(count: number): number {
  return Math.min(
    VIM_OPEN_LINE_COUNT_CAP,
    Math.max(1, Math.floor(count)),
  );
}

function isDigit(key: string): boolean {
  return key.length === 1 && key >= '0' && key <= '9';
}

function isNonZeroDigit(key: string): boolean {
  return isDigit(key) && key !== '0';
}

function findType(key: string): FindType | null {
  switch (key) {
    case 'f':
    case 'F':
    case 't':
    case 'T':
      return key;
    default:
      return null;
  }
}

function operatorType(key: string): Operator | null {
  switch (key) {
    case 'd':
      return 'delete';
    case 'c':
      return 'change';
    case 'y':
      return 'yank';
    default:
      return null;
  }
}

function isCharacterKey(key: string): boolean {
  return isSingleGrapheme(key);
}

function reverseFind(find: FindType): FindType {
  switch (find) {
    case 'f':
      return 'F';
    case 'F':
      return 'f';
    case 't':
      return 'T';
    case 'T':
      return 't';
  }
}

function lineLength(buffer: VimBuffer): number {
  return graphemeLength(buffer.lines[buffer.line] ?? '');
}

function currentCharacter(buffer: VimBuffer): string {
  return graphemes(buffer.lines[buffer.line] ?? '')[buffer.column] ?? '';
}

function leadingIndent(line: string): string {
  return /^[\t ]*/u.exec(line)?.[0] ?? '';
}

// Opens `count` blank lines above or below the cursor, carrying the leading
// indent of the current line; returns the buffer positioned on the last opened line.
function openLine(buffer: VimBuffer, above: boolean, count = 1): VimBuffer {
  const current = normalBuffer(buffer);
  const indent = leadingIndent(current.lines[current.line] ?? '');
  const firstLine = above ? current.line : current.line + 1;
  const repetitions = boundedOpenLineCount(count);
  const openedLines = Array.from({ length: repetitions }, () => indent);
  return {
    lines: [
      ...current.lines.slice(0, firstLine),
      ...openedLines,
      ...current.lines.slice(firstLine),
    ],
    line: firstLine + repetitions - 1,
    column: graphemeLength(indent),
  };
}

function insertEntry(
  buffer: VimBuffer,
  pendingRepeat: RepeatSpec | null,
): InsertEntry {
  return {
    pendingRepeat: copyRepeatSpec(pendingRepeat),
    snapshotLines: [...buffer.lines],
    snapshotCursor: { line: buffer.line, column: buffer.column },
  };
}

function enterInsert(
  persistent: PersistentState,
  buffer: VimBuffer,
  column: number,
  pendingRepeat: RepeatSpec | null,
): CommandResult {
  const insertBuffer = {
    lines: buffer.lines,
    line: buffer.line,
    column,
  };
  return {
    state: {
      mode: 'INSERT',
      entry: insertEntry(insertBuffer, pendingRepeat),
    },
    persistent: copyPersistent(persistent, null),
    buffer: insertBuffer,
  };
}

function idleResult(
  persistent: PersistentState,
  buffer: VimBuffer,
  desiredColumn = persistent.desiredColumn,
): CommandResult {
  return {
    state: normalState(),
    persistent: copyPersistent(persistent, desiredColumn),
    buffer: normalBuffer(buffer),
  };
}

function pendingOperator(
  persistent: PersistentState,
  buffer: VimBuffer,
  op: Operator,
  count: number,
): CommandResult {
  return {
    state: normalState({ type: 'operator', op, count }),
    persistent: copyPersistent(persistent),
    buffer: normalBuffer(buffer),
  };
}

function finishOperator(
  persistent: PersistentState,
  buffer: VimBuffer,
  op: Operator,
  range: OperatorRange | null,
  repeat: RepeatSpec | null,
  lastFind = copyLastFind(persistent),
): CommandResult {
  if (range === null) {
    return idleResult(persistent, buffer, null);
  }
  const result = applyOperator(buffer, op, range);
  if (!result.applied) {
    return idleResult(persistent, buffer, null);
  }
  const changesBuffer = op !== 'yank';
  const lastChange =
    changesBuffer && repeat !== null
      ? copyRepeatSpec(repeat)
      : copyRepeatSpec(persistent.lastChange);
  const nextPersistent = persistentWithRegister(
    persistent,
    result.register,
    result.registerIsLinewise,
    lastFind,
    result.enterInsert ? copyRepeatSpec(persistent.lastChange) : lastChange,
  );
  return {
    state: result.enterInsert
      ? {
          mode: 'INSERT',
          entry: insertEntry(result.buffer, repeat),
        }
      : normalState(),
    persistent: nextPersistent,
    buffer: result.buffer,
  };
}

function shortcutRange(
  buffer: VimBuffer,
  before: boolean,
  count: number,
): OperatorRange {
  const current = normalBuffer(buffer);
  const length = lineLength(current);
  const repetitions = Math.max(1, Math.floor(count));
  return {
    kind: 'charwise-exclusive',
    startLine: current.line,
    startColumn: before
      ? Math.max(0, current.column - repetitions)
      : current.column,
    endLine: current.line,
    endColumn: before
      ? current.column
      : Math.min(length, current.column + repetitions),
  };
}

function operatorRepeat(
  op: Operator,
  count: number,
  target: RepeatTarget,
): RepeatSpec {
  return {
    kind: 'operator',
    op,
    count,
    target,
    insertedText: null,
  };
}

function insertRepeat(key: string, count: number): RepeatSpec {
  const repeatCount =
    key === 'o' || key === 'O' ? boundedOpenLineCount(count) : count;
  return { kind: 'insert', key, count: repeatCount, insertedText: null };
}

function sameLines(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return first.length === second.length
    && first.every((line, index) => line === second[index]);
}

// Converts a grapheme-based position into a UTF-16 offset into the joined
// buffer text, so recovered insertions can be located by raw string slicing.
function utf16PositionOffset(
  lines: readonly string[],
  position: Position,
): number {
  const safeLines = lines.length === 0 ? [''] : lines;
  const line = Math.min(
    Math.max(0, Math.floor(position.line)),
    safeLines.length - 1,
  );
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    offset += (safeLines[index] ?? '').length + 1;
  }
  const text = safeLines[line] ?? '';
  return offset + utf16OffsetAtGraphemeColumn(text, position.column);
}

function insertTextAt(
  lines: readonly string[],
  position: Position,
  text: string,
): VimBuffer {
  const source = graphemes(lines.join('\n'));
  const inserted = graphemes(text);
  const offset = graphemeOffset(lines, position);
  const nextLines = [
    ...source.slice(0, offset),
    ...inserted,
    ...source.slice(offset),
  ].join('').split('\n');
  const cursorOffset =
    inserted.length === 0 ? offset : offset + inserted.length - 1;
  const cursor = positionAtGraphemeOffset(nextLines, cursorOffset);
  return {
    lines: nextLines,
    line: cursor.line,
    column: cursor.column,
  };
}

// Rebuilds a counted `o`/`O` change: the insertion is applied once to a
// single-line template, then that result (possibly multi-line) is repeated
// `count` times in place of the original line.
function insertTextIntoOpenedLines(
  lines: readonly string[],
  cursor: Position,
  count: number,
  text: string,
): VimBuffer {
  const repetitions = boundedOpenLineCount(count);
  const firstLine = Math.max(0, cursor.line - repetitions + 1);
  const template = insertTextAt(
    [lines[cursor.line] ?? ''],
    { line: 0, column: cursor.column },
    text,
  );
  const repeatedLines: string[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    repeatedLines.push(...template.lines);
  }
  return {
    lines: [
      ...lines.slice(0, firstLine),
      ...repeatedLines,
      ...lines.slice(cursor.line + 1),
    ],
    line: firstLine + (repetitions - 1) * template.lines.length + template.line,
    column: template.column,
  };
}

function recoverInsertedText(
  entry: InsertEntry,
  buffer: VimBuffer,
): string | null {
  const before = entry.snapshotLines.join('\n');
  const after = buffer.lines.join('\n');
  const insertionOffset = utf16PositionOffset(
    entry.snapshotLines,
    entry.snapshotCursor,
  );
  const insertedLength = after.length - before.length;
  if (insertedLength < 0) {
    return null;
  }

  const prefixMatches =
    before.slice(0, insertionOffset) === after.slice(0, insertionOffset);
  const suffixMatches =
    before.slice(insertionOffset)
    === after.slice(insertionOffset + insertedLength);
  const cursorOffset = utf16PositionOffset(buffer.lines, buffer);
  if (
    !prefixMatches
    || !suffixMatches
    || cursorOffset !== insertionOffset + insertedLength
  ) {
    return null;
  }
  return after.slice(insertionOffset, insertionOffset + insertedLength);
}

function repeatWithInsertedText(
  repeat: RepeatSpec,
  insertedText: string | null,
): RepeatSpec | null {
  switch (repeat.kind) {
    case 'operator':
      return { ...repeat, insertedText };
    case 'simple':
      return null;
    case 'visual':
      return { ...repeat, insertedText };
    case 'insert':
      return { ...repeat, insertedText };
  }
}

function repeatWithCount(
  repeat: RepeatSpec,
  count: number,
): RepeatSpec {
  switch (repeat.kind) {
    case 'operator':
      return { ...repeat, count };
    case 'simple':
      return { ...repeat, count };
    case 'visual':
      return { ...repeat };
    case 'insert':
      return {
        ...repeat,
        count:
          repeat.key === 'o' || repeat.key === 'O'
            ? boundedOpenLineCount(count)
            : count,
      };
  }
}

function finishInsert(
  entry: InsertEntry,
  persistent: PersistentState,
  buffer: VimBuffer,
): CommandResult {
  if (entry.pendingRepeat === null) {
    return {
      state: normalState(),
      persistent: copyPersistent(persistent),
      buffer: moveLeft(normalBuffer(buffer), 1),
    };
  }

  const insertedText = recoverInsertedText(entry, buffer);
  const recorded = repeatWithInsertedText(
    entry.pendingRepeat,
    insertedText,
  );
  if (recorded === null) {
    return idleResult(persistent, buffer, null);
  }

  if (insertedText === null) {
    // Replaying the wrong edit is worse than declining to replay it.
    return {
      state: normalState(),
      persistent: persistentWithLastChange(persistent, recorded),
      buffer: moveLeft(normalBuffer(buffer), 1),
    };
  }

  // Open-line changes stay replayable even when nothing was typed, and their
  // inserted text is applied per line instead of being repeated on one line.
  const isOpenLine =
    recorded.kind === 'insert' && (recorded.key === 'o' || recorded.key === 'O');
  if (
    recorded.kind === 'insert'
    && insertedText.length === 0
    && !isOpenLine
  ) {
    return idleResult(persistent, buffer, null);
  }

  const text =
    recorded.kind === 'insert' && !isOpenLine
      ? insertedText.repeat(recorded.count)
      : insertedText;
  const reconstructed = isOpenLine
    ? insertTextIntoOpenedLines(
        entry.snapshotLines,
        entry.snapshotCursor,
        recorded.count,
        text,
      )
    : insertTextAt(
        entry.snapshotLines,
        entry.snapshotCursor,
        text,
      );
  return {
    state: normalState(),
    persistent: persistentWithLastChange(persistent, recorded),
    buffer: normalBuffer(reconstructed),
  };
}

function movementResult(
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
  count: number,
  hasExplicitCount: boolean,
): CommandResult | null {
  const current = normalBuffer(buffer);
  switch (key) {
    case 'h':
      return idleResult(persistent, moveLeft(current, count), null);
    case 'l':
      return idleResult(persistent, moveRight(current, count), null);
    case 'j': {
      const desiredColumn = persistent.desiredColumn ?? current.column;
      return idleResult(
        persistent,
        moveDown(current, count, desiredColumn),
        desiredColumn,
      );
    }
    case 'k': {
      const desiredColumn = persistent.desiredColumn ?? current.column;
      return idleResult(
        persistent,
        moveUp(current, count, desiredColumn),
        desiredColumn,
      );
    }
    case 'w':
      return idleResult(persistent, moveWordForward(current, count), null);
    case 'W':
      return idleResult(persistent, moveBigWordForward(current, count), null);
    case 'b':
      return idleResult(persistent, moveWordBackward(current, count), null);
    case 'B':
      return idleResult(persistent, moveBigWordBackward(current, count), null);
    case 'e':
      return idleResult(persistent, moveWordEnd(current, count), null);
    case 'E':
      return idleResult(persistent, moveBigWordEnd(current, count), null);
    case '0':
      return idleResult(persistent, moveLineStart(current, count), null);
    case '^':
      return idleResult(persistent, moveFirstNonBlank(current, count), null);
    case '$':
      return idleResult(
        persistent,
        moveLineEnd(current, count),
        Number.POSITIVE_INFINITY,
      );
    case 'G':
      return idleResult(
        persistent,
        moveToLastLine(current, hasExplicitCount ? count : undefined),
        null,
      );
    case ';':
    case ',': {
      if (persistent.lastFind === null) {
        return idleResult(persistent, current, null);
      }
      const repeatedFind =
        key === ','
          ? reverseFind(persistent.lastFind.type)
          : persistent.lastFind.type;
      return idleResult(
        persistent,
        repeatFind(
          current,
          count,
          repeatedFind,
          persistent.lastFind.char,
        ),
        null,
      );
    }
    default:
      return null;
  }
}

function applyShortcut(
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
  count: number,
): CommandResult | null {
  const current = normalBuffer(buffer);
  switch (key) {
    case 'x':
      return finishOperator(
        persistent,
        current,
        'delete',
        shortcutRange(current, false, count),
        { kind: 'simple', key, count },
      );
    case 'X':
      return finishOperator(
        persistent,
        current,
        'delete',
        shortcutRange(current, true, count),
        { kind: 'simple', key, count },
      );
    case 's': {
      const repeat = operatorRepeat(
        'change',
        count,
        { kind: 'motion', key: 's' },
      );
      const result = finishOperator(
        persistent,
        current,
        'change',
        shortcutRange(current, false, count),
        repeat,
      );
      return result.state.mode === 'INSERT'
        ? result
        : enterInsert(persistent, current, current.column, repeat);
    }
    case 'S':
      return finishOperator(
        persistent,
        current,
        'change',
        doubledOperatorRange(current, count),
        operatorRepeat('change', count, { kind: 'line' }),
      );
    case 'D':
      return finishOperator(
        persistent,
        current,
        'delete',
        operatorRangeForMotion(current, '$', count),
        { kind: 'simple', key, count },
      );
    case 'C':
      return finishOperator(
        persistent,
        current,
        'change',
        operatorRangeForMotion(current, '$', count),
        operatorRepeat(
          'change',
          count,
          { kind: 'motion', key: '$' },
        ),
      );
    case 'Y':
      return finishOperator(
        persistent,
        current,
        'yank',
        doubledOperatorRange(current, count),
        null,
      );
    case 'p':
    case 'P': {
      const pasted = pasteRegister(
        current,
        persistent.register,
        persistent.registerIsLinewise,
        key === 'p',
        count,
      );
      const result = idleResult(persistent, pasted, null);
      return sameLines(current.lines, pasted.lines)
        ? result
        : {
            ...result,
            persistent: persistentWithLastChange(
              result.persistent,
              { kind: 'simple', key, count },
            ),
          };
    }
    default:
      return null;
  }
}

function applyNormalCommand(
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
  count: number,
  hasExplicitCount: boolean,
): CommandResult | null {
  const current = normalBuffer(buffer);
  const op = operatorType(key);
  if (op !== null) {
    return pendingOperator(persistent, current, op, count);
  }
  const shortcut = applyShortcut(persistent, current, key, count);
  if (shortcut !== null) {
    return shortcut;
  }
  const movement = movementResult(
    persistent,
    current,
    key,
    count,
    hasExplicitCount,
  );
  if (movement !== null) {
    return movement;
  }
  const find = findType(key);
  if (find !== null) {
    return {
      state: normalState({ type: 'find', find, count }),
      persistent: copyPersistent(persistent),
      buffer: current,
    };
  }

  switch (key) {
    case 'g':
      return {
        state: normalState({ type: 'g', count }),
        persistent: copyPersistent(persistent),
        buffer: current,
      };
    case 'v':
      return {
        state: visualState('char', current),
        persistent: copyPersistent(persistent, null),
        buffer: current,
      };
    case 'V':
      return {
        state: visualState('line', current),
        persistent: copyPersistent(persistent, null),
        buffer: current,
      };
    case '.':
      return replayLastChange(
        persistent,
        current,
        hasExplicitCount ? count : null,
      );
    case 'i':
      return enterInsert(
        persistent,
        current,
        current.column,
        insertRepeat(key, count),
      );
    case 'I': {
      const target = moveFirstNonBlank(current, 1);
      return enterInsert(
        persistent,
        target,
        target.column,
        insertRepeat(key, count),
      );
    }
    case 'a':
      return enterInsert(
        persistent,
        current,
        Math.min(lineLength(current), current.column + 1),
        insertRepeat(key, count),
      );
    case 'A':
      return enterInsert(
        persistent,
        current,
        lineLength(current),
        insertRepeat(key, count),
      );
    case 'o':
    case 'O': {
      const openLineCount = boundedOpenLineCount(count);
      const opened = openLine(current, key === 'O', openLineCount);
      return enterInsert(
        persistent,
        opened,
        opened.column,
        insertRepeat(key, openLineCount),
      );
    }
    default:
      return null;
  }
}

function applyPendingOperator(
  persistent: PersistentState,
  buffer: VimBuffer,
  op: Operator,
  count: number,
  key: string,
  hasMotionCount: boolean,
): CommandResult {
  const current = normalBuffer(buffer);
  const nextOperator = operatorType(key);
  if (nextOperator !== null) {
    return nextOperator === op
      ? finishOperator(
          persistent,
          current,
          op,
          doubledOperatorRange(current, count),
          operatorRepeat(op, count, { kind: 'line' }),
        )
      : idleResult(persistent, current, null);
  }
  if (key === 'i' || key === 'a') {
    const scope: TextObjScope = key === 'i' ? 'inner' : 'around';
    return {
      state: normalState({
        type: 'operatorTextObj',
        op,
        count,
        scope,
      }),
      persistent: copyPersistent(persistent),
      buffer: current,
    };
  }
  const find = findType(key);
  if (find !== null) {
    return {
      state: normalState({ type: 'operatorFind', op, count, find }),
      persistent: copyPersistent(persistent),
      buffer: current,
    };
  }
  if (key === 'g') {
    return {
      state: normalState({ type: 'operatorG', op, count }),
      persistent: copyPersistent(persistent),
      buffer: current,
    };
  }
  if ((key === ';' || key === ',') && persistent.lastFind !== null) {
    const findToApply =
      key === ','
        ? reverseFind(persistent.lastFind.type)
        : persistent.lastFind.type;
    return finishOperator(
      persistent,
      current,
      op,
      operatorRangeForFind(
        current,
        count,
        findToApply,
        persistent.lastFind.char,
      ),
      operatorRepeat(
        op,
        count,
        {
          kind: 'motion',
          key: findToApply,
          char: persistent.lastFind.char,
        },
      ),
    );
  }
  const motion =
    op === 'change'
    && (key === 'w' || key === 'W')
    && !/\s/u.test(currentCharacter(current))
      ? key === 'w' ? 'e' : 'E'
      : key;
  return finishOperator(
    persistent,
    current,
    op,
    operatorRangeForMotion(
      current,
      motion,
      count,
      hasMotionCount || count !== 1,
    ),
    operatorRepeat(op, count, { kind: 'motion', key }),
  );
}

function repeatOperatorRange(
  buffer: VimBuffer,
  repeat: Extract<RepeatSpec, { readonly kind: 'operator' }>,
): OperatorRange | null {
  switch (repeat.target.kind) {
    case 'line':
      return doubledOperatorRange(buffer, repeat.count);
    case 'textObject':
      return findTextObject(
        buffer,
        repeat.target.scope,
        repeat.target.object,
      );
    case 'motion': {
      if (repeat.target.key === 's') {
        return shortcutRange(buffer, false, repeat.count);
      }
      if (repeat.target.char !== undefined) {
        const find = findType(repeat.target.key);
        return find === null
          ? null
          : operatorRangeForFind(
              buffer,
              repeat.count,
              find,
              repeat.target.char,
            );
      }
      const motion =
        repeat.op === 'change'
        && (repeat.target.key === 'w' || repeat.target.key === 'W')
        && !/\s/u.test(currentCharacter(buffer))
          ? repeat.target.key === 'w' ? 'e' : 'E'
          : repeat.target.key;
      return operatorRangeForMotion(
        buffer,
        motion,
        repeat.count,
        repeat.count !== 1,
      );
    }
  }
}

function replayOperator(
  persistent: PersistentState,
  buffer: VimBuffer,
  repeat: Extract<RepeatSpec, { readonly kind: 'operator' }>,
): CommandResult {
  if (
    repeat.op === 'yank'
    || (repeat.op === 'change' && repeat.insertedText === null)
  ) {
    return idleResult(persistent, buffer, null);
  }
  const range = repeatOperatorRange(buffer, repeat);
  if (range === null) {
    return idleResult(persistent, buffer, null);
  }
  const result = applyOperator(buffer, repeat.op, range);
  if (!result.applied) {
    if (
      repeat.op === 'change'
      && repeat.target.kind === 'motion'
      && repeat.target.key === 's'
      && repeat.insertedText !== null
    ) {
      return {
        state: normalState(),
        persistent: persistentWithLastChange(persistent, repeat),
        buffer: normalBuffer(
          insertTextAt(buffer.lines, buffer, repeat.insertedText),
        ),
      };
    }
    return idleResult(persistent, buffer, null);
  }
  const nextBuffer =
    repeat.op === 'change'
      ? normalBuffer(
          insertTextAt(
            result.buffer.lines,
            result.buffer,
            repeat.insertedText ?? '',
          ),
        )
      : result.buffer;
  return {
    state: normalState(),
    persistent: persistentWithRegister(
      persistent,
      result.register,
      result.registerIsLinewise,
      copyLastFind(persistent),
      repeat,
    ),
    buffer: nextBuffer,
  };
}

function visualRepeatRange(
  buffer: VimBuffer,
  repeat: Extract<RepeatSpec, { readonly kind: 'visual' }>,
): OperatorRange {
  const endLine = buffer.line + repeat.lineSpan;
  const endColumn = buffer.column + repeat.columnSpan;
  return selectionRange(
    buffer,
    { line: endLine, column: endColumn },
    repeat.visual,
  );
}

function replayVisual(
  persistent: PersistentState,
  buffer: VimBuffer,
  repeat: Extract<RepeatSpec, { readonly kind: 'visual' }>,
): CommandResult {
  if (
    repeat.op === 'yank'
    || (repeat.op === 'change' && repeat.insertedText === null)
  ) {
    return idleResult(persistent, buffer, null);
  }
  const result = applyOperator(
    buffer,
    repeat.op,
    visualRepeatRange(buffer, repeat),
  );
  if (!result.applied) {
    return idleResult(persistent, buffer, null);
  }
  const insertsText = repeat.insertedText !== null;
  const nextBuffer = insertsText
    ? normalBuffer(
        insertTextAt(
          result.buffer.lines,
          result.buffer,
          repeat.insertedText ?? '',
        ),
      )
    : result.buffer;
  return {
    state: normalState(),
    persistent: persistentWithRegister(
      persistent,
      result.register,
      result.registerIsLinewise,
      copyLastFind(persistent),
      repeat,
    ),
    buffer: nextBuffer,
  };
}

function insertPositionForKey(
  buffer: VimBuffer,
  key: string,
): Position | null {
  const current = normalBuffer(buffer);
  switch (key) {
    case 'i':
      return { line: current.line, column: current.column };
    case 'I': {
      const target = moveFirstNonBlank(current, 1);
      return { line: target.line, column: target.column };
    }
    case 'a':
      return {
        line: current.line,
        column: Math.min(lineLength(current), current.column + 1),
      };
    case 'A':
      return { line: current.line, column: lineLength(current) };
    default:
      return null;
  }
}

function replayInsert(
  persistent: PersistentState,
  buffer: VimBuffer,
  repeat: Extract<RepeatSpec, { readonly kind: 'insert' }>,
): CommandResult {
  // `o`/`O` re-opens fresh lines on replay; other insert keys paste in place.
  const opensLine = repeat.key === 'o' || repeat.key === 'O';
  if (
    repeat.insertedText === null
    || (repeat.insertedText.length === 0 && !opensLine)
  ) {
    return idleResult(persistent, buffer, null);
  }
  const repeatCount = opensLine
    ? boundedOpenLineCount(repeat.count)
    : repeat.count;
  const target = opensLine
    ? openLine(buffer, repeat.key === 'O', repeatCount)
    : buffer;
  const position = opensLine
    ? { line: target.line, column: target.column }
    : insertPositionForKey(target, repeat.key);
  if (position === null) {
    return idleResult(persistent, buffer, null);
  }
  return {
    state: normalState(),
    persistent: persistentWithLastChange(persistent, repeat),
    buffer: normalBuffer(
      opensLine
        ? insertTextIntoOpenedLines(
            target.lines,
            position,
            repeatCount,
            repeat.insertedText,
          )
        : insertTextAt(
            target.lines,
            position,
            repeat.insertedText.repeat(repeatCount),
          ),
    ),
  };
}

function replayLastChange(
  persistent: PersistentState,
  buffer: VimBuffer,
  replacementCount: number | null,
): CommandResult {
  if (persistent.lastChange === null) {
    return idleResult(persistent, buffer, null);
  }
  const repeat =
    replacementCount === null
      ? copyRepeatSpec(persistent.lastChange)
      : repeatWithCount(persistent.lastChange, replacementCount);
  if (repeat === null) {
    return idleResult(persistent, buffer, null);
  }
  switch (repeat.kind) {
    case 'operator':
      return replayOperator(persistent, buffer, repeat);
    case 'simple': {
      const result = applyShortcut(
        persistent,
        buffer,
        repeat.key,
        repeat.count,
      );
      return result ?? idleResult(persistent, buffer, null);
    }
    case 'visual':
      return replayVisual(persistent, buffer, repeat);
    case 'insert':
      return replayInsert(persistent, buffer, repeat);
  }
}

function visualRepeatSpec(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  buffer: VimBuffer,
  op: Operator,
  insertedText: string | null,
): Extract<RepeatSpec, { readonly kind: 'visual' }> {
  const range = selectionRange(state.anchor, buffer, state.kind);
  const lineSpan = range.endLine - range.startLine;
  const columnSpan =
    state.kind === 'line'
      ? 0
      : range.endColumn - range.startColumn;
  return {
    kind: 'visual',
    op,
    visual: state.kind,
    lineSpan,
    columnSpan,
    insertedText,
  };
}

function selectionStartBuffer(
  lines: readonly string[],
  range: OperatorRange,
): VimBuffer {
  return normalBuffer({
    lines,
    line: range.startLine,
    column: range.kind === 'linewise' ? 0 : range.startColumn,
  });
}

function finishVisualOperator(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
  op: Operator,
): CommandResult {
  const range = selectionRange(state.anchor, buffer, state.kind);
  const repeat = visualRepeatSpec(state, buffer, op, null);
  const result = applyVisualOperator(buffer, op, range);
  if (!result.applied) {
    return idleResult(persistent, buffer, null);
  }
  const lastChange =
    op === 'delete' ? repeat : copyRepeatSpec(persistent.lastChange);
  const nextPersistent = persistentWithRegister(
    persistent,
    result.register,
    result.registerIsLinewise,
    copyLastFind(persistent),
    lastChange,
  );
  if (op === 'change') {
    return {
      state: {
        mode: 'INSERT',
        entry: insertEntry(result.buffer, repeat),
      },
      persistent: nextPersistent,
      buffer: result.buffer,
    };
  }
  return {
    state: normalState(),
    persistent: nextPersistent,
    buffer:
      op === 'yank'
        ? selectionStartBuffer(buffer.lines, range)
        : result.buffer,
  };
}

function replaceVisualSelection(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
): CommandResult {
  const range = selectionRange(state.anchor, buffer, state.kind);
  const replaced = replaceRangeWithRegister(
    buffer,
    range,
    persistent.register,
    persistent.registerIsLinewise,
  );
  if (!replaced.applied) {
    return idleResult(persistent, buffer, null);
  }
  return {
    state: normalState(),
    persistent: persistentWithRegister(
      persistent,
      replaced.register,
      replaced.registerIsLinewise,
    ),
    buffer: replaced.buffer,
  };
}

function visualIdleResult(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
  desiredColumn = persistent.desiredColumn,
): CommandResult {
  return {
    state: visualState(state.kind, state.anchor),
    persistent: copyPersistent(persistent, desiredColumn),
    buffer: normalBuffer(buffer),
  };
}

function selectVisualTextObject(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
  scope: TextObjScope,
  object: string,
): CommandResult {
  const range = findTextObject(buffer, scope, object);
  if (range === null || range.kind === 'linewise') {
    return visualIdleResult(state, persistent, buffer, null);
  }
  const start = {
    line: range.startLine,
    column: range.startColumn,
  };
  const startOffset = graphemeOffset(buffer.lines, start);
  const endOffset = graphemeOffset(buffer.lines, {
    line: range.endLine,
    column: range.endColumn,
  });
  if (endOffset <= startOffset) {
    return visualIdleResult(state, persistent, buffer, null);
  }
  const end = positionAtGraphemeOffset(buffer.lines, endOffset - 1);
  return {
    state: visualState('char', start),
    persistent: copyPersistent(persistent, null),
    buffer: {
      lines: buffer.lines,
      line: end.line,
      column: end.column,
    },
  };
}

function applyVisualCommand(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
  count: number,
  hasExplicitCount: boolean,
): CommandResult {
  const current = normalBuffer(buffer);
  const movement = movementResult(
    persistent,
    current,
    key,
    count,
    hasExplicitCount,
  );
  if (movement !== null) {
    return {
      state: visualState(state.kind, state.anchor),
      persistent: movement.persistent,
      buffer: movement.buffer,
    };
  }
  const find = findType(key);
  if (find !== null) {
    return {
      state: visualState(
        state.kind,
        state.anchor,
        { type: 'find', find, count },
      ),
      persistent: copyPersistent(persistent),
      buffer: current,
    };
  }
  switch (key) {
    case 'd':
    case 'x':
      return finishVisualOperator(state, persistent, current, 'delete');
    case 'c':
    case 's':
      return finishVisualOperator(state, persistent, current, 'change');
    case 'y':
      return finishVisualOperator(state, persistent, current, 'yank');
    case 'p':
      return replaceVisualSelection(state, persistent, current);
    case 'v':
      return state.kind === 'char'
        ? idleResult(persistent, current, null)
        : {
            state: visualState('char', state.anchor),
            persistent: copyPersistent(persistent, null),
            buffer: current,
          };
    case 'V':
      return state.kind === 'line'
        ? idleResult(persistent, current, null)
        : {
            state: visualState('line', state.anchor),
            persistent: copyPersistent(persistent, null),
            buffer: current,
          };
    case 'o':
      return {
        state: visualState(state.kind, current),
        persistent: copyPersistent(persistent, null),
        buffer: normalBuffer({
          lines: current.lines,
          line: state.anchor.line,
          column: state.anchor.column,
        }),
      };
    case 'i':
    case 'a':
      return {
        state: visualState(
          state.kind,
          state.anchor,
          {
            type: 'visualTextObj',
            scope: key === 'i' ? 'inner' : 'around',
          },
        ),
        persistent: copyPersistent(persistent),
        buffer: current,
      };
    case 'g':
      return {
        state: visualState(
          state.kind,
          state.anchor,
          { type: 'g', count },
        ),
        persistent: copyPersistent(persistent),
        buffer: current,
      };
    default:
      return visualIdleResult(state, persistent, current, null);
  }
}

function applyVisualKey(
  state: Extract<VimState, { readonly mode: 'VISUAL' }>,
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
): CommandResult {
  const current = normalBuffer(buffer);
  switch (state.command.type) {
    case 'idle':
      if (isNonZeroDigit(key)) {
        return {
          state: visualState(
            state.kind,
            state.anchor,
            { type: 'count', digits: key },
          ),
          persistent: copyPersistent(persistent),
          buffer: current,
        };
      }
      return applyVisualCommand(
        state,
        persistent,
        current,
        key,
        1,
        false,
      );
    case 'count':
      if (isDigit(key)) {
        return {
          state: visualState(
            state.kind,
            state.anchor,
            {
              type: 'count',
              digits: `${state.command.digits}${key}`,
            },
          ),
          persistent: copyPersistent(persistent),
          buffer: current,
        };
      }
      return applyVisualCommand(
        state,
        persistent,
        current,
        key,
        countValue(state.command.digits),
        true,
      );
    case 'find':
      if (!isCharacterKey(key)) {
        return visualIdleResult(state, persistent, current, null);
      }
      return {
        state: visualState(state.kind, state.anchor),
        persistent: {
          ...copyPersistent(persistent, null),
          lastFind: { type: state.command.find, char: key },
        },
        buffer: applyFind(
          current,
          state.command.count,
          state.command.find,
          key,
        ),
      };
    case 'g':
      if (key !== 'g') {
        return visualIdleResult(state, persistent, current, null);
      }
      return {
        state: visualState(state.kind, state.anchor),
        persistent: copyPersistent(persistent, null),
        buffer: moveToFirstLine(current, state.command.count),
      };
    case 'visualTextObj':
      return isCharacterKey(key)
        ? selectVisualTextObject(
            state,
            persistent,
            current,
            state.command.scope,
            key,
          )
        : visualIdleResult(state, persistent, current, null);
    case 'operator':
    case 'operatorCount':
    case 'operatorFind':
    case 'operatorTextObj':
    case 'operatorG':
      return visualIdleResult(state, persistent, current, null);
  }
}

/**
 * Applies one key to the pure vim state machine.
 *
 * NORMAL and VISUAL consume every key. INSERT delegates every key except
 * Escape to the editor that owns text insertion.
 */
export function applyKey(
  state: VimState,
  persistent: PersistentState,
  buffer: VimBuffer,
  key: string,
): {
  readonly state: VimState;
  readonly persistent: PersistentState;
  readonly buffer: VimBuffer;
  readonly handled: boolean;
} {
  const escaped = key === '\u001B' || key === 'Escape';
  switch (state.mode) {
    case 'INSERT':
      if (escaped) {
        return {
          ...finishInsert(state.entry, persistent, buffer),
          handled: true,
        };
      }
      return {
        state: {
          mode: 'INSERT',
          entry: {
            pendingRepeat: copyRepeatSpec(state.entry.pendingRepeat),
            snapshotLines: [...state.entry.snapshotLines],
            snapshotCursor: {
              line: state.entry.snapshotCursor.line,
              column: state.entry.snapshotCursor.column,
            },
          },
        },
        persistent: copyPersistent(persistent),
        buffer: copyBuffer(buffer),
        handled: false,
      };
    case 'VISUAL': {
      const current = normalBuffer(buffer);
      if (escaped) {
        return {
          state: normalState(),
          persistent: copyPersistent(persistent),
          buffer: current,
          handled: true,
        };
      }
      return {
        ...applyVisualKey(state, persistent, current, key),
        handled: true,
      };
    }
    case 'NORMAL':
      break;
  }

  const current = normalBuffer(buffer);
  if (escaped) {
    return {
      state: normalState(),
      persistent: copyPersistent(persistent),
      buffer: current,
      handled: true,
    };
  }

  switch (state.command.type) {
    case 'idle': {
      if (isNonZeroDigit(key)) {
        return {
          state: normalState({ type: 'count', digits: key }),
          persistent: copyPersistent(persistent),
          buffer: current,
          handled: true,
        };
      }
      const result = applyNormalCommand(persistent, current, key, 1, false);
      return { ...(result ?? idleResult(persistent, current)), handled: true };
    }
    case 'count': {
      if (isDigit(key)) {
        return {
          state: normalState({
            type: 'count',
            digits: `${state.command.digits}${key}`,
          }),
          persistent: copyPersistent(persistent),
          buffer: current,
          handled: true,
        };
      }
      const result = applyNormalCommand(
        persistent,
        current,
        key,
        countValue(state.command.digits),
        true,
      );
      return { ...(result ?? idleResult(persistent, current)), handled: true };
    }
    case 'find': {
      if (!isCharacterKey(key)) {
        return { ...idleResult(persistent, current), handled: true };
      }
      return {
        state: normalState(),
        persistent: {
          ...copyPersistent(persistent, null),
          lastFind: { type: state.command.find, char: key },
        },
        buffer: applyFind(
          current,
          state.command.count,
          state.command.find,
          key,
        ),
        handled: true,
      };
    }
    case 'g':
      if (key === 'g') {
        return {
          ...idleResult(
            persistent,
            moveToFirstLine(current, state.command.count),
            null,
          ),
          handled: true,
        };
      }
      return { ...idleResult(persistent, current), handled: true };
    case 'operator':
      if (isNonZeroDigit(key)) {
        return {
          state: normalState({
            type: 'operatorCount',
            op: state.command.op,
            count: state.command.count,
            digits: key,
          }),
          persistent: copyPersistent(persistent),
          buffer: current,
          handled: true,
        };
      }
      return {
        ...applyPendingOperator(
          persistent,
          current,
          state.command.op,
          state.command.count,
          key,
          false,
        ),
        handled: true,
      };
    case 'operatorCount':
      if (isDigit(key)) {
        return {
          state: normalState({
            ...state.command,
            digits: `${state.command.digits}${key}`,
          }),
          persistent: copyPersistent(persistent),
          buffer: current,
          handled: true,
        };
      }
      return {
        ...applyPendingOperator(
          persistent,
          current,
          state.command.op,
          multiplyCounts(
            state.command.count,
            countValue(state.command.digits),
          ),
          key,
          true,
        ),
        handled: true,
      };
    case 'operatorFind': {
      if (!isCharacterKey(key)) {
        return { ...idleResult(persistent, current, null), handled: true };
      }
      const lastFind = { type: state.command.find, char: key };
      return {
        ...finishOperator(
          persistent,
          current,
          state.command.op,
          operatorRangeForFind(
            current,
            state.command.count,
            state.command.find,
            key,
          ),
          operatorRepeat(
            state.command.op,
            state.command.count,
            { kind: 'motion', key: state.command.find, char: key },
          ),
          lastFind,
        ),
        handled: true,
      };
    }
    case 'operatorTextObj':
      if (!isCharacterKey(key)) {
        return { ...idleResult(persistent, current, null), handled: true };
      }
      return {
        ...finishOperator(
          persistent,
          current,
          state.command.op,
          findTextObject(
            current,
            state.command.scope,
            key,
          ),
          operatorRepeat(
            state.command.op,
            state.command.count,
            {
              kind: 'textObject',
              scope: state.command.scope,
              object: key,
            },
          ),
        ),
        handled: true,
      };
    case 'visualTextObj':
      return { ...idleResult(persistent, current, null), handled: true };
    case 'operatorG':
      return key === 'g'
        ? {
            ...finishOperator(
              persistent,
              current,
              state.command.op,
              operatorRangeForMotion(
                current,
                'gg',
                state.command.count,
                state.command.count !== 1,
              ),
              operatorRepeat(
                state.command.op,
                state.command.count,
                { kind: 'motion', key: 'gg' },
              ),
            ),
            handled: true,
          }
        : { ...idleResult(persistent, current, null), handled: true };
  }
}
