import { visibleWidth } from '@earendil-works/pi-tui';
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  TUI,
} from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomEditor,
  insertAutocompleteGhost,
} from '#/tui/components/editor/custom-editor';
import {
  setRainbowColors,
  type RainbowColorController,
} from '#/tui/easter-eggs/rainbow-colors';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { darkColors } from '#/tui/theme';

function makeEditor(): CustomEditor {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 40, cols: 120 },
  } as unknown as TUI;
  return new CustomEditor(tui);
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function providerReturning(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({ items, prefix: '/' })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol })),
  };
}

describe('autocomplete ghost insertion', () => {
  const line = '  ❯ /exi\u001B[7m \u001B[0m      ';
  // oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences
  const stripAnsi = (value: string): string => value.replaceAll(/\u001B\[[0-9;]*m/g, '');

  it('preserves the cursor SGR reset and visible line width', () => {
    const output = insertAutocompleteGhost(line, 't ') ?? '';

    expect(output.split('\u001B[7m')).toHaveLength(2);
    expect(output.split('\u001B[0m')).toHaveLength(2);
    expect(output.indexOf('\u001B[7m')).toBeLessThan(output.indexOf('\u001B[0m'));
    expect(stripAnsi(output).length).toBe(stripAnsi(line).length);
  });

  it('places the first ghost character in the cursor and mutes the remainder', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;

    try {
      const output = insertAutocompleteGhost(line, 't ') ?? '';
      const mutedRemainder = chalk.hex(darkColors.textMuted)(' ');

      expect(output).toContain(`\u001B[7mt\u001B[0m${mutedRemainder}`);
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('does not insert a ghost over a non-blank cursor character', () => {
    expect(insertAutocompleteGhost('  ❯ /exi\u001B[7mx\u001B[0m      ', 't ')).toBeUndefined();
  });

  it('uses the cursor cell when no trailing padding is available', () => {
    const input = '  ❯ /exi\u001B[7m \u001B[0m';
    const output = insertAutocompleteGhost(input, 't ') ?? '';

    expect(output).toContain('\u001B[7mt\u001B[0m');
    expect(output.split('\u001B[7m')).toHaveLength(2);
    expect(output.split('\u001B[0m')).toHaveLength(2);
    expect(stripAnsi(output).length).toBe(stripAnsi(input).length);
  });
});

describe('CustomEditor autocomplete Escape handling', () => {
  it('escape closes a visible slash command menu without firing app-level escape', async () => {
    const editor = makeEditor();
    const onEscape = vi.fn();
    editor.onEscape = onEscape;
    editor.setAutocompleteProvider(providerReturning([{ value: 'help', label: 'help' }]));

    editor.handleInput('/');
    await flushAutocomplete();

    expect(editor.isShowingAutocomplete()).toBe(true);

    editor.handleInput('\u001B');

    expect(editor.isShowingAutocomplete()).toBe(false);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('escape cancels an in-flight slash command menu request', async () => {
    const editor = makeEditor();
    const onEscape = vi.fn();
    let resolveSuggestions: (items: AutocompleteItem[]) => void = () => {};
    const provider: AutocompleteProvider = {
      getSuggestions: vi.fn(
        () =>
          new Promise<AutocompleteSuggestions | null>((resolve) => {
            resolveSuggestions = (items) =>{  resolve({ items, prefix: '/' }); };
          }),
      ),
      applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol })),
    };
    editor.onEscape = onEscape;
    editor.setAutocompleteProvider(provider);

    editor.handleInput('/');
    await flushAutocomplete();
    editor.handleInput('\u001B');
    resolveSuggestions([{ value: 'help', label: 'help' }]);
    await flushAutocomplete();

    expect(editor.isShowingAutocomplete()).toBe(false);
    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe('CustomEditor configurable autocomplete routing', () => {
  it('prefers autocomplete bindings over chat bindings and returns to chat after closing', async () => {
    const editor = makeEditor();
    const onCommand = vi.fn();
    editor.onCommand = onCommand;
    editor.setAutocompleteProvider(
      providerReturning([
        { value: 'first-command', label: 'first-command' },
        { value: 'second-command', label: 'second-command' },
      ]),
    );
    editor.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Autocomplete', bindings: { 'alt+j': 'autocomplete:next' } },
        { context: 'Chat', bindings: { 'alt+j': 'chat:modelPicker' } },
      ]),
    );

    editor.handleInput('/');
    await flushAutocomplete();
    editor.handleInput('\u001Bj');

    expect(editor.render(80).join('\n')).toContain('second-command');
    expect(onCommand).not.toHaveBeenCalled();

    editor.handleInput('\u001B');
    editor.handleInput('\u001Bj');

    expect(onCommand).toHaveBeenCalledWith('model');
  });

  it('forwards the canonical Down sequence to the autocomplete list', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      providerReturning([
        { value: 'first-command', label: 'first-command' },
        { value: 'second-command', label: 'second-command' },
      ]),
    );

    editor.handleInput('/');
    await flushAutocomplete();
    editor.handleInput('\u001B[B');

    const autocomplete = editor as unknown as {
      autocompleteList?: { getSelectedItem(): AutocompleteItem | null };
    };
    expect(autocomplete.autocompleteList?.getSelectedItem()?.value).toBe('second-command');
    expect(editor.getText()).toBe('/');
    expect(editor.isShowingAutocomplete()).toBe(true);
  });

  it('honors autocomplete null-unbindings over defaults', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      providerReturning([
        { value: 'first-command', label: 'first-command' },
        { value: 'second-command', label: 'second-command' },
      ]),
    );
    editor.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([{ context: 'Autocomplete', bindings: { down: null } }]),
    ]);

    editor.handleInput('/');
    await flushAutocomplete();
    editor.handleInput('\u001B[B');

    expect(editor.render(80).join('\n')).toContain('first-command');
  });
});

