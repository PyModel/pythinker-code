import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '#/tui/components/dialogs/custom-registry-import';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { darkColors } from '#/tui/theme/colors';

const ANSI = /\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const DOWN = `${ESC}[B`;
const UP = `${ESC}[A`;

function plain(component: CustomRegistryImportDialogComponent, width = 80): string {
  return component.render(width).map(strip).join('\n');
}

function makeDialog(defaultUrl = 'https://example.com/api.json'): {
  dialog: CustomRegistryImportDialogComponent;
  onDone: ReturnType<typeof vi.fn>;
} {
  const onDone = vi.fn();
  const dialog = new CustomRegistryImportDialogComponent(
    onDone as unknown as (r: CustomRegistryImportResult) => void,
    defaultUrl,
  );
  dialog.focused = true;
  return { dialog, onDone };
}

describe('CustomRegistryImportDialogComponent', () => {
  it('advances from the URL field to the token field on Enter instead of submitting', () => {
    const { dialog, onDone } = makeDialog();
    expect(plain(dialog)).toContain('next field');

    dialog.handleInput('\r');

    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Enter to submit');
  });

  it('switches fields with Up / Down arrows', () => {
    const { dialog } = makeDialog();
    dialog.handleInput(DOWN);
    expect(plain(dialog)).toContain('Enter to submit');
    dialog.handleInput(UP);
    expect(plain(dialog)).toContain('next field');
  });

  it('requires a non-empty Bearer token before submitting', () => {
    const { dialog, onDone } = makeDialog();
    dialog.handleInput('\r'); // url -> token
    dialog.handleInput('\r'); // attempt submit with an empty token
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(dialog)).toContain('Bearer token cannot be empty');
  });

  it('submits the url and token once both are provided', () => {
    const { dialog, onDone } = makeDialog();
    dialog.handleInput('\r'); // url -> token
    for (const ch of 'sk-tok') dialog.handleInput(ch);
    dialog.handleInput('\r'); // submit from the token field

    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: { url: 'https://example.com/api.json', apiKey: 'sk-tok' },
    });
  });

  it('uses remapped field focus without stealing token text', () => {
    const { dialog, onDone } = makeDialog();
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'alt+f': 'confirm:nextField',
            x: 'confirm:next',
          },
        },
      ]),
    );
    dialog.handleInput('\u001Bf');
    dialog.handleInput('x');
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: { url: 'https://example.com/api.json', apiKey: 'x' },
    });
  });

  it('recovers bare Escape after default cancel bindings are explicitly removed', () => {
    const { dialog, onDone } = makeDialog();
    dialog.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { n: null, escape: null } },
      ]),
    ]);
    dialog.handleInput(ESC);
    expect(onDone).toHaveBeenCalledWith({ kind: 'cancel' });
  });

  it('uses an alternate cancel binding in token input while bare Escape preserves the draft', () => {
    const bindings = parseKeybindingBlocks([
      {
        context: 'Confirmation',
        bindings: {
          'alt+f': 'confirm:nextField',
          'alt+x': 'confirm:no',
        },
      },
    ]);
    const preserved = makeDialog();
    preserved.dialog.setKeybindings(bindings);
    preserved.dialog.handleInput('\u001Bf');
    preserved.dialog.handleInput('d');
    preserved.dialog.handleInput(ESC);
    preserved.dialog.handleInput('\r');
    expect(preserved.onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: { url: 'https://example.com/api.json', apiKey: 'd' },
    });

    const cancelled = makeDialog();
    cancelled.dialog.setKeybindings(bindings);
    cancelled.dialog.handleInput('\u001Bf');
    cancelled.dialog.handleInput('d');
    cancelled.dialog.handleInput('\u001Bx');
    expect(cancelled.onDone).toHaveBeenCalledWith({ kind: 'cancel' });
  });

  it('executes multi-key field chords without losing resolver state', () => {
    const { dialog } = makeDialog();
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+k ctrl+n': 'confirm:nextField',
            'ctrl+k ctrl+p': 'confirm:previousField',
          },
        },
      ]),
    );
    dialog.handleInput('\u000B');
    dialog.handleInput('\u000E');
    expect(plain(dialog)).toContain('Enter to submit');
    dialog.handleInput('\u000B');
    dialog.handleInput('\u0010');
    expect(plain(dialog)).toContain('next field');
  });

  it('executes semantic field key IDs', () => {
    const { dialog } = makeDialog();
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'alt+f': 'confirm:nextField',
            'alt+b': 'confirm:previousField',
          },
        },
      ]),
    );
    dialog.handleInput('alt+f');
    expect(plain(dialog)).toContain('Enter to submit');
    dialog.handleInput('alt+b');
    expect(plain(dialog)).toContain('next field');
  });

  it('executes semantic two-key field chords', () => {
    const { dialog } = makeDialog();
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+k ctrl+n': 'confirm:nextField',
            'ctrl+k ctrl+p': 'confirm:previousField',
          },
        },
      ]),
    );
    dialog.handleInput('ctrl+k');
    dialog.handleInput('ctrl+n');
    expect(plain(dialog)).toContain('Enter to submit');
    dialog.handleInput('ctrl+k');
    dialog.handleInput('ctrl+p');
    expect(plain(dialog)).toContain('next field');
  });

  it('keeps unavailable printable chords intact in the active field', () => {
    const { dialog, onDone } = makeDialog('');
    dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { 'x y': 'confirm:next' } },
      ]),
    );
    dialog.handleInput('x');
    dialog.handleInput('y');
    dialog.handleInput('\r');
    dialog.handleInput('z');
    dialog.handleInput('\r');
    expect(onDone).toHaveBeenCalledWith({
      kind: 'ok',
      value: { url: 'xy', apiKey: 'z' },
    });
  });

  it('keeps every line within narrow widths', () => {
    const { dialog } = makeDialog('https://example.com/very/long/registry/path.json');

    for (const width of [39, 35, 20, 10]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
