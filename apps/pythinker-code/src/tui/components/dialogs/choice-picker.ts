/**
 * ChoicePicker — modal single-select list for slash commands that ask
 * the user to pick from a small set of preset values.
 *
 * Mirrors SessionPickerComponent's container-replacement pattern: host
 * calls `showChoicePicker(...)` which clears the editor container,
 * addChild(picker), setFocus(picker); the picker invokes `onSelect` or
 * `onCancel`, and the host tears it down.
 */

import {
  Container,
  matchesKey,
  Key,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingContext,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme, type ColorToken } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';

export interface ChoiceOption {
  /** Value passed to onSelect (e.g. the actual editor command string). */
  readonly value: string;
  /** Display text shown in the list. */
  readonly label: string;
  /** Optional semantic tone for labels that need stronger visual treatment. */
  readonly tone?: 'danger';
  /** Optional explanatory text shown below the label. */
  readonly description?: string | undefined;
}

export interface ChoicePickerOptions {
  readonly title: string;
  readonly hint?: string;
  readonly formatHint?: (text: string) => string;
  readonly notice?: string;
  readonly noticeTone?: ColorToken;
  readonly options: readonly ChoiceOption[];
  readonly currentValue?: string;
  /** When true, typed characters filter the list (fuzzy) and a search line is shown. */
  readonly searchable?: boolean;
  /** Items per page. Lists longer than this paginate. */
  readonly pageSize?: number;
  readonly keybindingContext?: 'Select' | 'HistorySearch' | 'MessageActions';
  readonly onExecute?: (value: string) => void;
  readonly isUserOption?: (option: ChoiceOption) => boolean;
  readonly onCopy?: (value: string) => void;
  readonly onPrimaryInput?: (value: string) => void;
  readonly secondaryAction?: {
    readonly key: string;
    readonly label: string;
    readonly onSelect: (value: string) => void;
  };
  readonly onSelect: (value: string) => void;
  readonly onCancel: () => void;
}

function wrapDescription(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, '…');
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