describe('CustomEditor slash menu description wrapping', () => {
  // oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences
  const stripAnsi = (s: string): string => s.replaceAll(/\u001B\[[0-9;]*m/g, '');

  it('renders a compact slash menu below the composer, aligned with its slash', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      providerReturning([
        { value: 'auto', label: 'auto', description: 'Toggle Auto mode' },
        { value: 'colors', label: 'colors', description: 'Toggle colors' },
      ]),
    );

    editor.handleInput('/');
    await flushAutocomplete();

    const lines = editor.render(80).map(stripAnsi);
    const promptIndex = lines.findIndex((line) => line.startsWith('❯ /'));
    const selectedIndex = lines.findIndex((line) => line.startsWith('❯ auto'));
    const colorsIndex = lines.findIndex((line) => line.startsWith('  colors'));

    expect(lines[0]).toMatch(/^─+$/u);
    expect(lines.join('\n')).not.toContain('Slash commands');
    expect(promptIndex).toBe(1);
    expect(lines[promptIndex + 1]).toMatch(/^─+$/u);
    expect(selectedIndex).toBeGreaterThan(promptIndex + 1);
    expect(colorsIndex).toBeGreaterThan(selectedIndex);
    expect(lines[selectedIndex]).toMatch(/^❯ auto/u);
    expect(lines[colorsIndex]).toMatch(/^ {2}colors/u);
    expect(lines[selectedIndex]?.indexOf('auto')).toBe(
      lines[promptIndex]?.indexOf('/'),
    );
  });

  it('aligns a wrapped slash menu with the active slash', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      providerReturning([{ value: 'help', label: 'help', description: 'Show help' }]),
    );

    editor.setText('review this long prompt /he');
    editor.handleInput('\t');
    await flushAutocomplete();

    const lines = editor.render(24).map(stripAnsi);
    const promptLine = lines.find((line) => line.includes('/he'));
    const selectedLine = lines.find((line) => line.trimStart().startsWith('❯ help'));

    expect(lines[0]).toMatch(/^╭/u);
    expect(promptLine).toBeDefined();
    expect(selectedLine).toBeDefined();
    expect(selectedLine?.indexOf('help')).toBe(promptLine?.indexOf('/he'));
  });

  it('aligns the slash menu by terminal cells after wide and combining graphemes', async () => {
    const editor = makeEditor();
    editor.setAutocompleteProvider(
      providerReturning([{ value: 'help', label: 'help', description: 'Show help' }]),
    );

    editor.setText('猫🇺🇸e\u0301 /he');
    editor.handleInput('\t');
    await flushAutocomplete();

    const lines = editor.render(40).map(stripAnsi);
    const promptLine = lines.find((line) => line.includes('/he')) ?? '';
    const selectedLine = lines.find((line) => line.trimStart().startsWith('❯ help')) ?? '';
    const promptPrefix = promptLine.slice(0, promptLine.indexOf('/he'));
    const menuPrefix = selectedLine.slice(0, selectedLine.indexOf('help'));

    expect(promptLine).not.toBe('');
    expect(selectedLine).not.toBe('');
    expect(visibleWidth(menuPrefix)).toBe(visibleWidth(promptPrefix));
  });

  it('wraps long slash command descriptions to at most two lines with an ellipsis', async () => {
    const editor = makeEditor();
    const description = 'word '.repeat(60).trim();
    editor.setAutocompleteProvider(
      providerReturning([{ value: 'deep', label: 'deep', description }]),
    );

    editor.handleInput('/');
    await flushAutocomplete();

    const plain = editor.render(90).map(stripAnsi);
    const descriptionLines = plain.filter((line) => line.includes('word'));
    expect(descriptionLines).toHaveLength(2);
    expect(descriptionLines[1]).toContain('…');
  });

  it('keeps non-slash autocomplete descriptions on a single line', async () => {
    const editor = makeEditor();
    const description = 'path '.repeat(60).trim();
    const provider: AutocompleteProvider = {
      getSuggestions: vi.fn(async () => ({
        items: [{ value: '@src/file.ts', label: 'file.ts', description }],
        prefix: '@f',
      })),
      applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
        lines,
        cursorLine,
        cursorCol,
      })),
    };
    editor.setAutocompleteProvider(provider);

    editor.handleInput('@');
    // @-mention requests are debounced (20ms), unlike slash menus.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await flushAutocomplete();

    const plain = editor.render(90).map(stripAnsi);
    const descriptionLines = plain.filter((line) => line.includes('path'));
    expect(descriptionLines).toHaveLength(1);
    expect(plain.join('\n')).not.toContain('…');
  });

  it('renders inline ghost text for slash completions in the middle of the prompt', async () => {
    const editor = makeEditor();
    const provider: AutocompleteProvider = {
      getSuggestions: vi.fn(async () => ({
        items: [
          { value: 'help', label: 'help' },
          { value: 'hello', label: 'hello' },
        ],
        prefix: '/he',
      })),
      applyCompletion: vi.fn((lines, cursorLine, cursorCol) => ({
        lines,
        cursorLine,
        cursorCol,
      })),
    };
    editor.setAutocompleteProvider(provider);

    editor.setText('ship /he');
    editor.handleInput('\t');
    await flushAutocomplete();

    const after = editor.render(24).map(stripAnsi);
    const promptLine = after.find((line) => line.startsWith('❯ ship /he'));
    const selectedLine = after.find((line) => line.trimStart().startsWith('❯ help'));
    expect(after.join('\n')).toContain('ship /he');
    expect(after.join('\n')).toContain('lp');
    expect(promptLine).toBeDefined();
    expect(selectedLine).toBeDefined();
    expect(selectedLine?.indexOf('help')).toBe(promptLine?.indexOf('/he'));
    expect(Math.max(...after.map((line) => line.length))).toBe(24);
  });
});

