export interface ComposerState {
  readonly lines: readonly string[];
  readonly cursorLine: number;
  readonly cursorCol: number;
  readonly pastes: ReadonlyMap<number, string>;
  readonly pasteCounter: number;
}

export interface HistoryNavigationResult {
  readonly state: ComposerState;
  readonly historyIndex: number | null;
}

export interface PasteExpansionResult {
  readonly state: ComposerState;
  readonly expanded: boolean;
}

export interface ComposerPrefix {
  readonly kind: 'slash' | 'mention';
  readonly query: string;
  readonly start: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

function currentLine(state: ComposerState): string {
  return state.lines[state.cursorLine] ?? '';
}

function withCursor(
  state: ComposerState,
  cursorLine: number,
  cursorCol: number,
): ComposerState {
  return {
    ...state,
    cursorLine,
    cursorCol,
  };
}

function withText(
  state: ComposerState,
  text: string,
): ComposerState {
  const next = createComposerState(text);
  return {
    ...next,
    pastes: state.pastes,
    pasteCounter: state.pasteCounter,
  };
}

function previousGraphemeBoundary(text: string, cursor: number): number {
  let boundary = 0;
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= cursor) {
      break;
    }
    boundary = segment.index;
  }
  return boundary;
}

function nextGraphemeBoundary(text: string, cursor: number): number {
  for (const segment of graphemeSegmenter.segment(text)) {
    const end = segment.index + segment.segment.length;
    if (end > cursor) {
      return end;
    }
  }
  return text.length;
}

function isWhitespace(character: string): boolean {
  return /\s/.test(character);
}

function previousWordBoundary(text: string, cursor: number): number {
  if (cursor <= 0) {
    return 0;
  }

  let boundary = cursor - 1;
  const whitespace = isWhitespace(text[boundary] ?? '');
  while (
    boundary > 0 &&
    isWhitespace(text[boundary - 1] ?? '') === whitespace
  ) {
    boundary -= 1;
  }
  return boundary;
}

function nextWordBoundary(text: string, cursor: number): number {
  if (cursor >= text.length) {
    return text.length;
  }

  let boundary = cursor + 1;
  const whitespace = isWhitespace(text[cursor] ?? '');
  while (
    boundary < text.length &&
    isWhitespace(text[boundary] ?? '') === whitespace
  ) {
    boundary += 1;
  }
  return boundary;
}

export function createComposerState(text = ''): ComposerState {
  const lines = text.split('\n');
  const cursorLine = lines.length - 1;
  return {
    lines,
    cursorLine,
    cursorCol: lines[cursorLine]?.length ?? 0,
    pastes: new Map(),
    pasteCounter: 0,
  };
}

export function getComposerText(state: ComposerState): string {
  return state.lines.join('\n');
}

export function insertText(
  state: ComposerState,
  text: string,
): ComposerState {
  const line = currentLine(state);
  const before = line.slice(0, state.cursorCol);
  const after = line.slice(state.cursorCol);
  const insertedLines = text.split('\n');
  const firstInsertedLine = insertedLines[0] ?? '';

  if (insertedLines.length === 1) {
    const lines = [...state.lines];
    lines[state.cursorLine] = before + firstInsertedLine + after;
    return {
      ...state,
      lines,
      cursorCol: state.cursorCol + firstInsertedLine.length,
    };
  }

  const lastInsertedLine = insertedLines[insertedLines.length - 1] ?? '';
  const replacement = [
    before + firstInsertedLine,
    ...insertedLines.slice(1, -1),
    lastInsertedLine + after,
  ];
  const lines = [
    ...state.lines.slice(0, state.cursorLine),
    ...replacement,
    ...state.lines.slice(state.cursorLine + 1),
  ];
  return {
    ...state,
    lines,
    cursorLine: state.cursorLine + insertedLines.length - 1,
    cursorCol: lastInsertedLine.length,
  };
}

export function insertNewline(state: ComposerState): ComposerState {
  return insertText(state, '\n');
}

export function deleteBackwardGrapheme(
  state: ComposerState,
): ComposerState {
  if (state.cursorCol === 0) {
    if (state.cursorLine === 0) {
      return state;
    }
    const previousLine = state.lines[state.cursorLine - 1] ?? '';
    const line = currentLine(state);
    const lines = [...state.lines];
    lines.splice(state.cursorLine - 1, 2, previousLine + line);
    return {
      ...state,
      lines,
      cursorLine: state.cursorLine - 1,
      cursorCol: previousLine.length,
    };
  }

  const line = currentLine(state);
  const boundary = previousGraphemeBoundary(line, state.cursorCol);
  const lines = [...state.lines];
  lines[state.cursorLine] =
    line.slice(0, boundary) + line.slice(state.cursorCol);
  return {
    ...state,
    lines,
    cursorCol: boundary,
  };
}

