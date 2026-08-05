import type {
  AutocompleteItem,
  AutocompleteProvider,
  TUI,
} from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { CustomEditor } from '#/tui/components/editor/custom-editor';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import {
  applyKey,
  createInitialPersistent,
  createInitialState,
  type PersistentState,
  type VimBuffer,
  type VimState,
} from '../../../../src/tui/editor/vim';

const ESCAPE = '\u001B';
const PASTE_START = '\u001B[200~';
const PASTE_END = '\u001B[201~';
const UNDO = '\u001F';
const UP = '\u001B[A';
const DOWN = '\u001B[B';
const RIGHT = '\u001B[C';
const LEFT = '\u001B[D';
const HOME = '\u001B[H';
const END = '\u001B[F';
const KITTY_D = '\u001B[100u';
const KITTY_Q = '\u001B[113u';
const KITTY_W = '\u001B[119u';

function makeEditor(vimMode = true): CustomEditor {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 40, cols: 120 },
  } as unknown as TUI;
  return new CustomEditor(tui, { vimMode });
}

function typeText(editor: CustomEditor, text: string): void {
  for (const character of Array.from(text)) {
    editor.handleInput(character);
  }
}

function pasteLargeText(editor: CustomEditor, content: string): string {
  editor.handleInput('i');
  editor.handleInput(`${PASTE_START}${content}${PASTE_END}`);
  editor.handleInput(ESCAPE);
  return editor.getText();
}

function autocompleteProvider(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({ items, prefix: '/' })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
      lines,
      cursorLine,
      cursorCol,
    })),
  };
}

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function runPureKeys(buffer: VimBuffer, keys: string): VimBuffer {
  let state: VimState = createInitialState();
  let persistent: PersistentState = createInitialPersistent();
  let current = buffer;
  for (const key of Array.from(keys)) {
    const result = applyKey(state, persistent, current, key);
    state = result.state;
    persistent = result.persistent;
    current = result.buffer;
  }
  return current;
}

