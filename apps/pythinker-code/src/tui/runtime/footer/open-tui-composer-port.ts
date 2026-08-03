import {
  clearComposer,
  createComposerState,
  deleteBackwardGrapheme,
  deleteBackwardWord,
  deleteForwardGrapheme,
  deleteForwardWord,
  detectComposerPrefix,
  getComposerText,
  historyDown,
  historyUp,
  insertNewline,
  insertText,
  moveCursorLeft,
  moveCursorLineEnd,
  moveCursorLineStart,
  moveCursorRight,
  moveCursorTextEnd,
  moveCursorTextStart,
  moveCursorWordLeft,
  moveCursorWordRight,
  type ComposerPrefix,
  type ComposerState,
} from '#/tui/runtime/footer/composer-state';
import {
  defaultKeybindings,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';

export interface ComposerKey {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly super?: boolean;
}

export type ComposerIntent =
  | { readonly kind: 'submit'; readonly text: string }
  | {
      readonly kind: 'exit-intent';
      readonly source: 'ctrl-c' | 'ctrl-d';
    }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'steer' }
  | { readonly kind: 'toggle-plan-mode' }
  | { readonly kind: 'toggle-expansion' }
  | { readonly kind: 'open-external-editor'; readonly text: string }
  | { readonly kind: 'changed'; readonly text: string }
  | {
      readonly kind: 'autocomplete';
      readonly prefix: ComposerPrefix | null;
    };

export interface ComposerViewState {
  readonly marker: string;
  readonly text: string;
  readonly placeholder: string;
  readonly cursorLine: number;
  readonly cursorCol: number;
  readonly isEmpty: boolean;
}

export interface ComposerPort {
  getText(): string;
  setText(text: string): void;
  isFocused(): boolean;
  focus(): void;
  blur(): void;
  addToHistory(text: string): void;
  handleKey(key: ComposerKey): readonly ComposerIntent[];
  getViewState(): ComposerViewState;
}

export interface OpenTuiComposerPortOptions {
  readonly text?: string;
  readonly marker?: string;
  readonly placeholder?: string;
  readonly bindings?: readonly ParsedKeybinding[];
}

export function openTuiKeyId(key: Readonly<ComposerKey>): string {
  const modifiers = [
    key.ctrl ? 'ctrl' : undefined,
    key.alt ? 'alt' : undefined,
    key.shift ? 'shift' : undefined,
    key.super ? 'super' : undefined,
  ].filter((modifier) => modifier !== undefined);
  return [...modifiers, key.key === 'return' ? 'enter' : key.key].join('+');
}

const NAMED_KEYS = new Set([
  'enter',
  'escape',
  'tab',
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
]);

const COMPOSER_ACTIONS: ReadonlySet<string> = new Set([
  'app:interrupt',
  'app:exit',
  'app:toggleTranscript',
  'chat:cancel',
  'chat:cycleMode',
  'chat:externalEditor',
  'chat:newline',
  'chat:stash',
  'chat:submit',
  'history:next',
  'history:previous',
]);

function composerBindings(
  bindings: readonly ParsedKeybinding[],
): readonly ParsedKeybinding[] {
  const winners = new Map<string, ParsedKeybinding>();
  for (const binding of bindings) {
    winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
  }
  return [...winners.values()].filter(
    (binding) =>
      (binding.context === 'Chat' || binding.context === 'Global') &&
      (binding.action === null || COMPOSER_ACTIONS.has(binding.action)),
  );
}

export class OpenTuiComposerPort implements ComposerPort {
  public pendingExit: 'ctrl-c' | 'ctrl-d' | null = null;

  private state: ComposerState;
  private readonly history: string[] = [];
  private historyIndex: number | null = null;
  private focused = false;
  private readonly marker: string;
  private readonly placeholder: string;
  private readonly keybindings: KeybindingResolver;

  public constructor(options: OpenTuiComposerPortOptions = {}) {
    this.state = createComposerState(options.text);
    this.marker = options.marker ?? '❯';
    this.placeholder = options.placeholder ?? 'Type a message';
    this.keybindings = new KeybindingResolver(
      composerBindings(options.bindings ?? defaultKeybindings()),
    );
  }