export class ChoicePickerComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ChoicePickerOptions;
  private readonly list: SearchableList<ChoiceOption>;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver([]);

  constructor(opts: ChoicePickerOptions) {
    super();
    this.opts = opts;
    const currentIdx = opts.options.findIndex((o) => o.value === opts.currentValue);
    this.list = new SearchableList({
      items: opts.options,
      toSearchText: (o) => `${o.label} ${o.description ?? ''}`,
      pageSize: opts.pageSize,
      initialIndex: Math.max(currentIdx, 0),
      searchable: opts.searchable === true,
    });
    this.setKeybindings(this.bindings);
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    const context = this.opts.keybindingContext ?? 'Select';
    const actions = new Set(Object.keys(this.handlers(context)));
    const winners = new Map<string, ParsedKeybinding>();
    for (const binding of bindings) {
      winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
    }
    this.keybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) =>
          binding.action === null
            ? binding.context === context &&
              binding.chord.length === 1 &&
              (binding.chord[0] === 'enter' ||
                (binding.chord[0] === 'space' &&
                  context !== 'MessageActions' &&
                  this.opts.searchable !== true))
            : actions.has(binding.action),
      ),
    );
  }

  handleInput(data: string): void {
    const context = this.opts.keybindingContext ?? 'Select';
    const handlers = this.handlers(context);
    const keyId = parseKey(data);
    if (
      keyId?.includes('+') === true
        ? this.keybindings.dispatch(data, [context], handlers)
        : this.keybindings.dispatchKeyId(keyId ?? data, [context], handlers)
    ) {
      return;
    }
    // Left/Right page through the list (this picker has no horizontal control).
    if (matchesKey(data, Key.left)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.list.pageDown();
      return;
    }
    const secondaryAction = this.opts.secondaryAction;
    if (
      secondaryAction !== undefined &&
      printableChar(data)?.toLowerCase() === secondaryAction.key.toLowerCase()
    ) {
      const chosen = this.list.selected();
      if (chosen !== undefined) secondaryAction.onSelect(chosen.value);
      return;
    }
    // Keep the legacy native selection fallback outside MessageActions. Its
    // configurable Enter action must remain inactive when explicitly unbound.
    const isSpace = matchesKey(data, Key.space) || printableChar(data) === ' ';
    if (
      context !== 'MessageActions' &&
      (matchesKey(data, Key.enter) || (isSpace && this.opts.searchable !== true))
    ) {
      const chosen = this.list.selected();
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
      return;
    }
    this.list.handleSearchKey(data);
  }

  override render(width: number): string[] {
    const searchable = this.opts.searchable === true;
    const view = this.list.view();
    const options = view.items;

    // Header mirrors the model dialog (see model-selector.ts): border, title
    // with a "(type to search)" suffix until you type, the hint, a blank, then
    // the search line. Key vocabulary is lowercase to match every list dialog.
    const navParts = this.bindingHints();
    if (view.page.pageCount > 1) navParts.push('←→ page');
    if (this.opts.secondaryAction !== undefined) {
      navParts.push(
        `${this.opts.secondaryAction.key.toUpperCase()} ${this.opts.secondaryAction.label}`,
      );
    }
    const hint = navParts.join(' · ');

    const titleSuffix =
      searchable && view.query.length === 0 ? currentTheme.fg('textMuted', '  (type to search)') : '';
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ` ${this.opts.title}`) + titleSuffix,
      this.opts.formatHint === undefined
        ? currentTheme.fg('textMuted', ` ${hint}`)
        : this.opts.formatHint(` ${hint}`),
    ];
    if (this.opts.notice !== undefined) {
      lines.push(currentTheme.fg(this.opts.noticeTone ?? 'success', ` ${this.opts.notice}`));
    }
    lines.push('');
    if (searchable && view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ` Search: `) + currentTheme.fg('text', view.query));
    }

    if (options.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No matches'));
    }
    for (let i = view.page.start; i < view.page.end; i++) {
      const opt = options[i]!;
      const isSelected = i === view.selectedIndex;
      const isCurrent = opt.value === this.opts.currentValue;
      const pointer = isSelected ? SELECT_POINTER : ' ';
      const labelStyle = optionLabelStyle(opt, isSelected);
      let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
      line += labelStyle(opt.label);
      if (isCurrent) {
        line += ' ' + currentTheme.fg('success', CURRENT_MARK);
      }
      lines.push(line);
      if (opt.description !== undefined && opt.description.length > 0) {
        const descriptionWidth = Math.max(1, width - 4);
        for (const descLine of wrapDescription(opt.description, descriptionWidth)) {
          lines.push(currentTheme.fg('textMuted', `    ${descLine}`));
        }
      }
    }

    lines.push('');
    if (view.page.pageCount > 1) {
      lines.push(
        currentTheme.fg('textMuted',
          ` Page ${String(view.page.page + 1)}/${String(view.page.pageCount)}`,
        ),
      );
    }
    lines.push(currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private handlers(context: KeybindingContext): KeybindingHandlers {
    const accept = (): void => {
      const chosen = this.list.selected();
      if (chosen !== undefined) this.opts.onSelect(chosen.value);
    };
    const cancel = (): void => {
      if (!this.list.clearQuery()) this.opts.onCancel();
    };
    switch (context) {
      case 'HistorySearch':
        return {
          'historySearch:next': () => this.list.moveDown(),
          'historySearch:accept': accept,
          'historySearch:cancel': () => this.opts.onCancel(),
          'historySearch:execute': () => {
            const chosen = this.list.selected();
            if (chosen !== undefined) this.opts.onExecute?.(chosen.value);
          },
        };
      case 'MessageActions':
        const handlers: Record<string, () => void> = {
          'messageActions:prev': () => this.list.moveUp(),
          'messageActions:next': () => this.list.moveDown(),
          'messageActions:prevUser': () => {
            if (this.opts.isUserOption !== undefined) {
              this.list.moveToPrevious(this.opts.isUserOption);
            }
          },
          'messageActions:nextUser': () => {
            if (this.opts.isUserOption !== undefined) this.list.moveToNext(this.opts.isUserOption);
          },
          'messageActions:top': () => this.list.moveToStart(),
          'messageActions:bottom': () => this.list.moveToEnd(),
          'messageActions:escape': cancel,
          'messageActions:ctrlc': cancel,
          'messageActions:enter': accept,
        };
        if (this.opts.onCopy !== undefined) {
          handlers['messageActions:c'] = () => {
            const chosen = this.list.selected();
            if (chosen !== undefined) this.opts.onCopy?.(chosen.value);
          };
        }
        if (this.opts.onPrimaryInput !== undefined) {
          handlers['messageActions:p'] = () => {
            const chosen = this.list.selected();
            if (chosen !== undefined) this.opts.onPrimaryInput?.(chosen.value);
          };
        }
        return handlers;
      case 'Select':
        return {
          'select:previous': () => this.list.moveUp(),
          'select:next': () => this.list.moveDown(),
          'select:accept': accept,
          'select:cancel': cancel,
        };
      default:
        return {};
    }
  }

  private bindingHints(): string[] {
    const context = this.opts.keybindingContext ?? 'Select';
    const hint = (
      action: Parameters<typeof keybindingDisplayText>[2],
      description: string,
    ): string | undefined => {
      const keys = keybindingDisplayText(this.bindings, context, action);
      return keys === undefined ? undefined : `${formatBindingKeys(keys)} ${description}`;
    };
    const hints =
      context === 'HistorySearch'
        ? [
            hint('historySearch:next', 'next'),
            hint('historySearch:accept', 'accept'),
            hint('historySearch:cancel', 'cancel'),
            hint('historySearch:execute', 'execute'),
          ]
        : context === 'MessageActions'
          ? [
              hint('messageActions:prev', 'previous'),
              hint('messageActions:next', 'next'),
              this.opts.onCopy === undefined ? undefined : hint('messageActions:c', 'copy'),
              this.opts.onPrimaryInput === undefined
                ? undefined
                : hint('messageActions:p', 'copy input'),
              hint('messageActions:enter', 'select'),
              hint('messageActions:escape', 'cancel'),
            ]
          : [
              combinedBindingHint(
                keybindingDisplayText(this.bindings, context, 'select:previous'),
                keybindingDisplayText(this.bindings, context, 'select:next'),
                'navigate',
              ),
              hint('select:accept', 'select'),
              hint('select:cancel', 'cancel'),
            ];
    return hints.filter((value): value is string => value !== undefined);
  }
}