describe('vim editor bridge paste integrity', () => {
  const content = Array.from(
    { length: 15 },
    (_, index) => `line${String(index)}`,
  ).join('\n');

  it('routes a large paste through pi-tui in NORMAL mode', () => {
    const editor = makeEditor();

    editor.handleInput(`${PASTE_START}${content}${PASTE_END}`);

    expect(editor.getText()).toMatch(/^\[paste #\d+ \+\d+ lines\]$/u);
    expect(editor.getExpandedText()).toBe(content);
  });

  it('routes a large paste through pi-tui in INSERT mode', () => {
    const editor = makeEditor();
    editor.handleInput('i');

    editor.handleInput(`${PASTE_START}${content}${PASTE_END}`);

    expect(editor.getText()).toMatch(/^\[paste #\d+ \+\d+ lines\]$/u);
    expect(editor.getExpandedText()).toBe(content);
  });

  it('routes a large paste through pi-tui when vim mode is off', () => {
    const editor = makeEditor(false);

    editor.handleInput(`${PASTE_START}${content}${PASTE_END}`);

    expect(editor.getText()).toMatch(/^\[paste #\d+ \+\d+ lines\]$/u);
    expect(editor.getExpandedText()).toBe(content);
  });

  it.each(['l', 'w', 'j'])(
    'preserves a large paste payload across the %s motion',
    (motion) => {
      const editor = makeEditor();
      pasteLargeText(editor, content);

      editor.handleInput(motion);

      expect(editor.getExpandedText()).toBe(content);
    },
  );

  it('preserves a large paste payload across an edit outside its marker', () => {
    const editor = makeEditor();
    pasteLargeText(editor, content);

    editor.handleInput('A');
    typeText(editor, ' tail');
    editor.handleInput(ESCAPE);

    expect(editor.getExpandedText()).toBe(`${content} tail`);
  });

  it('preserves a large paste payload when vim changes adjacent text', () => {
    const editor = makeEditor();
    pasteLargeText(editor, content);
    editor.handleInput('A');
    typeText(editor, ' tail');
    editor.handleInput(ESCAPE);

    typeText(editor, 'bx');

    expect(editor.getExpandedText()).toBe(`${content} ail`);
  });

  it('drops a deleted marker payload instead of retaining stale content', () => {
    const editor = makeEditor();
    const marker = pasteLargeText(editor, content);

    typeText(editor, 'dd');
    expect(editor.getText()).toBe('');

    editor.insertTextAtCursor(marker);
    expect(editor.getExpandedText()).toBe(marker);
  });
});

describe('vim editor bridge pi-tui ownership', () => {
  it('makes an edit performed by vim undoable through pi-tui', () => {
    const editor = makeEditor();
    editor.setText('abc');

    typeText(editor, '0x');
    expect(editor.getText()).toBe('bc');

    editor.handleInput('i');
    editor.handleInput(UNDO);

    expect(editor.getText()).toBe('abc');
  });

  it('does not add an undo snapshot for a pure motion', () => {
    const editor = makeEditor();
    editor.setText('abc');

    editor.handleInput('h');
    editor.handleInput('i');
    editor.handleInput(UNDO);

    expect(editor.getText()).toBe('');
  });

  it('keeps slash autocomplete functional in INSERT and cancels it on NORMAL entry', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      autocompleteProvider([{ value: 'help', label: 'help' }]),
    );

    editor.handleInput('i');
    editor.handleInput('/');
    await flushAutocomplete();
    expect(editor.isShowingAutocomplete()).toBe(true);

    editor.handleInput(ESCAPE);
    expect(editor.isShowingAutocomplete()).toBe(false);

    editor.handleInput('x');
    expect(editor.getText()).toBe('');
  });

  it('keeps history browsing functional after a vim edit', () => {
    const editor = makeEditor();
    editor.setText('abc');
    typeText(editor, '0x');
    editor.addToHistory('first');
    editor.addToHistory('second');

    editor.handleInput('i');
    editor.handleInput(UP);

    expect(editor.getText()).toBe('second');
  });
});

describe('vim editor bridge mode and cursor behavior', () => {
  it('routes bare Escape to vim when leaving INSERT mode', () => {
    const editor = makeEditor();
    editor.setText('abc');
    editor.handleInput('0');
    editor.handleInput('i');

    editor.handleInput(ESCAPE);
    editor.handleInput('x');

    expect(editor.getText()).toBe('bc');
  });

  it('routes bare Escape to vim to cancel a pending command', () => {
    const editor = makeEditor();
    editor.setText('alpha beta');
    editor.handleInput('0');
    editor.handleInput('d');

    editor.handleInput(ESCAPE);
    editor.handleInput('w');

    expect(editor.getText()).toBe('alpha beta');
  });

  it('keeps text byte-identical across an empty i and Escape round-trip', () => {
    const editor = makeEditor();
    editor.setText('alpha\nbeta');
    const before = editor.getText();

    editor.handleInput('i');
    editor.handleInput(ESCAPE);

    expect(editor.getText()).toBe(before);
  });

  it('is off by default so vim command letters remain literal input', () => {
    const editor = makeEditor(false);

    typeText(editor, 'dwxi');

    expect(editor.getText()).toBe('dwxi');
  });

  it('enables and disables vim mode after construction', () => {
    const editor = makeEditor(false);
    editor.setText('alpha beta');

    editor.setVimMode(true);
    editor.handleInput('0');
    typeText(editor, 'dw');
    expect(editor.getText()).toBe('beta');

    editor.setText('');
    editor.setVimMode(false);
    typeText(editor, 'dw');
    expect(editor.getText()).toBe('dw');
  });

  it('preserves INSERT mode when vim mode is enabled redundantly', () => {
    const editor = makeEditor(false);
    editor.setVimMode(true);
    editor.handleInput('i');

    editor.setVimMode(true);
    editor.handleInput('x');

    expect(editor.getText()).toBe('x');
  });

  it('does not leak printable keys into the text in NORMAL mode', () => {
    const editor = makeEditor();

    typeText(editor, 'dwxq');

    expect(editor.getText()).toBe('');
  });

  it('moves right and left with terminal arrow sequences in NORMAL mode', () => {
    const editor = makeEditor();
    editor.setText('alpha beta');
    editor.handleInput('0');

    editor.handleInput(RIGHT);
    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });

    editor.handleInput(LEFT);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it('moves down and up across lines with terminal arrow sequences in NORMAL mode', () => {
    const editor = makeEditor();
    editor.setText('alpha\nbeta');
    typeText(editor, 'gg0');

    editor.handleInput(DOWN);
    expect(editor.getCursor()).toEqual({ line: 1, col: 0 });

    editor.handleInput(UP);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
  });

  it('routes Home and End without corrupting the buffer in NORMAL mode', () => {
    const editor = makeEditor();
    editor.setText('alpha beta');
    editor.handleInput('0');
    const before = editor.getText();

    editor.handleInput(END);
    expect(editor.getCursor()).toEqual({ line: 0, col: before.length });

    editor.handleInput(HOME);
    expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(editor.getText()).toBe(before);
  });

  it.each([
    ['astral emoji', 'a😀b', 3],
    ['combining sequence', 'ae\u0301b', 3],
    ['flag', 'a🇺🇸b', 5],
    ['ZWJ emoji', 'a👩‍💻b', 6],
  ])(
    'converts %s between vim grapheme columns and pi-tui UTF-16 offsets',
    (_name, text, utf16Column) => {
      const editor = makeEditor();
      editor.setText(text);

      typeText(editor, '0ll');
      expect(editor.getCursor()).toEqual({ line: 0, col: utf16Column });

      editor.handleInput('h');
      expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
      expect(editor.getText()).toBe(text);
    },
  );

  it('inserts next to an astral character without splitting its surrogate pair', () => {
    const editor = makeEditor();
    editor.setText('a😀b');

    typeText(editor, '0lliX');
    editor.handleInput(ESCAPE);

    expect(editor.getText()).toBe('a😀Xb');
    expect(editor.getText()).not.toContain('\uFFFD');
  });

  it('opens indented lines above and below through the real editor', () => {
    const below = makeEditor();
    below.setText('  one\ntwo');
    typeText(below, 'gg0oX');
    below.handleInput(ESCAPE);
    expect(below.getText()).toBe('  one\n  X\ntwo');

    const above = makeEditor();
    above.setText('one');
    typeText(above, '0OX');
    above.handleInput(ESCAPE);
    expect(above.getText()).toBe('X\none');
  });

  it('applies vim commands sent as Kitty CSI-u printables', () => {
    const editor = makeEditor();
    editor.setText('alpha beta');
    editor.handleInput('0');

    editor.handleInput(KITTY_D);
    editor.handleInput(KITTY_W);

    expect(editor.getText()).toBe('beta');
  });

  it('does not leak a Kitty CSI-u printable in NORMAL mode', () => {
    const editor = makeEditor();

    editor.handleInput(KITTY_Q);

    expect(editor.getText()).toBe('');
  });

  it('inserts a Kitty CSI-u printable in INSERT mode', () => {
    const editor = makeEditor();
    editor.handleInput('i');

    editor.handleInput(KITTY_Q);

    expect(editor.getText()).toBe('q');
  });

  it('keeps an astral Kitty printable under vim ownership in NORMAL mode', () => {
    const editor = makeEditor();

    editor.handleInput('\u001B[128512u');

    expect(editor.getText()).toBe('');
  });

  it('drops Kitty release events before NORMAL or INSERT vim handling', () => {
    const editor = makeEditor();

    editor.handleInput('\u001B[110;1:3u');
    editor.handleInput('i');
    editor.handleInput('\u001B[110u');
    editor.handleInput('\u001B[110;1:3u');

    expect(editor.getText()).toBe('n');
  });

  it('routes legacy application shortcuts before vim handling', () => {
    const editor = makeEditor();
    const onCtrlC = vi.fn();
    const onCtrlD = vi.fn();
    const onSearchHistory = vi.fn();
    const onCommand = vi.fn();
    editor.onCtrlC = onCtrlC;
    editor.onCtrlD = onCtrlD;
    editor.onSearchHistory = onSearchHistory;
    editor.onCommand = onCommand;
    editor.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Chat', bindings: { 'ctrl+r': 'chat:historySearch' } },
      ]),
    ]);

    editor.handleInput('\u0003');
    editor.handleInput('\u0004');
    editor.handleInput('\u0012');
    editor.handleInput('\u001Bp');

    expect(onCtrlC).toHaveBeenCalledOnce();
    expect(onCtrlD).toHaveBeenCalledOnce();
    expect(onSearchHistory).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith('model');
    expect(editor.getText()).toBe('');
  });

  it('does not call setText for a pure motion sequence', () => {
    const editor = makeEditor();
    editor.setText('alpha beta gamma');
    const before = editor.getText();
    const setText = vi.spyOn(editor, 'setText');

    typeText(editor, '0wwbb0$');

    expect(editor.getText()).toBe(before);
    expect(setText).not.toHaveBeenCalled();
  });

  it('edits with dw and delegates INSERT typing to pi-tui', () => {
    const editor = makeEditor();
    editor.setText('alpha beta');
    editor.handleInput('0');

    typeText(editor, 'dw');
    editor.handleInput('i');
    typeText(editor, 'new ');
    editor.handleInput(ESCAPE);

    expect(editor.getText()).toBe('new beta');
  });

  it.each([
    ['h', 'h'],
    ['l', '0l'],
    ['j', 'ggj'],
    ['k', 'k'],
    ['w', 'ggw'],
    ['W', 'ggW'],
    ['b', 'b'],
    ['B', 'B'],
    ['e', 'gge'],
    ['E', 'ggE'],
    ['0', '0'],
    ['^', '^'],
    ['$', '0$'],
    ['gg', 'gg'],
    ['G', 'ggG'],
    ['f', 'gg0ft'],
    ['F', 'Ff'],
    ['t', 'gg0tw'],
    ['T', 'T '],
    [';', 'gg0ft;'],
    [',', 'gg0ft;,'],
  ])('matches the pure state machine cursor for %s', (_motion, keys) => {
    const editor = makeEditor();
    editor.setText('  one two\nthree four\n  five six');
    const initialCursor = editor.getCursor();
    const expected = runPureKeys(
      {
        lines: editor.getLines(),
        line: initialCursor.line,
        column: initialCursor.col,
      },
      keys,
    );

    typeText(editor, keys);

    expect(editor.getCursor()).toEqual({
      line: expected.line,
      col: expected.column,
    });
  });
});