  public getText(): string {
    return getComposerText(this.state);
  }

  public setText(text: string): void {
    this.state = createComposerState(text);
    this.historyIndex = null;
  }

  public isFocused(): boolean {
    return this.focused;
  }

  public focus(): void {
    this.focused = true;
  }

  public blur(): void {
    this.focused = false;
  }

  public addToHistory(text: string): void {
    this.history.push(text);
    this.historyIndex = null;
  }

  public clearPendingExit(): void {
    this.pendingExit = null;
  }

  public getViewState(): ComposerViewState {
    const text = this.getText();
    return {
      marker: this.marker,
      text,
      placeholder: this.placeholder,
      cursorLine: this.state.cursorLine,
      cursorCol: this.state.cursorCol,
      isEmpty: text.length === 0,
    };
  }

  public handleKey(key: ComposerKey): readonly ComposerIntent[] {
    const normalizedKey = key.key === 'return' ? { ...key, key: 'enter' } : key;
    const exitSource = this.getExitSource(normalizedKey);
    const matchingSecondExit =
      exitSource !== null && this.pendingExit === exitSource;
    if (!matchingSecondExit) {
      this.clearPendingExit();
    }

    const configured = this.handleConfiguredKey(normalizedKey);
    if (configured !== undefined) return configured;

    if (exitSource !== null) {
      return this.handleExit(exitSource);
    }

    if (normalizedKey.key === 'escape') {
      return [{ kind: 'cancel' }];
    }
    if (normalizedKey.ctrl && normalizedKey.key === 's') {
      return [{ kind: 'steer' }];
    }
    if (
      normalizedKey.shift &&
      !normalizedKey.ctrl &&
      !normalizedKey.alt &&
      normalizedKey.key === 'tab'
    ) {
      return [{ kind: 'toggle-plan-mode' }];
    }
    if (normalizedKey.ctrl && normalizedKey.key === 'o') {
      return [{ kind: 'toggle-expansion' }];
    }
    if (normalizedKey.ctrl && normalizedKey.key === 'g') {
      return [{ kind: 'open-external-editor', text: this.getText() }];
    }
    if (normalizedKey.key === 'enter') {
      return this.handleEnter(normalizedKey);
    }
    if (normalizedKey.key === 'up' || normalizedKey.key === 'down') {
      return this.handleHistory(normalizedKey.key);
    }

    const previousText = this.getText();
    this.handleEditingKey(normalizedKey);
    return this.textChangeIntents(previousText);
  }

  private handleConfiguredKey(
    key: ComposerKey,
  ): readonly ComposerIntent[] | undefined {
    let intents: readonly ComposerIntent[] | undefined;
    const handled = this.keybindings.dispatchKeyId(
      openTuiKeyId(key),
      ['Chat', 'Global'],
      {
        'app:interrupt': () => {
          intents = this.handleExit('ctrl-c');
        },
        'app:exit': () => {
          intents = this.handleExit('ctrl-d');
        },
        'app:toggleTranscript': () => {
          intents = [{ kind: 'toggle-expansion' }];
        },
        'chat:cancel': () => {
          intents = [{ kind: 'cancel' }];
        },
        'chat:cycleMode': () => {
          intents = [{ kind: 'toggle-plan-mode' }];
        },
        'chat:externalEditor': () => {
          intents = [{ kind: 'open-external-editor', text: this.getText() }];
        },
        'chat:newline': () => {
          intents = this.applyTextEdit(insertNewline);
        },
        'chat:stash': () => {
          intents = [{ kind: 'steer' }];
        },
        'chat:submit': () => {
          intents = this.handleEnter({ ...key, shift: false });
        },
        'history:next': () => {
          intents = this.handleHistory('down');
        },
        'history:previous': () => {
          intents = this.handleHistory('up');
        },
      },
    );
    return handled ? intents ?? [] : undefined;
  }

