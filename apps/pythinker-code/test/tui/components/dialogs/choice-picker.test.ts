import { Key } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { ChoicePickerComponent } from '#/tui/components/dialogs/choice-picker';
import { EditorSelectorComponent } from '#/tui/components/dialogs/editor-selector';
import { PermissionSelectorComponent } from '#/tui/components/dialogs/permission-selector';
import { SettingsSelectorComponent } from '#/tui/components/dialogs/settings-selector';
import { ThemeSelectorComponent } from '#/tui/components/dialogs/theme-selector';
import { UpdatePreferenceSelectorComponent } from '#/tui/components/dialogs/update-preference-selector';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { darkColors } from '#/tui/theme/colors';

const ANSI_SGR = /\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

describe('ChoicePickerComponent', () => {
  it('keeps configured Select hints authoritative over caller hints', () => {
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      hint: '↑↓ navigate · Enter select · Esc cancel',
      options: [
        { value: 'first', label: 'First' },
        { value: 'second', label: 'Second' },
      ],
      secondaryAction: {
        key: 'w',
        label: 'write to file',
        onSelect: vi.fn(),
      },
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    picker.setKeybindings(
      [
        ...defaultKeybindings(),
        ...parseKeybindingBlocks([
          { context: 'Select', bindings: { up: null, 'alt+k': 'select:previous' } },
        ]),
      ],
    );

    picker.handleInput(Key.down);
    picker.handleInput(Key.up);
    const afterOldKey = strip(picker.render(80).join('\n'));
    expect(afterOldKey).toContain('❯ Second');
    expect(afterOldKey).not.toContain('↑');
    picker.handleInput('\u001Bk');
    const output = strip(picker.render(160).join('\n'));
    expect(output).toContain('❯ First');
    expect(output).toContain('alt+k');
    expect(output).toContain('W write to file');
  });

  it('uses the model-dialog header vocabulary (capitalized keys, "type to search")', () => {
    const picker = new ChoicePickerComponent({
      title: 'Add provider',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const lines = picker.render(120).map(strip);

    const titleIdx = lines.findIndex((l) => l.includes('Add provider'));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    // Title carries the same "(type to search)" suffix as /model and /provider.
    expect(lines[titleIdx]).toContain('(type to search)');
    expect(lines[titleIdx]).not.toContain('type to filter');
    // Hint sits directly under the title and uses lowercase key vocabulary.
    const hint = lines[titleIdx + 1];
    expect(hint).toContain('↑↓ navigate');
    expect(hint).toContain('Enter select');
    expect(hint).toContain('Esc cancel');
    expect(hint).not.toContain('enter select');
    expect(hint).not.toContain('esc cancel');
    // Blank line separates the hint from the body, like the model dialog.
    expect(lines[titleIdx + 2]).toBe('');
  });

  it('renders optional descriptions below choice labels', () => {
    const picker = new ChoicePickerComponent({
      title: 'Select permission mode',
      options: [
        {
          value: 'manual',
          label: 'Manual',
          description: 'Ask before commands, edits, and other risky actions.',
        },
        {
          value: 'auto',
          label: 'Auto',
          description: 'Automatically approve tool actions and plan transitions.',
        },
      ],
      currentValue: 'manual',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip);

    expect(out).toContain('  ❯ Manual ← current');
    expect(out).toContain('    Ask before commands, edits, and other risky actions.');
    expect(out).toContain('    Automatically approve tool actions and plan transitions.');
  });

  it('renders domain selector wrappers with their configured options', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    const editor = new EditorSelectorComponent({
      currentValue: 'vim',
      onSelect,
      onCancel,
    });
    expect(editor.render(120).map(strip)).toContain('  ❯ Vim ← current');

    const theme = new ThemeSelectorComponent({
      currentValue: 'light',
      onSelect,
      onCancel,
    });
    expect(theme.render(120).map(strip)).toContain('  ❯ Light ← current');

    const permission = new PermissionSelectorComponent({
      currentValue: 'manual',
      onSelect,
      onCancel,
    });
    expect(permission.render(120).map(strip)).toContain('  ❯ Manual ← current');

    const settings = new SettingsSelectorComponent({
      onSelect,
      onCancel,
    });
    const settingsOutput = settings.render(120).map(strip);
    expect(settingsOutput).toContain('  ❯ Model');
    expect(settingsOutput).toContain('    Switch the active model and thinking mode.');
    expect(settingsOutput).toContain('    Choose how Pythinker formats responses.');
    expect(settingsOutput).toContain('    Choose whether /copy always uses the full response.');
    expect(settingsOutput).toContain('    Turn automatic CLI updates on or off.');

    const upgradePreference = new UpdatePreferenceSelectorComponent({
      currentValue: true,
      onSelect,
      onCancel,
    });
    const upgradePreferenceOutput = upgradePreference.render(120).map(strip);
    expect(upgradePreferenceOutput).toContain('  ❯ On ← current');
    expect(upgradePreferenceOutput).toContain(
      '    Update automatically in the background.',
    );
  });

  it('routes Space into the query for searchable lists instead of selecting', () => {
    const onSelect = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Select a provider',
      options: [
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure', label: 'Azure OpenAI' },
      ],
      searchable: true,
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects on Space when the list is not searchable', () => {
    const onSelect = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Pick one',
      options: [{ value: 'a', label: 'Alpha' }],
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('routes an optional secondary action to the focused choice', () => {
    const onSecondary = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Copy response',
      options: [
        { value: 'full', label: 'Full response' },
        { value: 'block:0', label: 'Code block' },
      ],
      secondaryAction: {
        key: 'w',
        label: 'write to file',
        onSelect: onSecondary,
      },
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(picker.render(100).map(strip).join('\n')).toContain('W write to file');
    picker.handleInput('w');
    expect(onSecondary).toHaveBeenCalledWith('full');
  });
});
