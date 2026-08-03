/**
 * Quarantined bridge to private pi-tui 0.81.1 editor state.
 *
 * pi-tui has no public cursor setter, so vim integration must use these
 * internals. Re-verify this file first before upgrading pi-tui.
 */

import type { Editor } from '@earendil-works/pi-tui';

import {
  graphemeColumnAtUtf16Offset,
  graphemeLength,
  utf16OffsetAtGraphemeColumn,
} from './graphemes';
import type { VimBuffer } from './types';

const PI_TUI_VERSION = '0.81.1';
const BRIDGE_FILE = 'apps/pythinker-code/src/tui/editor/vim/editor-bridge.ts';
const verifiedEditors = new WeakSet<object>();

/** The private surface this bridge depends on. Pinned to pi-tui 0.81.1. */
interface EditorInternals {
  state: { cursorLine: number; cursorCol: number };
  pastes: Map<number, string>;
  pasteCounter: number;
}

function incompatibleInternals(): Error {
  return new Error(
    `Unsupported pi-tui editor internals. Version ${PI_TUI_VERSION} is required; re-verify ${BRIDGE_FILE}.`,
  );
}

function getInternals(editor: Editor): EditorInternals {
  const internals = editor as unknown as EditorInternals;
  if (!verifiedEditors.has(editor)) {
    if (
      typeof internals.state !== 'object'
      || internals.state === null
      || typeof internals.state.cursorLine !== 'number'
      || typeof internals.state.cursorCol !== 'number'
      || !(internals.pastes instanceof Map)
      || typeof internals.pasteCounter !== 'number'
    ) {
      throw incompatibleInternals();
    }
    for (const [id, content] of internals.pastes) {
      if (typeof id !== 'number' || typeof content !== 'string') {
        throw incompatibleInternals();
      }
    }
    verifiedEditors.add(editor);
  }
  return internals;
}

function clamp(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), maximum));
}

function hasPasteMarker(text: string, pasteId: number): boolean {
  const marker = new RegExp(
    `\\[paste #${String(pasteId)}(?: (?:\\+\\d+ lines|\\d+ chars))?\\]`,
    'u',
  );
  return marker.test(text);
}

/** Read the editor into a VimBuffer. */
export function readBuffer(editor: Editor): VimBuffer {
  getInternals(editor);
  const cursor = editor.getCursor();
  const lines = editor.getLines();
  const line = clamp(cursor.line, lines.length - 1);
  return {
    lines,
    line,
    // pi-tui cursors are UTF-16 offsets; the engine works in grapheme columns.
    column: graphemeColumnAtUtf16Offset(lines[line] ?? '', cursor.col),
  };
}

/** Apply a vim result back. Preserves paste payloads and only writes when needed. */
export function applyBuffer(editor: Editor, next: VimBuffer): void {
  const internals = getInternals(editor);
  const nextText = next.lines.join('\n');

  if (nextText !== editor.getText()) {
    const savedPastes = new Map(internals.pastes);
    const savedPasteCounter = internals.pasteCounter;
    editor.setText(nextText);
    internals.pastes = savedPastes;
    internals.pasteCounter = savedPasteCounter;

    for (const pasteId of internals.pastes.keys()) {
      if (!hasPasteMarker(nextText, pasteId)) {
        internals.pastes.delete(pasteId);
      }
    }
  }

  const lines = editor.getLines();
  const cursorLine = clamp(next.line, lines.length - 1);
  const cursorText = lines[cursorLine] ?? '';
  const cursorColumn = clamp(next.column, graphemeLength(cursorText));
  internals.state.cursorLine = cursorLine;
  // Convert back to the UTF-16 offset pi-tui stores, so surrogate pairs and
  // combining sequences are never split at the cursor.
  internals.state.cursorCol = utf16OffsetAtGraphemeColumn(cursorText, cursorColumn);
  editor.invalidate();
}
