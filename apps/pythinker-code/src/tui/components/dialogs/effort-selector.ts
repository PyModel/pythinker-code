/**
 * EffortSelector — small list dialog for picking the thinking effort level of
 * the current model (mounted by `/effort` with no argument). Follows the
 * standard list-dialog layout in .agents/skills/write-tui/DESIGN.md.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '@earendil-works/pi-tui';

import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import { combinedBindingHint, formatBindingKeys } from '#/tui/components/dialogs/choice-picker';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';
import { SearchableList } from '#/tui/utils/searchable-list';

export interface EffortSelectorOptions {
  /** Selectable effort levels for the current model, in order. */
  readonly levels: readonly string[];
  /** Effort level currently in effect (gets the trailing current marker). */
  readonly currentValue: string;
  /** Current model display name, shown as the title suffix. */
  readonly modelName: string;
  readonly onSelect: (effort: string) => void;
  readonly onCancel: () => void;
}

export class EffortSelectorComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: EffortSelectorOptions;
  private readonly list: SearchableList<string>;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver(this.bindings);

  constructor(opts: EffortSelectorOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.levels.indexOf(opts.currentValue);
    this.list = new SearchableList({
      items: opts.levels,
      toSearchText: (level) => level,
      initialIndex: Math.max(currentIdx, 0),
      searchable: false,
    });
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    this.keybindings = new KeybindingResolver(bindings);
  }

  handleInput(data: string): void {
    const handlers = {
      'select:previous': () => this.list.moveUp(),
      'select:next': () => this.list.moveDown(),
      'select:accept': () => {
        const selected = this.list.selected();
        if (selected !== undefined) this.opts.onSelect(selected);
      },
      'select:cancel': () => this.opts.onCancel(),
    } as const;
    if (
      this.keybindings.dispatch(data, ['Select'], handlers) ||
      this.keybindings.dispatchKeyId(data, ['Select'], handlers)
    ) return;
    if (matchesKey(data, Key.pageUp)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.list.pageDown();
    }
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Thinking effort') +
        currentTheme.fg('textMuted', `  ${this.opts.modelName}`),
      currentTheme.fg('textMuted', ` ${this.bindingHints().join(' · ')}`),
      '',
    ];

    for (let i = view.page.start; i < view.page.end; i++) {
      const level = view.items[i];
      if (level === undefined) continue;
      const isSelected = i === view.selectedIndex;
      const isCurrent = level === this.opts.currentValue;
      const pointer = isSelected ? SELECT_POINTER : ' ';
      let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      line += isSelected ? currentTheme.boldFg('primary', level) : currentTheme.fg('text', level);
      if (isCurrent) {
        line += ' ' + currentTheme.fg('success', CURRENT_MARK);
      }
      lines.push(line);
    }

    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private bindingHints(): string[] {
    const navigation = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Select', 'select:previous'),
      keybindingDisplayText(this.bindings, 'Select', 'select:next'),
      'navigate',
    );
    const accept = keybindingDisplayText(this.bindings, 'Select', 'select:accept');
    const cancel = keybindingDisplayText(this.bindings, 'Select', 'select:cancel');
    return [
      navigation,
      accept === undefined ? undefined : `${formatBindingKeys(accept)} select`,
      cancel === undefined ? undefined : `${formatBindingKeys(cancel)} cancel`,
    ].filter((hint): hint is string => hint !== undefined);
  }
}
