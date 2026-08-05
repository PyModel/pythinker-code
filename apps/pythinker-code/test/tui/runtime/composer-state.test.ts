import { describe, expect, it } from 'vitest';

import {
  capturePaste,
  clearComposer,
  createComposerState,
  deleteBackwardGrapheme,
  deleteBackwardWord,
  deleteForwardGrapheme,
  deleteForwardWord,
  detectComposerPrefix,
  expandPasteMarkerAtCursor,
  getComposerText,
  historyDown,
  historyUp,
  insertNewline,
  insertText,
  moveCursorDown,
  moveCursorLeft,
  moveCursorLineEnd,
  moveCursorLineStart,
  moveCursorRight,
  moveCursorTextEnd,
  moveCursorTextStart,
  moveCursorUp,
  moveCursorWordLeft,
  moveCursorWordRight,
} from '#/tui/runtime/footer/composer-state';

describe('composer state', () => {
  it('creates state and inserts single-line and multiline text', () => {
    const initial = createComposerState('ac');
    const positioned = moveCursorLeft(initial);
    const inserted = insertText(positioned, 'b');
    const multiline = insertText(inserted, '\none');

    expect(getComposerText(initial)).toBe('ac');
    expect(getComposerText(inserted)).toBe('abc');
    expect(multiline.lines).toEqual(['ab', 'onec']);
    expect(multiline.cursorLine).toBe(1);
    expect(multiline.cursorCol).toBe(3);
  });

  it('inserts a newline at the cursor', () => {
    const state = moveCursorLeft(createComposerState('ab'));
    const result = insertNewline(state);

    expect(result.lines).toEqual(['a', 'b']);
    expect(result.cursorLine).toBe(1);
    expect(result.cursorCol).toBe(0);
  });

  it('deletes emoji and combining sequences as single graphemes', () => {
    const emoji = createComposerState('a👨‍👩‍👧‍👦');
    const withoutEmoji = deleteBackwardGrapheme(emoji);
    const combining = moveCursorTextStart(createComposerState('e\u0301x'));
    const withoutCombining = deleteForwardGrapheme(combining);

    expect(getComposerText(withoutEmoji)).toBe('a');
    expect(withoutEmoji.cursorCol).toBe(1);
    expect(getComposerText(withoutCombining)).toBe('x');
  });

  it('joins lines when deleting graphemes at line boundaries', () => {
    const atSecondStart = moveCursorLineStart(createComposerState('one\ntwo'));
    const backward = deleteBackwardGrapheme(atSecondStart);
    const atFirstEnd = moveCursorLineEnd(
      moveCursorTextStart(createComposerState('one\ntwo')),
    );
    const forward = deleteForwardGrapheme(atFirstEnd);

    expect(getComposerText(backward)).toBe('onetwo');
    expect(backward.cursorCol).toBe(3);
    expect(getComposerText(forward)).toBe('onetwo');
    expect(forward.cursorCol).toBe(3);
  });

  it('deletes whitespace and non-whitespace word runs', () => {
    const backward = deleteBackwardWord(createComposerState('one  two'));
    const backwardWhitespace = deleteBackwardWord(backward);
    const atStart = moveCursorTextStart(createComposerState('one  two'));
    const forward = deleteForwardWord(atStart);
    const forwardWhitespace = deleteForwardWord(forward);

    expect(getComposerText(backward)).toBe('one  ');
    expect(getComposerText(backwardWhitespace)).toBe('one');
    expect(getComposerText(forward)).toBe('  two');
    expect(getComposerText(forwardWhitespace)).toBe('two');
  });

  it('moves by grapheme, word, line, and full text boundaries', () => {
    const state = createComposerState('one  two\nx');
    const textStart = moveCursorTextStart(state);
    const wordRight = moveCursorWordRight(textStart);
    const whitespaceRight = moveCursorWordRight(wordRight);
    const wordLeft = moveCursorWordLeft(whitespaceRight);
    const lineEnd = moveCursorLineEnd(textStart);
    const nextLine = moveCursorRight(lineEnd);
    const previousLine = moveCursorLeft(nextLine);
    const textEnd = moveCursorTextEnd(textStart);

    expect(wordRight.cursorCol).toBe(3);
    expect(whitespaceRight.cursorCol).toBe(5);
    expect(wordLeft.cursorCol).toBe(3);
    expect(nextLine).toMatchObject({ cursorLine: 1, cursorCol: 0 });
    expect(previousLine).toMatchObject({ cursorLine: 0, cursorCol: 8 });
    expect(textEnd).toMatchObject({ cursorLine: 1, cursorCol: 1 });
    expect(moveCursorLineStart(textEnd).cursorCol).toBe(0);
  });

  it('clamps the cursor column when moving up and down', () => {
    const fromBottom = createComposerState('ab\n12345');
    const up = moveCursorUp(fromBottom);
    const fromTop = moveCursorTextStart(createComposerState('12345\nab'));
    const atTopEnd = moveCursorLineEnd(fromTop);
    const down = moveCursorDown(atTopEnd);

    expect(up).toMatchObject({ cursorLine: 0, cursorCol: 2 });
    expect(down).toMatchObject({ cursorLine: 1, cursorCol: 2 });
  });

  it('clears text while preserving captured paste state', () => {
    const captured = capturePaste(createComposerState(), 'x'.repeat(1001));
    const cleared = clearComposer(captured);

    expect(cleared.lines).toEqual(['']);
    expect(cleared.cursorLine).toBe(0);
    expect(cleared.cursorCol).toBe(0);
    expect(cleared.pastes).toBe(captured.pastes);
    expect(cleared.pasteCounter).toBe(1);
  });

  it('navigates history and exits past the newest entry', () => {
    const history = ['first', 'second'];
    const initial = createComposerState();
    const latest = historyUp(initial, history, null);
    const older = historyUp(latest.state, history, latest.historyIndex);
    const newer = historyDown(older.state, history, older.historyIndex);
    const exited = historyDown(newer.state, history, newer.historyIndex);

    expect(getComposerText(latest.state)).toBe('second');
    expect(latest.historyIndex).toBe(1);
    expect(getComposerText(older.state)).toBe('first');
    expect(older.historyIndex).toBe(0);
    expect(getComposerText(newer.state)).toBe('second');
    expect(newer.historyIndex).toBe(1);
    expect(getComposerText(exited.state)).toBe('');
    expect(exited.historyIndex).toBeNull();
  });

  it('only navigates history from the required first or last line', () => {
    const history = ['entry'];
    const onLastLine = createComposerState('one\ntwo');
    const blockedUp = historyUp(onLastLine, history, null);
    const onFirstLine = moveCursorTextStart(onLastLine);
    const blockedDown = historyDown(onFirstLine, history, 0);

    expect(blockedUp.state).toBe(onLastLine);
    expect(blockedUp.historyIndex).toBeNull();
    expect(blockedDown.state).toBe(onFirstLine);
    expect(blockedDown.historyIndex).toBe(0);
  });

  it('captures large pastes using both legacy marker formats', () => {
    const manyLines = Array.from({ length: 11 }, (_, index) =>
      String(index),
    ).join('\n');
    const lineMarker = capturePaste(createComposerState(), manyLines);
    const longText = 'x'.repeat(1001);
    const charMarker = capturePaste(lineMarker, longText);

    expect(getComposerText(lineMarker)).toBe('[paste #1 +11 lines]');
    expect(getComposerText(charMarker)).toBe(
      '[paste #1 +11 lines][paste #2 1001 chars]',
    );
    expect(charMarker.pastes.get(1)).toBe(manyLines);
    expect(charMarker.pastes.get(2)).toBe(longText);
  });

  it('inserts small pastes verbatim', () => {
    const pasted = capturePaste(createComposerState('a'), 'b\nc');

    expect(getComposerText(pasted)).toBe('ab\nc');
    expect(pasted.pasteCounter).toBe(0);
    expect(pasted.pastes.size).toBe(0);
  });

  it('expands the marker under the cursor and preserves other pastes', () => {
    const firstText = 'a'.repeat(1001);
    const secondText = 'b'.repeat(1001);
    const withFirst = capturePaste(createComposerState(), firstText);
    const withBoth = capturePaste(withFirst, secondText);
    const atFirstMarker = moveCursorTextStart(withBoth);
    const expanded = expandPasteMarkerAtCursor(atFirstMarker);

    expect(expanded.expanded).toBe(true);
    expect(getComposerText(expanded.state)).toBe(
      `${firstText}[paste #2 1001 chars]`,
    );
    expect(expanded.state.pastes.has(1)).toBe(false);
    expect(expanded.state.pastes.get(2)).toBe(secondText);
  });

  it('does not expand a marker when the cursor is outside it', () => {
    const captured = capturePaste(
      createComposerState('prefix '),
      'x'.repeat(1001),
    );
    const outside = moveCursorTextStart(captured);
    const result = expandPasteMarkerAtCursor(outside);

    expect(result.expanded).toBe(false);
    expect(result.state).toBe(outside);
  });

  it('detects slash and mention prefixes under the cursor', () => {
    const slash = detectComposerPrefix(createComposerState('  /help'));
    const mention = detectComposerPrefix(createComposerState('hello @ali'));
    const embeddedMention = detectComposerPrefix(
      createComposerState('hello x@ali'),
    );

    expect(slash).toEqual({ kind: 'slash', query: 'help', start: 2 });
    expect(mention).toEqual({ kind: 'mention', query: 'ali', start: 6 });
    expect(embeddedMention).toBeNull();
  });

  it('only detects slash prefixes on the first line', () => {
    const secondLineSlash = detectComposerPrefix(
      createComposerState('first\n/help'),
    );
    const nonLeadingSlash = detectComposerPrefix(
      createComposerState('text /help'),
    );

    expect(secondLineSlash).toBeNull();
    expect(nonLeadingSlash).toBeNull();
  });
});
