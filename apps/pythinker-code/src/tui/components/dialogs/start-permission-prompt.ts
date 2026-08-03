import {
  Key,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import { combinedBindingHint, formatBindingKeys } from '#/tui/components/dialogs/choice-picker';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';

export type StartPermissionChoice = 'auto' | 'yolo' | 'manual' | 'cancel';

export interface StartPermissionOption<TChoice extends StartPermissionChoice = StartPermissionChoice> {
  readonly value: TChoice;
  readonly label: string;
  readonly description: string;
}

export interface StartPermissionPromptOptions<
  TChoice extends StartPermissionChoice = StartPermissionChoice,
> {
  readonly title: string;
  readonly noticeLines: readonly string[];
  readonly options: readonly StartPermissionOption<TChoice>[];
  readonly onSelect: (choice: TChoice) => void;
  readonly onCancel: () => void;
}

export class StartPermissionPromptComponent<TChoice extends StartPermissionChoice = StartPermissionChoice>
  implements Component, Focusable
{
  focused = false;
  private selectedIndex = 0;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver(
    this.bindings.filter(
      (binding) =>
        binding.action === 'confirm:yes' ||
        binding.action === 'confirm:no' ||
        binding.action === 'confirm:previous' ||
        binding.action === 'confirm:next' ||
        binding.action === 'confirm:toggle',
    ),
  );

  constructor(private readonly opts: StartPermissionPromptOptions<TChoice>) {}

  invalidate(): void {}

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    const winners = new Map<string, ParsedKeybinding>();
    for (const binding of bindings) {
      winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
    }
    this.keybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) =>
          binding.action === 'confirm:yes' ||
          binding.action === 'confirm:no' ||
          binding.action === 'confirm:previous' ||
          binding.action === 'confirm:next' ||
          binding.action === 'confirm:toggle',
      ),
    );
  }

  handleInput(data: string): void {
    const keyId = parseKey(data);
    const handlers: KeybindingHandlers = {
      'confirm:yes': () => this.opts.onSelect(this.opts.options[this.selectedIndex]!.value),
      'confirm:no': this.opts.onCancel,
      'confirm:previous': () => {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      },
      'confirm:next': () => {
        this.selectedIndex = Math.min(this.opts.options.length - 1, this.selectedIndex + 1);
      },
      'confirm:toggle': () => this.opts.onSelect(this.opts.options[this.selectedIndex]!.value),
    };
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.opts.onCancel();
      return;
    }
    if (
      keyId === undefined
        ? this.keybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.keybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
  }

  render(width: number): string[] {
    const rule = currentTheme.fg('primary', '─'.repeat(width));
    const navigation = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previous'),
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:next'),
      'navigate',
    );
    const select = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:yes');
    const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
    const hint = [
      navigation,
      select === undefined ? undefined : `${formatBindingKeys(select)} select`,
      cancel === undefined ? undefined : `${formatBindingKeys(cancel)} cancel`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
    const lines = [
      rule,
      currentTheme.boldFg('primary', ` ${this.opts.title}`),
      currentTheme.fg('textMuted', ` ${hint}`),
      '',
    ];

    const textWidth = Math.max(20, width - 2);
    for (const paragraph of this.opts.noticeLines) {
      for (const line of wrapPlain(paragraph, textWidth)) {
        lines.push(` ${styleModeNames(line, 'textMuted')}`);
      }
      lines.push('');
    }

    for (let i = 0; i < this.opts.options.length; i += 1) {
      const option = this.opts.options[i]!;
      const selected = i === this.selectedIndex;
      const pointer = selected ? SELECT_POINTER : ' ';
      lines.push(
        currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `) +
          styleLabel(option.label, selected),
      );
      for (const line of wrapPlain(option.description, Math.max(20, width - 4))) {
        lines.push(`    ${styleModeNames(line, 'textMuted')}`);
      }
      lines.push('');
    }

    lines.push(rule);
    return lines.map((line) => truncateToWidth(line, width));
  }
}

function styleLabel(label: string, selected: boolean): string {
  if (selected) return currentTheme.boldFg('primary', label);
  return styleModeNames(label, 'text');
}

function styleModeNames(text: string, baseToken: 'text' | 'textMuted'): string {
  return text
    .split(/(\b(?:Manual|Auto|YOLO)\b)/g)
    .map((part) => {
      if (part === 'Manual' || part === 'Auto' || part === 'YOLO') return currentTheme.boldFg('textStrong', part);
      return currentTheme.fg(baseToken, part);
    })
    .join('');
}

function wrapPlain(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= width ? word : truncateToWidth(word, width, '…');
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
