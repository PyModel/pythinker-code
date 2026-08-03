import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';

import { ApiKeyInputDialogComponent } from '#/tui/components/dialogs/api-key-input-dialog';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';

describe('ApiKeyInputDialogComponent', () => {
  it('keeps every line within narrow widths', () => {
    const dialog = new ApiKeyInputDialogComponent(
      'Pythinker Code',
      ['Paste your API key below.', 'It will be stored locally.'],
      () => {},
    );
    dialog.focused = true;

    for (const width of [39, 20, 10]) {
      for (const line of dialog.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('lets API key text own printable confirmation bindings and recovers Escape', () => {
    const results: unknown[] = [];
    const dialog = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => results.push(result));
    dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { x: 'confirm:next' } },
      ]),
    );
    dialog.handleInput('x');
    dialog.handleInput('\r');
    expect(results).toEqual([{ kind: 'ok', value: 'x' }]);

    const cancelled: unknown[] = [];
    const recovery = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => cancelled.push(result));
    recovery.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { n: null, escape: null } },
      ]),
    ]);
    recovery.handleInput('\u001B');
    expect(cancelled).toEqual([{ kind: 'cancel' }]);
  });

  it('treats printable default cancel keys as text', () => {
    const results: unknown[] = [];
    const dialog = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => results.push(result));
    for (const char of 'anthropic/plugin.json') dialog.handleInput(char);

    expect(dialog.render(120).join('\n')).not.toContain('n / Esc');
    dialog.handleInput('\r');

    expect(results).toEqual([{ kind: 'ok', value: 'anthropic/plugin.json' }]);
  });

  it('uses an alternate cancel binding while bare Escape preserves API key input', () => {
    const bindings = parseKeybindingBlocks([
      { context: 'Confirmation', bindings: { 'alt+x': 'confirm:no' } },
    ]);
    const preserved: unknown[] = [];
    const input = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => preserved.push(result));
    input.setKeybindings(bindings);
    input.handleInput('d');
    input.handleInput('\u001B');
    input.handleInput('\r');
    expect(preserved).toEqual([{ kind: 'ok', value: 'd' }]);

    const cancelled: unknown[] = [];
    const cancelInput = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => cancelled.push(result));
    cancelInput.setKeybindings(bindings);
    cancelInput.handleInput('d');
    cancelInput.handleInput('\u001Bx');
    expect(cancelled).toEqual([{ kind: 'cancel' }]);
  });

  it('executes a semantic two-key cancel chord', () => {
    const results: unknown[] = [];
    const dialog = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => results.push(result));
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'ctrl+k ctrl+x': 'confirm:no' },
        },
      ]),
    );
    dialog.handleInput('d');
    dialog.handleInput('ctrl+k');
    dialog.handleInput('ctrl+x');
    expect(results).toEqual([{ kind: 'cancel' }]);
  });

  it('keeps unavailable printable chords intact in API key input', () => {
    const results: unknown[] = [];
    const dialog = new ApiKeyInputDialogComponent('Pythinker Code', [], (result) => results.push(result));
    dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { 'x y': 'confirm:next' } },
      ]),
    );
    dialog.handleInput('x');
    dialog.handleInput('y');
    dialog.handleInput('\r');
    expect(results).toEqual([{ kind: 'ok', value: 'xy' }]);
  });
});