export function formatBindingKeys(keys: string): string {
  const labels: Readonly<Record<string, string>> = {
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    enter: 'Enter',
    escape: 'Esc',
    tab: 'Tab',
    'shift+tab': 'Shift+Tab',
    backspace: 'Backspace',
    pageup: 'PgUp',
    pagedown: 'PgDn',
    space: 'Space',
  };
  return keys
    .split(' / ')
    .map((key) => labels[key] ?? key)
    .join(' / ');
}

export function combinedBindingHint(
  first: string | undefined,
  second: string | undefined,
  description: string,
): string | undefined {
  const keys = [first, second].filter((value): value is string => value !== undefined);
  if (keys.length === 0) return undefined;
  const formatted = keys.map((value) => formatBindingKeys(value).split(' / '));
  if (
    formatted.length === 2 &&
    formatted[0]?.join(' / ') === '↑ / k / ctrl+p' &&
    formatted[1]?.join(' / ') === '↓ / j / ctrl+n'
  ) {
    return `↑↓ ${description}`;
  }
  const leadingPair = `${formatted[0]?.[0] ?? ''}${formatted[1]?.[0] ?? ''}`;
  if (leadingPair === '↑↓' || leadingPair === '←→') {
    return `${[leadingPair, ...formatted.flatMap((value) => value.slice(1))].join(' / ')} ${description}`;
  }
  if (
    formatted.length === 2 &&
    formatted[0]?.join(' / ') === 'Tab / →' &&
    formatted[1]?.join(' / ') === 'Shift+Tab / ←'
  ) {
    return `Tab ${description}`;
  }
  return `${formatted.flat().join(' / ')} ${description}`;
}

function optionLabelStyle(
  option: ChoiceOption,
  selected: boolean,
): (text: string) => string {
  if (option.tone === 'danger') {
    return selected
      ? (text) => currentTheme.boldFg('error', text)
      : (text) => currentTheme.fg('error', text);
  }
  return selected
    ? (text) => currentTheme.boldFg('primary', text)
    : (text) => currentTheme.fg('text', text);
}