export function deleteForwardGrapheme(
  state: ComposerState,
): ComposerState {
  const line = currentLine(state);
  if (state.cursorCol === line.length) {
    if (state.cursorLine === state.lines.length - 1) {
      return state;
    }
    const nextLine = state.lines[state.cursorLine + 1] ?? '';
    const lines = [...state.lines];
    lines.splice(state.cursorLine, 2, line + nextLine);
    return {
      ...state,
      lines,
    };
  }

  const boundary = nextGraphemeBoundary(line, state.cursorCol);
  const lines = [...state.lines];
  lines[state.cursorLine] =
    line.slice(0, state.cursorCol) + line.slice(boundary);
  return {
    ...state,
    lines,
  };
}

export function deleteBackwardWord(state: ComposerState): ComposerState {
  if (state.cursorCol === 0) {
    return deleteBackwardGrapheme(state);
  }

  const line = currentLine(state);
  const boundary = previousWordBoundary(line, state.cursorCol);
  const lines = [...state.lines];
  lines[state.cursorLine] =
    line.slice(0, boundary) + line.slice(state.cursorCol);
  return {
    ...state,
    lines,
    cursorCol: boundary,
  };
}

export function deleteForwardWord(state: ComposerState): ComposerState {
  const line = currentLine(state);
  if (state.cursorCol === line.length) {
    return deleteForwardGrapheme(state);
  }

  const boundary = nextWordBoundary(line, state.cursorCol);
  const lines = [...state.lines];
  lines[state.cursorLine] =
    line.slice(0, state.cursorCol) + line.slice(boundary);
  return {
    ...state,
    lines,
  };
}

export function moveCursorLeft(state: ComposerState): ComposerState {
  if (state.cursorCol > 0) {
    return withCursor(
      state,
      state.cursorLine,
      previousGraphemeBoundary(currentLine(state), state.cursorCol),
    );
  }
  if (state.cursorLine === 0) {
    return state;
  }
  const previousLine = state.lines[state.cursorLine - 1] ?? '';
  return withCursor(state, state.cursorLine - 1, previousLine.length);
}

export function moveCursorRight(state: ComposerState): ComposerState {
  const line = currentLine(state);
  if (state.cursorCol < line.length) {
    return withCursor(
      state,
      state.cursorLine,
      nextGraphemeBoundary(line, state.cursorCol),
    );
  }
  if (state.cursorLine === state.lines.length - 1) {
    return state;
  }
  return withCursor(state, state.cursorLine + 1, 0);
}

export function moveCursorWordLeft(state: ComposerState): ComposerState {
  if (state.cursorCol > 0) {
    return withCursor(
      state,
      state.cursorLine,
      previousWordBoundary(currentLine(state), state.cursorCol),
    );
  }
  if (state.cursorLine === 0) {
    return state;
  }
  const previousLine = state.lines[state.cursorLine - 1] ?? '';
  return withCursor(state, state.cursorLine - 1, previousLine.length);
}

export function moveCursorWordRight(state: ComposerState): ComposerState {
  const line = currentLine(state);
  if (state.cursorCol < line.length) {
    return withCursor(
      state,
      state.cursorLine,
      nextWordBoundary(line, state.cursorCol),
    );
  }
  if (state.cursorLine === state.lines.length - 1) {
    return state;
  }
  return withCursor(state, state.cursorLine + 1, 0);
}

export function moveCursorUp(state: ComposerState): ComposerState {
  if (state.cursorLine === 0) {
    return state;
  }
  const targetLine = state.lines[state.cursorLine - 1] ?? '';
  return withCursor(
    state,
    state.cursorLine - 1,
    Math.min(state.cursorCol, targetLine.length),
  );
}

export function moveCursorDown(state: ComposerState): ComposerState {
  if (state.cursorLine === state.lines.length - 1) {
    return state;
  }
  const targetLine = state.lines[state.cursorLine + 1] ?? '';
  return withCursor(
    state,
    state.cursorLine + 1,
    Math.min(state.cursorCol, targetLine.length),
  );
}

export function moveCursorLineStart(state: ComposerState): ComposerState {
  return withCursor(state, state.cursorLine, 0);
}

