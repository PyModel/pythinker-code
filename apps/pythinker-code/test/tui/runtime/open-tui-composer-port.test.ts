import { describe, expect, it } from 'vitest';

import {
  KeybindingResolver,
  parseKeybindingBlocks,
} from '#/tui/keybindings';
import {
  OpenTuiComposerPort,
  openTuiKeyId,
  type ComposerIntent,
  type ComposerKey,
} from '#/tui/runtime/footer/open-tui-composer-port';
import { renderComposerRow } from '../../../src/tui/runtime/footer/composer';

function kinds(intents: readonly ComposerIntent[]): readonly string[] {
  return intents.map((intent) => intent.kind);
}

function press(
  port: OpenTuiComposerPort,
  key: string,
  modifiers: Omit<ComposerKey, 'key'> = {},
): readonly ComposerIntent[] {
  return port.handleKey({ key, ...modifiers });
}

describe('OpenTuiComposerPort', () => {
  it('normalizes OpenTUI keys and matches pi-tui configured actions', () => {
    expect([
      openTuiKeyId({ key: 'a' }),
      openTuiKeyId({ key: 's', ctrl: true }),
      openTuiKeyId({ key: 'p', alt: true }),
      openTuiKeyId({ key: 'tab', shift: true }),
      openTuiKeyId({ key: 'w', super: true }),
      openTuiKeyId({
        key: 'return',
        ctrl: true,
        alt: true,
        shift: true,
        super: true,
      }),
    ]).toEqual([
      'a',
      'ctrl+s',
      'alt+p',
      'shift+tab',
      'super+w',
      'ctrl+alt+shift+super+enter',
    ]);

    const bindings = parseKeybindingBlocks([
      {
        context: 'Chat',
        bindings: {
          x: 'chat:cycleMode',
          'ctrl+k': 'chat:cycleMode',
          'alt+m': 'chat:cycleMode',
          'shift+tab': 'chat:cycleMode',
          'super+w': 'chat:cycleMode',
          enter: 'chat:cycleMode',
        },
      },
    ]);
    const cases: readonly [string, string, ComposerKey][] = [
      ['x', 'x', { key: 'x' }],
      ['ctrl+k', '\x0B', { key: 'k', ctrl: true }],
      ['alt+m', '\u001Bm', { key: 'm', alt: true }],
      ['shift+tab', '\u001B[Z', { key: 'tab', shift: true }],
      ['super+w', '\u001B[119;9u', { key: 'w', super: true }],
      ['enter', '\r', { key: 'return' }],
    ];

    for (const [keyId, rawInput, openTuiKey] of cases) {
      const piResolver = new KeybindingResolver(bindings);
      const piActions: string[] = [];
      expect(
        piResolver.dispatch(rawInput, ['Chat'], {
          'chat:cycleMode': () => {
            piActions.push(keyId);
          },
        }),
      ).toBe(true);

      const port = new OpenTuiComposerPort({ bindings });
      expect(port.handleKey(openTuiKey)).toEqual([{ kind: 'toggle-plan-mode' }]);
      expect(piActions).toEqual([keyId]);
    }

    const port = new OpenTuiComposerPort();
    expect(kinds(press(port, 'x'))).toEqual(['changed', 'autocomplete']);
    expect(port.getText()).toBe('x');
  });

  it('submits canonical OpenTUI return and ignores unbound Super keys', () => {
    const port = new OpenTuiComposerPort({ text: 'hello' });

    expect(press(port, 'return')).toEqual([
      { kind: 'submit', text: 'hello' },
      { kind: 'changed', text: '' },
      { kind: 'autocomplete', prefix: null },
    ]);
    expect(port.getText()).toBe('');
    expect(press(port, 'q', { super: true })).toEqual([]);
    expect(port.getText()).toBe('');
  });

  it('consumes an explicit null binding without editing text', () => {
    const port = new OpenTuiComposerPort({
      bindings: parseKeybindingBlocks([
        { context: 'Chat', bindings: { q: null } },
      ]),
    });

    expect(press(port, 'q')).toEqual([]);
    expect(port.getText()).toBe('');
  });

  it('falls back to editing for an unsupported Chat action chord', () => {
    const port = new OpenTuiComposerPort({
      bindings: parseKeybindingBlocks([
        { context: 'Chat', bindings: { 'x y': 'chat:modelPicker' } },
      ]),
    });

    expect(kinds(press(port, 'x'))).toEqual(['changed', 'autocomplete']);
    expect(port.getText()).toBe('x');
    expect(kinds(press(port, 'y'))).toEqual(['changed', 'autocomplete']);
    expect(port.getText()).toBe('xy');
  });

  it('submits non-empty text, clears it, and ignores empty submits', () => {
    const port = new OpenTuiComposerPort({ text: 'hello' });

    expect(press(port, 'enter')).toEqual([
      { kind: 'submit', text: 'hello' },
      { kind: 'changed', text: '' },
      { kind: 'autocomplete', prefix: null },
    ]);
    expect(port.getText()).toBe('');
    expect(press(port, 'enter')).toEqual([]);
  });

  it('inserts newlines for Shift+Enter and backslash-Enter', () => {
    const shifted = new OpenTuiComposerPort({ text: 'one' });
    const escaped = new OpenTuiComposerPort({ text: 'one\\' });

    expect(kinds(press(shifted, 'enter', { shift: true }))).toEqual([
      'changed',
      'autocomplete',
    ]);
    expect(shifted.getText()).toBe('one\n');
    expect(kinds(press(escaped, 'enter'))).toEqual([
      'changed',
      'autocomplete',
    ]);
    expect(escaped.getText()).toBe('one\n');
  });

  it('uses double-tap exit intents and only Ctrl+C clears text', () => {
    const port = new OpenTuiComposerPort({ text: 'draft' });

    expect(press(port, 'c', { ctrl: true })).toEqual([
      { kind: 'changed', text: '' },
      { kind: 'autocomplete', prefix: null },
      { kind: 'exit-intent', source: 'ctrl-c' },
    ]);
    expect(port.pendingExit).toBe('ctrl-c');
    expect(press(port, 'c', { ctrl: true })).toEqual([
      { kind: 'exit-intent', source: 'ctrl-c' },
    ]);

    port.setText('preserved');
    expect(press(port, 'd', { ctrl: true })).toEqual([
      { kind: 'exit-intent', source: 'ctrl-d' },
    ]);
    expect(port.getText()).toBe('preserved');
    expect(press(port, 'd', { ctrl: true })).toEqual([
      { kind: 'exit-intent', source: 'ctrl-d' },
    ]);
  });

  it('clears pending exit on other keys and emits command intents', () => {
    const cases: readonly [
      ComposerKey,
      ComposerIntent,
    ][] = [
      [{ key: 'escape' }, { kind: 'cancel' }],
      [{ key: 's', ctrl: true }, { kind: 'steer' }],
      [{ key: 'tab', shift: true }, { kind: 'toggle-plan-mode' }],
      [{ key: 'o', ctrl: true }, { kind: 'toggle-expansion' }],
      [
        { key: 'g', ctrl: true },
        { kind: 'open-external-editor', text: 'draft' },
      ],
    ];

    for (const [key, expected] of cases) {
      const port = new OpenTuiComposerPort({ text: 'draft' });
      press(port, 'd', { ctrl: true });
      expect(port.handleKey(key)).toEqual([expected]);
      expect(port.pendingExit).toBeNull();
    }
  });

  it('navigates history up and down through the state engine', () => {
    const port = new OpenTuiComposerPort();
    port.addToHistory('first');
    port.addToHistory('second');

    expect(press(port, 'up')[0]).toEqual({
      kind: 'changed',
      text: 'second',
    });
    expect(press(port, 'up')[0]).toEqual({
      kind: 'changed',
      text: 'first',
    });
    expect(press(port, 'down')[0]).toEqual({
      kind: 'changed',
      text: 'second',
    });
    expect(press(port, 'down')[0]).toEqual({
      kind: 'changed',
      text: '',
    });
  });

  it('moves the cursor and deletes graphemes or words', () => {
    const port = new OpenTuiComposerPort({ text: 'one two' });

    expect(press(port, 'left')).toEqual([]);
    expect(port.getViewState().cursorCol).toBe(6);
    expect(press(port, 'left', { ctrl: true })).toEqual([]);
    expect(port.getViewState().cursorCol).toBe(4);
    expect(kinds(press(port, 'delete', { alt: true }))).toEqual([
      'changed',
      'autocomplete',
    ]);
    expect(port.getText()).toBe('one ');
    press(port, 'end');
    expect(kinds(press(port, 'backspace', { ctrl: true }))).toEqual([
      'changed',
      'autocomplete',
    ]);
    expect(port.getText()).toBe('one');

    port.setText('ab');
    press(port, 'home');
    expect(kinds(press(port, 'delete'))).toEqual([
      'changed',
      'autocomplete',
    ]);
    press(port, 'end');
    expect(kinds(press(port, 'backspace'))).toEqual([
      'changed',
      'autocomplete',
    ]);
    expect(port.getText()).toBe('');
  });

  it('supports text boundaries and Alt+Right movement', () => {
    const port = new OpenTuiComposerPort({ text: 'one two\nthree' });

    press(port, 'home', { ctrl: true });
    expect(port.getViewState()).toMatchObject({ cursorLine: 0, cursorCol: 0 });
    press(port, 'right');
    expect(port.getViewState().cursorCol).toBe(1);
    press(port, 'left');
    expect(port.getViewState().cursorCol).toBe(0);
    press(port, 'right', { alt: true });
    expect(port.getViewState().cursorCol).toBe(3);
    press(port, 'right', { ctrl: true });
    expect(port.getViewState().cursorCol).toBe(4);
    press(port, 'left', { alt: true });
    expect(port.getViewState().cursorCol).toBe(3);
    press(port, 'left', { ctrl: true });
    expect(port.getViewState().cursorCol).toBe(0);
    press(port, 'end', { ctrl: true });
    expect(port.getViewState()).toMatchObject({ cursorLine: 1, cursorCol: 5 });
    press(port, 'home');
    expect(port.getViewState().cursorCol).toBe(0);
  });

  it('inserts printable keys and emits autocomplete prefixes', () => {
    const port = new OpenTuiComposerPort();

    press(port, '/');
    const intents = press(port, 'h');

    expect(intents).toEqual([
      { kind: 'changed', text: '/h' },
      {
        kind: 'autocomplete',
        prefix: { kind: 'slash', query: 'h', start: 0 },
      },
    ]);
  });

  it('tracks focus and exposes a renderer-neutral view', () => {
    const port = new OpenTuiComposerPort({
      marker: '>',
      placeholder: 'Prompt',
    });

    expect(port.isFocused()).toBe(false);
    port.focus();
    expect(port.isFocused()).toBe(true);
    port.blur();
    expect(port.isFocused()).toBe(false);
    expect(port.getViewState()).toMatchObject({
      marker: '>',
      text: '',
      placeholder: 'Prompt',
      cursorLine: 0,
      cursorCol: 0,
      isEmpty: true,
    });
  });
});

describe('renderComposerRow', () => {
  const view = {
    marker: '>',
    text: 'long composer text',
    placeholder: 'Prompt',
    cursorLine: 0,
    cursorCol: 18,
    isEmpty: false,
  };

  it('renders exactly one row', () => {
    expect(renderComposerRow(view, 80)).toBe('> long composer text');
    expect(renderComposerRow(view, 80)).not.toMatch(/[\r\n]/u);
  });

  it('truncates to the supplied width', () => {
    const row = renderComposerRow(view, 8);

    expect(row).toBe('> long …');
    expect(Array.from(row)).toHaveLength(8);
  });
});
