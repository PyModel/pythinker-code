import type { TuiMode } from '../../config';
import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

const TUI_MODE_OPTIONS: readonly ChoiceOption[] = [
  {
    value: 'fullscreen',
    label: 'Fullscreen',
    description: 'Prompt fixed at the bottom; in-app scrolling, selection, and transcript search.',
  },
  {
    value: 'regular',
    label: 'Regular',
    description: 'Render into the terminal\'s native scrollback.',
  },
];

export interface TuiModeSelectorOptions {
  readonly currentValue: TuiMode;
  readonly onSelect: (value: TuiMode) => void;
  readonly onCancel: () => void;
}

export class TuiModeSelectorComponent extends ChoicePickerComponent {
  constructor(opts: TuiModeSelectorOptions) {
    super({
      title: 'TUI mode',
      options: [...TUI_MODE_OPTIONS],
      currentValue: opts.currentValue,
      onSelect: (value) => {
        if (value === 'regular' || value === 'fullscreen') opts.onSelect(value);
      },
      onCancel: opts.onCancel,
    });
  }
}
