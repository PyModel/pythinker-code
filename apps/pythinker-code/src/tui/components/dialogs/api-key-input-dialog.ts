import {
  Container,
  Input,
  Key,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';

import { formatBindingKeys } from '#/tui/components/dialogs/choice-picker';
import { currentTheme } from '#/tui/theme';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

export type ApiKeyInputResult =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'cancel' };

function maskInputLine(raw: string): string {
  const prefix = '> ';
  if (!raw.startsWith(prefix)) return raw;

  // Strip trailing padding spaces so they stay as spaces.
  let end = raw.length;
  while (end > prefix.length && raw[end - 1] === ' ') {
    end--;
  }
  const padding = raw.slice(end);
  const content = raw.slice(prefix.length, end);

  // Protect ANSI escape sequences (reverse-video cursor, IME marker, etc.)
  // while masking every other visible character.
  const parts = content.split(/(\u001B(?:\[[0-9;]*m|_pi:c\u0007))/);
  const maskedContent = parts
    .map((part, index) => {
      if (index % 2 === 1) return part; // ANSI sequence
      return part.replaceAll(/./g, '•');
    })
    .join('');

  return prefix + maskedContent + padding;
}

export interface ApiKeyInputDialogOptions {
  readonly title?: string | undefined;
  readonly subtitleLines?: readonly string[] | undefined;
  readonly secret?: boolean | undefined;
  readonly emptyMessage?: string | undefined;
}

function textInputBindings(bindings: readonly ParsedKeybinding[]): ParsedKeybinding[] {
  const winners = new Map<string, ParsedKeybinding>();
  for (const binding of bindings) {
    winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
  }
  return [...winners.values()].filter(
    (binding) => binding.action !== 'confirm:no' || !startsWithPrintableKey(binding),
  );
}

function startsWithPrintableKey(binding: ParsedKeybinding): boolean {
  const first = binding.chord[0];
  if (first === undefined) return false;
  if (first === 'space' || isPrintableChar(first)) return true;
  return first.startsWith('shift+') && isPrintableChar(first.slice('shift+'.length));
}

export class ApiKeyInputDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new Input();
  private readonly onDone: (result: ApiKeyInputResult) => void;
  private readonly title: string;
  private readonly subtitleLines: readonly string[];
  private readonly secret: boolean;
  private readonly emptyMessage: string;
  private done = false;
  private emptyHinted = false;
  private bindings = textInputBindings(defaultKeybindings());
  private keybindings = new KeybindingResolver(
    this.bindings.filter((binding) => binding.action === 'confirm:no'),
  );

  constructor(
    platformName: string,
    subtitleLines: readonly string[],
    onDone: (result: ApiKeyInputResult) => void,
    options: ApiKeyInputDialogOptions = {},
  ) {
    super();
    this.onDone = onDone;
    this.title = options.title ?? `Enter API key for ${platformName}`;
    this.subtitleLines = options.subtitleLines ?? subtitleLines;
    this.secret = options.secret ?? true;
    this.emptyMessage = options.emptyMessage ?? 'API key cannot be empty.';
    this.input.onSubmit = (value) => {
      this.submit(value);
    };
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = textInputBindings(bindings);
    this.keybindings = new KeybindingResolver(
      this.bindings.filter((binding) => binding.action === 'confirm:no'),
    );
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (isPrintableChar(printableChar(data))) {
      this.emptyHinted = false;
      this.input.handleInput(data);
      return;
    }
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.cancel();
      return;
    }
    const handlers: KeybindingHandlers = { 'confirm:no': () => this.cancel() };
    if (
      keyId === undefined
        ? this.keybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.keybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.cancel();
      return;
    }
    this.emptyHinted = false;
    this.input.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }

  override render(width: number): string[] {
    this.input.focused = this.focused && !this.done;

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const pad = '  ';

    const border = (s: string): string => currentTheme.fg('primary', s);
    const titleStyled = currentTheme.boldFg('textStrong', this.title);
    const subtitleSource = this.emptyHinted ? [this.emptyMessage] : this.subtitleLines;
    const subtitleLines = subtitleSource.map((line) =>
      truncateToWidth(currentTheme.fg('textDim', line), innerWidth, '…'),
    );
    const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
    const footer = [
      'Enter to submit',
      cancel === undefined ? undefined : `${formatBindingKeys(cancel)} to cancel`,
    ]
      .filter((part): part is string => part !== undefined)
      .join('  ·  ');
    const footerStyled = currentTheme.fg('textDim', footer);

    const titleLine = truncateToWidth(titleStyled, innerWidth, '…');
    const footerLine = truncateToWidth(footerStyled, innerWidth, '…');
    const rawInputLine = this.input.render(innerWidth)[0] ?? '> ';
    const inputLine =
      this.secret && this.input.getValue() !== '' ? maskInputLine(rawInputLine) : rawInputLine;

    const contentLines: string[] = [
      titleLine,
      '',
      ...subtitleLines,
      '',
      inputLine,
      '',
      footerLine,
    ];

    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }

    const lines: string[] = [
      '',
      border('╭' + '─'.repeat(safeWidth - 2) + '╮'),
      border('│') + ' '.repeat(safeWidth - 2) + border('│'),
    ];

    for (const content of contentLines) {
      const vis = visibleWidth(content);
      const rightPad = Math.max(0, innerWidth - vis);
      lines.push(border('│') + pad + content + ' '.repeat(rightPad) + border('│'));
    }

    lines.push(border('│') + ' '.repeat(safeWidth - 2) + border('│'), border('╰' + '─'.repeat(safeWidth - 2) + '╯'), '');

    return lines.map((line) => truncateToWidth(line, safeWidth, '…'));
  }

  private submit(value: string): void {
    if (this.done) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.emptyHinted = true;
      return;
    }
    this.done = true;
    this.onDone({ kind: 'ok', value: trimmed });
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }
}