export function moveCursorLineEnd(state: ComposerState): ComposerState {
  return withCursor(state, state.cursorLine, currentLine(state).length);
}

export function moveCursorTextStart(state: ComposerState): ComposerState {
  return withCursor(state, 0, 0);
}

export function moveCursorTextEnd(state: ComposerState): ComposerState {
  const cursorLine = state.lines.length - 1;
  return withCursor(
    state,
    cursorLine,
    state.lines[cursorLine]?.length ?? 0,
  );
}

export function clearComposer(state: ComposerState): ComposerState {
  return {
    lines: [''],
    cursorLine: 0,
    cursorCol: 0,
    pastes: state.pastes,
    pasteCounter: state.pasteCounter,
  };
}

export function historyUp(
  state: ComposerState,
  history: readonly string[],
  historyIndex: number | null,
): HistoryNavigationResult {
  if (state.cursorLine !== 0 || history.length === 0) {
    return { state, historyIndex };
  }

  const nextIndex =
    historyIndex === null
      ? history.length - 1
      : Math.max(0, historyIndex - 1);
  const entry = history[nextIndex];
  if (entry === undefined) {
    return { state, historyIndex };
  }
  return {
    state: withText(state, entry),
    historyIndex: nextIndex,
  };
}

export function historyDown(
  state: ComposerState,
  history: readonly string[],
  historyIndex: number | null,
): HistoryNavigationResult {
  if (
    state.cursorLine !== state.lines.length - 1 ||
    historyIndex === null
  ) {
    return { state, historyIndex };
  }

  if (historyIndex >= history.length - 1) {
    return {
      state: clearComposer(state),
      historyIndex: null,
    };
  }

  const nextIndex = historyIndex + 1;
  const entry = history[nextIndex];
  if (entry === undefined) {
    return { state, historyIndex };
  }
  return {
    state: withText(state, entry),
    historyIndex: nextIndex,
  };
}

export function capturePaste(
  state: ComposerState,
  text: string,
): ComposerState {
  const lineCount = text.split('\n').length;
  if (lineCount <= 10 && text.length <= 1000) {
    return insertText(state, text);
  }

  const id = state.pasteCounter + 1;
  const marker =
    lineCount > 10
      ? `[paste #${id} +${lineCount} lines]`
      : `[paste #${id} ${text.length} chars]`;
  const pastes = new Map(state.pastes);
  pastes.set(id, text);
  return insertText(
    {
      ...state,
      pastes,
      pasteCounter: id,
    },
    marker,
  );
}

export function expandPasteMarkerAtCursor(
  state: ComposerState,
): PasteExpansionResult {
  const line = currentLine(state);

  for (const match of line.matchAll(
    /\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/g,
  )) {
    const marker = match[0];
    const idText = match[1];
    const start = match.index;
    if (
      idText === undefined ||
      start === undefined ||
      state.cursorCol < start ||
      state.cursorCol > start + marker.length
    ) {
      continue;
    }

    const id = Number(idText);
    const pastedText = state.pastes.get(id);
    if (pastedText === undefined) {
      continue;
    }

    const lines = [...state.lines];
    lines[state.cursorLine] =
      line.slice(0, start) + line.slice(start + marker.length);
    const pastes = new Map(state.pastes);
    pastes.delete(id);
    const nextState = insertText(
      {
        ...state,
        lines,
        cursorCol: start,
        pastes,
      },
      pastedText,
    );
    return {
      state: nextState,
      expanded: true,
    };
  }

  return {
    state,
    expanded: false,
  };
}

export function detectComposerPrefix(
  state: ComposerState,
): ComposerPrefix | null {
  const line = currentLine(state);
  const beforeCursor = line.slice(0, state.cursorCol);

  if (state.cursorLine === 0) {
    const slashStart = line.search(/\S/);
    if (
      slashStart >= 0 &&
      line[slashStart] === '/' &&
      state.cursorCol > slashStart
    ) {
      const query = line.slice(slashStart + 1, state.cursorCol);
      if (!/\s/.test(query)) {
        return {
          kind: 'slash',
          query,
          start: slashStart,
        };
      }
    }
  }

  const tokenStart = beforeCursor.search(/\S+$/);
  if (
    tokenStart >= 0 &&
    beforeCursor[tokenStart] === '@' &&
    (tokenStart === 0 || /\s/.test(line[tokenStart - 1] ?? ''))
  ) {
    return {
      kind: 'mention',
      query: beforeCursor.slice(tokenStart + 1),
      start: tokenStart,
    };
  }

  return null;
}