describe('CustomEditor Kitty key release handling', () => {
  it('ignores Kitty key release events instead of inserting their CSI-u payload', () => {
    const editor = makeEditor();

    editor.handleInput('\u001B[47;1:3u');
    editor.handleInput('\u001B[110;1:3u');

    expect(editor.getText()).toBe('');
  });
});

describe('CustomEditor paste marker expansion', () => {
  const PASTE_START = '\x1b[200~';
  const PASTE_END = '\x1b[201~';

  function simulateLargePaste(editor: CustomEditor, content: string): void {
    editor.handleInput(`${PASTE_START}${content}${PASTE_END}`);
  }

  it('expands paste marker when bracketed paste arrives while cursor is on marker', () => {
    const editor = makeEditor();
    const longText = 'line\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, longText);

    expect(editor.getText()).toMatch(/\[paste #1 \+15 lines\]/);

    simulateLargePaste(editor, 'anything');

    expect(editor.getText()).not.toContain('[paste #');
    expect(editor.getText()).toContain(longText);
  });

  it('does not expand when cursor is not on a paste marker', () => {
    const editor = makeEditor();
    const longText = 'line\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, longText);

    editor.handleInput('hello');

    const textBefore = editor.getText();
    expect(textBefore).toContain('[paste #1');
    expect(textBefore).toContain('hello');

    const anotherLong = 'other\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, anotherLong);

    expect(editor.getText()).toContain('[paste #1');
    expect(editor.getText()).toContain('[paste #2');
  });

  it('expands only the marker under cursor when multiple markers exist', () => {
    const editor = makeEditor();
    const text1 = 'first\n'.repeat(15).trimEnd();
    const text2 = 'second\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, text1);
    editor.handleInput(' ');
    simulateLargePaste(editor, text2);

    expect(editor.getText()).toContain('[paste #1');
    expect(editor.getText()).toContain('[paste #2');

    // Cursor sits at the end of marker #2 after the second paste.
    simulateLargePaste(editor, 'anything');

    expect(editor.getText()).toContain('[paste #1');
    expect(editor.getText()).not.toContain('[paste #2');
    expect(editor.getText()).toContain(text2);
  });

  it('handles Ctrl+V expansion when cursor is on marker', () => {
    const editor = makeEditor();
    editor.onPasteImage = vi.fn(async () => false);
    const longText = 'line\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, longText);

    expect(editor.getText()).toMatch(/\[paste #1/);

    editor.handleInput('\x16');

    expect(editor.getText()).not.toContain('[paste #');
    expect(editor.getText()).toContain(longText);
  });

  it('falls back to text paste when the image paste handler rejects', async () => {
    const editor = makeEditor();
    const onTextPaste = vi.fn();
    editor.onTextPaste = onTextPaste;
    editor.onPasteImage = vi.fn(async () => {
      throw new Error('clipboard backend broken');
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      editor.handleInput(process.platform === 'win32' ? '\u001Bv' : '\u0016');
      await new Promise((resolve) => {
        setImmediate(resolve);
      });

      expect(onTextPaste).toHaveBeenCalledOnce();
      expect(rejections).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('keeps other markers expandable after one marker is expanded', () => {
    const editor = makeEditor();
    const text1 = 'first\n'.repeat(15).trimEnd();
    const text2 = 'second\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, text1);
    editor.handleInput(' ');
    simulateLargePaste(editor, text2);

    // Expand marker #2 (cursor sits at its end after the paste).
    simulateLargePaste(editor, 'anything');
    expect(editor.getText()).toContain(text2);
    expect(editor.getText()).toContain('[paste #1');

    // Move the cursor onto marker #1 and expand it too; its content must
    // have survived the setText() inside the first expansion.
    const state = (editor as unknown as { state: { cursorLine: number; cursorCol: number } })
      .state;
    state.cursorLine = 0;
    state.cursorCol = 0;
    simulateLargePaste(editor, 'anything');
    expect(editor.getText()).not.toContain('[paste #');
    expect(editor.getText()).toContain(text1);
  });

  it('suppresses multi-chunk bracketed paste data after marker expansion', () => {
    const editor = makeEditor();
    const longText = 'line\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, longText);

    editor.handleInput(`${PASTE_START}chunk1`);
    editor.handleInput(`chunk2${PASTE_END}`);

    expect(editor.getText()).not.toContain('chunk1');
    expect(editor.getText()).not.toContain('chunk2');
    expect(editor.getText()).toContain(longText);
  });

  it('handles paste-end sequence split across chunks', () => {
    const editor = makeEditor();
    const longText = 'line\n'.repeat(15).trimEnd();
    simulateLargePaste(editor, longText);

    // Split: PASTE_START in chunk 1, paste-end split across chunk 2 and 3
    editor.handleInput(`${PASTE_START}data`);
    editor.handleInput('\x1b[20');
    editor.handleInput('1~');

    expect(editor.getText()).toContain(longText);
    expect(editor.getText()).not.toContain('data');

    // Verify editor is not stuck — next keystrokes should work normally
    editor.handleInput('x');
    expect(editor.getText()).toContain('x');
  });
});

describe('CustomEditor shortcut telemetry hooks', () => {
  it('reports newline shortcuts, including Ctrl-J, before delegating to the base editor', () => {
    const editor = makeEditor();
    const onInsertNewline = vi.fn();
    editor.onInsertNewline = onInsertNewline;

    editor.handleInput('a');
    editor.handleInput('\n');
    editor.handleInput('\u001B[106;5u');

    expect(onInsertNewline).toHaveBeenCalledTimes(2);
    expect(editor.getText()).toBe('a\n\n');
  });

  it('reports undo shortcuts before delegating to the base editor', () => {
    const editor = makeEditor();
    const onUndo = vi.fn();
    editor.onUndo = onUndo;

    editor.handleInput('a');
    editor.handleInput('\u001F');

    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('routes Ctrl-T to onCycleEffort without inserting text', () => {
    const editor = makeEditor();
    const onCycleEffort = vi.fn();
    editor.onCycleEffort = onCycleEffort;

    editor.handleInput('\u0014');

    expect(onCycleEffort).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('forwards canonical Up and Down sequences to prompt history', () => {
    const editor = makeEditor();
    editor.addToHistory('older prompt');
    editor.addToHistory('newer prompt');

    editor.handleInput('\u001B[A');
    expect(editor.getText()).toBe('newer prompt');

    editor.handleInput('\u001B[B');
    expect(editor.getText()).toBe('');
  });

  it('routes configured Ctrl-R to prompt history search without inserting text', () => {
    const editor = makeEditor();
    const onSearchHistory = vi.fn();
    editor.onSearchHistory = onSearchHistory;
    editor.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Chat',
          bindings: { 'ctrl+r': 'chat:historySearch' },
        },
      ]),
    );

    editor.handleInput('\u0012');

    expect(onSearchHistory).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('routes configured Shift-Up to transcript message actions', () => {
    const editor = makeEditor();
    const onMessageActions = vi.fn();
    editor.onMessageActions = onMessageActions;
    editor.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Chat',
          bindings: { 'shift+up': 'chat:messageActions' },
        },
      ]),
    );

    editor.handleInput('\u001B[1;2A');

    expect(onMessageActions).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('routes configured shortcuts and chords through the existing callbacks', () => {
    const editor = makeEditor();
    const onCycleEffort = vi.fn();
    const onOpenExternalEditor = vi.fn();
    editor.onCycleEffort = onCycleEffort;
    editor.onOpenExternalEditor = onOpenExternalEditor;
    editor.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Chat',
          bindings: {
            'alt+t': 'chat:thinkingToggle',
            'ctrl+k ctrl+g': 'chat:externalEditor',
          },
        },
      ]),
    );

    editor.handleInput('\u001Bt');
    editor.handleInput('\u000B');
    editor.handleInput('\u0007');

    expect(onCycleEffort).toHaveBeenCalledOnce();
    expect(onOpenExternalEditor).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('routes command keybindings without inserting text', () => {
    const editor = makeEditor();
    const onCommand = vi.fn();
    editor.onCommand = onCommand;
    editor.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Chat',
          bindings: {
            'alt+h': 'command:help',
          },
        },
      ]),
    );

    editor.handleInput('\u001Bh');

    expect(onCommand).toHaveBeenCalledWith('help');
    expect(editor.getText()).toBe('');
  });

  it('routes source-compatible editor actions through native behavior', () => {
    const editor = makeEditor();
    const onEscape = vi.fn();
    const onRedraw = vi.fn();
    const onCommand = vi.fn();
    const onSubmit = vi.fn();
    editor.onEscape = onEscape;
    editor.onRedraw = onRedraw;
    editor.onCommand = onCommand;
    editor.onSubmit = onSubmit;
    editor.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Chat',
          bindings: {
            'alt+c': 'chat:cancel',
            'alt+l': 'app:redraw',
            'alt+p': 'chat:modelPicker',
            'alt+s': 'chat:submit',
          },
        },
      ]),
    );
    editor.setText('send this');

    editor.handleInput('\u001Bc');
    editor.handleInput('\u001Bl');
    editor.handleInput('\u001Bp');
    editor.handleInput('\u001Bs');

    expect(onEscape).toHaveBeenCalledOnce();
    expect(onRedraw).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith('model');
    expect(onSubmit).toHaveBeenCalledWith('send this');
  });
});

