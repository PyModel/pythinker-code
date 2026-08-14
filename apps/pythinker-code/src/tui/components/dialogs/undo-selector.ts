import {
  Container,
  Key,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import type { PartialCompactionDirection } from '@pymodel/pythinker-code-sdk';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';

const MAX_VISIBLE_CHOICES = 5;
const PREFERRED_SELECTED_OFFSET = 2;

export interface UndoChoice {
  readonly id: string;
  readonly count?: number;
  readonly input: string;
  readonly label: string;
}

export interface UndoSelectorOptions {
  readonly choices: readonly UndoChoice[];
  readonly onSelect: (choice: UndoChoice) => void;
  readonly onSummarize: (
    choice: UndoChoice,
    direction: PartialCompactionDirection,
  ) => void;
  readonly onCancel: () => void;
}

export class UndoSelectorComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: UndoSelectorOptions;
  private readonly list: SearchableList<UndoChoice>;
  private submitted = false;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver([]);

  constructor(opts: UndoSelectorOptions) {
    super();
    this.opts = opts;
    this.list = new SearchableList({
      items: opts.choices,
      toSearchText: (choice) => choice.label,
      initialIndex: Math.max(0, opts.choices.length - 1),
    });
    this.setKeybindings(this.bindings);
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    const winners = new Map<string, ParsedKeybinding>();
    for (const binding of bindings) {
      winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
    }
    const actions = new Set([
      'messageSelector:up',
      'messageSelector:down',
      'messageSelector:top',
      'messageSelector:bottom',
      'messageSelector:select',
      'confirm:no',
    ]);
    this.keybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) => binding.action !== null && actions.has(binding.action),
      ),
    );
  }

  handleInput(data: string): void {
    if (this.submitted) return;

    const handlers: KeybindingHandlers = {
      'messageSelector:up': () => this.list.moveUp(),
      'messageSelector:down': () => this.list.moveDown(),
      'messageSelector:top': () => this.list.moveToStart(),
      'messageSelector:bottom': () => this.list.moveToEnd(),
      'messageSelector:select': () => this.select(),
      'confirm:no': () => this.opts.onCancel(),
    };
    const keyId = parseKey(data);
    if (
      keyId?.includes('+') === true
        ? this.keybindings.dispatch(data, ['MessageSelector', 'Confirmation'], handlers)
        : this.keybindings.dispatchKeyId(keyId ?? data, ['MessageSelector', 'Confirmation'], handlers)
    ) {
      return;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.list.pageDown();
      return;
    }

    const action = printableChar(data)?.toLowerCase();
    if (action === 's' || action === 'u') {
      const selected = this.list.selected();
      if (selected?.count !== undefined) {
        this.submitted = true;
        this.opts.onSummarize(selected, action === 's' ? 'from' : 'up_to');
      }
      return;
    }

  }

  override render(width: number): string[] {
    const view = this.list.view();
    const canSummarize = this.list.selected()?.count !== undefined;
    const hintParts = [
      messageSelectorNavigationHint(this.bindings),
      ...(canSummarize
        ? ['S summarize from', 'U summarize up to']
        : ['S/U unavailable for code-only point']),
      bindingHint(this.bindings, 'MessageSelector', 'messageSelector:select', 'undo'),
      bindingHint(this.bindings, 'Confirmation', 'confirm:no', 'cancel'),
    ].filter((part): part is string => part !== undefined);

    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Select a conversation point'),
      currentTheme.fg('textMuted', ' ' + hintParts.join(' · ')),
      '',
    ];

    if (view.items.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No messages'));
    } else {
      const visibleCount = Math.min(MAX_VISIBLE_CHOICES, view.items.length);
      const maxStart = view.items.length - visibleCount;
      const start = Math.min(
        Math.max(0, view.selectedIndex - PREFERRED_SELECTED_OFFSET),
        maxStart,
      );
      const end = start + visibleCount;

      for (let i = start; i < end; i++) {
        const choice = view.items[i];
        if (choice === undefined) continue;
        lines.push(
          this.renderChoiceLine(choice, i === view.selectedIndex, i > view.selectedIndex, width),
        );
      }
    }

    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private renderChoiceLine(
    choice: UndoChoice,
    isSelected: boolean,
    inUndoRange: boolean,
    width: number,
  ): string {
    const pointer = isSelected ? SELECT_POINTER : ' ';
    const prefix = `  ${pointer} `;
    const labelBudget = Math.max(8, width - visibleWidth(prefix));
    const label = truncateToWidth(choice.label, labelBudget, '…');
    const token = isSelected ? 'primary' : inUndoRange ? 'textDim' : 'text';
    let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', prefix);
    line += isSelected
      ? currentTheme.boldFg(token, label)
      : currentTheme.fg(token, label);
    return line;
  }

  private select(): void {
    const selected = this.list.selected();
    if (selected !== undefined) {
      this.submitted = true;
      this.opts.onSelect(selected);
    }
  }
}

function bindingHint(
  bindings: readonly ParsedKeybinding[],
  context: 'MessageSelector' | 'Confirmation',
  action: 'messageSelector:select' | 'confirm:no',
  label: string,
): string | undefined {
  const keys = keybindingDisplayText(bindings, context, action);
  return keys === undefined ? undefined : `${keys} ${label}`;
}

function messageSelectorNavigationHint(bindings: readonly ParsedKeybinding[]): string | undefined {
  const up = keybindingDisplayText(bindings, 'MessageSelector', 'messageSelector:up');
  const down = keybindingDisplayText(bindings, 'MessageSelector', 'messageSelector:down');
  if (up === undefined && down === undefined) return undefined;
  return `${[up, down].filter((key): key is string => key !== undefined).join(' / ')} navigate`;
}