  private getExitSource(
    key: ComposerKey,
  ): 'ctrl-c' | 'ctrl-d' | null {
    if (!key.ctrl) return null;
    if (key.key === 'c') return 'ctrl-c';
    if (key.key === 'd') return 'ctrl-d';
    return null;
  }

  private handleExit(
    source: 'ctrl-c' | 'ctrl-d',
  ): readonly ComposerIntent[] {
    const intents: ComposerIntent[] = [];
    if (source === 'ctrl-c' && this.pendingExit !== source) {
      const previousText = this.getText();
      this.state = clearComposer(this.state);
      intents.push(...this.textChangeIntents(previousText));
    }
    this.pendingExit = source;
    intents.push({ kind: 'exit-intent', source });
    return intents;
  }

  private handleEnter(key: ComposerKey): readonly ComposerIntent[] {
    if (key.shift) {
      return this.applyTextEdit(insertNewline);
    }

    const line = this.state.lines[this.state.cursorLine] ?? '';
    if (line[this.state.cursorCol - 1] === '\\') {
      const previousText = this.getText();
      this.state = deleteBackwardGrapheme(this.state);
      this.state = insertNewline(this.state);
      return this.textChangeIntents(previousText);
    }

    const text = this.getText();
    if (text.length === 0) return [];
    this.state = clearComposer(this.state);
    this.historyIndex = null;
    return [{ kind: 'submit', text }, ...this.changeIntents()];
  }

  private handleHistory(
    direction: 'up' | 'down',
  ): readonly ComposerIntent[] {
    const previousState = this.state;
    const result =
      direction === 'up'
        ? historyUp(this.state, this.history, this.historyIndex)
        : historyDown(this.state, this.history, this.historyIndex);
    this.state = result.state;
    this.historyIndex = result.historyIndex;
    if (this.state === previousState) return [];
    return this.changeIntents();
  }

  private handleEditingKey(key: ComposerKey): void {
    switch (key.key) {
      case 'left':
        this.state =
          key.ctrl || key.alt
            ? moveCursorWordLeft(this.state)
            : moveCursorLeft(this.state);
        return;
      case 'right':
        this.state =
          key.ctrl || key.alt
            ? moveCursorWordRight(this.state)
            : moveCursorRight(this.state);
        return;
      case 'home':
        this.state =
          key.ctrl || key.alt
            ? moveCursorTextStart(this.state)
            : moveCursorLineStart(this.state);
        return;
      case 'end':
        this.state =
          key.ctrl || key.alt
            ? moveCursorTextEnd(this.state)
            : moveCursorLineEnd(this.state);
        return;
      case 'backspace':
        this.state =
          key.ctrl || key.alt
            ? deleteBackwardWord(this.state)
            : deleteBackwardGrapheme(this.state);
        return;
      case 'delete':
        this.state =
          key.ctrl || key.alt
            ? deleteForwardWord(this.state)
            : deleteForwardGrapheme(this.state);
        return;
      default:
        if (this.isPrintable(key)) {
          this.state = insertText(this.state, key.key);
        }
    }
  }

  private isPrintable(key: ComposerKey): boolean {
    return (
      !key.ctrl &&
      !key.alt &&
      !key.super &&
      key.key.length > 0 &&
      !NAMED_KEYS.has(key.key) &&
      !/[\r\n]/u.test(key.key)
    );
  }

  private applyTextEdit(
    edit: (state: ComposerState) => ComposerState,
  ): readonly ComposerIntent[] {
    const previousText = this.getText();
    this.state = edit(this.state);
    return this.textChangeIntents(previousText);
  }

  private textChangeIntents(
    previousText: string,
  ): readonly ComposerIntent[] {
    if (this.getText() === previousText) return [];
    return this.changeIntents();
  }

  private changeIntents(): readonly ComposerIntent[] {
    return [
      { kind: 'changed', text: this.getText() },
      {
        kind: 'autocomplete',
        prefix: detectComposerPrefix(this.state),
      },
    ];
  }
}