describe('CustomEditor rainbow frame', () => {
  it('colors the compact prompt glyph with the current rainbow frame color', () => {
    const previousLevel = chalk.level;
    const colors: RainbowColorController = {
      colored: true,
      phase: 0,
      start: () => {},
      stop: () => {},
      dispose: () => {},
    };
    chalk.level = 3;
    setRainbowColors(colors);

    try {
      const lines = makeEditor().render(20);
      const plainLines = lines.map(stripAnsi);

      expect(plainLines).toHaveLength(3);
      expect(plainLines[1]).toMatch(/^❯ /);
      expect(plainLines.join('')).not.toMatch(/[╭╮╰╯│]/u);
      // The painter advances per segment, so the rules consume frames before
      // the glyph; assert every compact row is painted rather than a fixed hue.
      expect(lines[0]).toMatch(/\[38;2;\d+;\d+;\d+m─/u);
      expect(lines[1]).toMatch(/\[38;2;\d+;\d+;\d+m❯\[39m/u);
      expect(lines[2]).toMatch(/\[38;2;\d+;\d+;\d+m─/u);
    } finally {
      setRainbowColors(undefined);
      chalk.level = previousLevel;
    }
  });
});

describe('CustomEditor Vim mode indicator', () => {
  it('shows each active Vim mode on the composer border', () => {
    const editor = makeEditor();
    editor.setVimMode(true);

    expect(stripAnsi(editor.render(40).at(-1) ?? '')).toContain(' NORMAL ');

    editor.handleInput('i');
    expect(stripAnsi(editor.render(40).at(-1) ?? '')).toContain(' INSERT ');

    editor.handleInput('\u001B');
    expect(stripAnsi(editor.render(40).at(-1) ?? '')).toContain(' NORMAL ');

    editor.handleInput('v');
    expect(stripAnsi(editor.render(40).at(-1) ?? '')).toContain(' VISUAL ');

    editor.setVimMode(false);
    expect(stripAnsi(editor.render(40).at(-1) ?? '')).not.toMatch(/ (?:NORMAL|INSERT|VISUAL) /u);
  });

  it('keeps the Vim mode inside the rounded multiline border', () => {
    const editor = makeEditor();
    editor.setVimMode(true);
    editor.setText('first line\nsecond line');

    expect(stripAnsi(editor.render(40).at(-1) ?? '')).toMatch(/^╰─ NORMAL ─+╯$/u);
  });
});

describe('CustomEditor compact composer', () => {
  it('renders a single-line value as one unboxed prompt row', () => {
    const editor = makeEditor();
    editor.setText('ship it');

    const lines = editor.render(40).map(stripAnsi);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^─+$/u);
    expect(lines[1]).toMatch(/^❯ ship it/);
    expect(lines[2]).toMatch(/^─+$/u);
    expect(lines.join('')).not.toMatch(/[╭╮╰╯│]/u);
  });

  it('keeps explicit multiline input inside the bordered editor', () => {
    const editor = makeEditor();
    editor.setText('first line\nsecond line');

    const lines = editor.render(40).map(stripAnsi);

    expect(lines[0]).toMatch(/^╭/u);
    expect(lines.at(-1)).toMatch(/╯$/u);
    expect(lines.join('\n')).toContain('second line');
  });
});
