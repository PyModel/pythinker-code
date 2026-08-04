/**
 * Custom editor extending pi-tui Editor with app-level keybindings.
 */

import {
  Editor,
  isKeyRelease,
  matchesKey,
  Key,
  SelectList,
  truncateToWidth,
  visibleWidth,
  type SelectItem,
  type TUI,
} from '@earendil-works/pi-tui';

import { createPythinkerEditorTheme, currentTheme } from '#/tui/theme';
import { applyBuffer, readBuffer } from '#/tui/editor/vim/editor-bridge';
import {
  createRainbowPainter,
  isRainbowColorActive,
} from '#/tui/easter-eggs/rainbow-colors';
import {
  applyKey,
  createInitialPersistent,
  createInitialState,
} from '#/tui/editor/vim/state-machine';
import type { PersistentState, VimMode, VimState } from '#/tui/editor/vim/types';
import {
  defaultKeybindings,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

import { findSlashAutocompleteContext, getSlashHighlightRanges } from './slash-autocomplete-context';
import { WrappingSelectList } from './wrapping-select-list';

// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences
const ANSI_SGR = /\u001B\[[0-9;]*m/g;

const PASTE_MARKER_RE = /\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/g;
const BRACKET_PASTE_START = '\u001B[200~';
const BRACKET_PASTE_END = '\u001B[201~';
const CSI_PREFIX = '\u001B[';
const SS3_PREFIX = '\u001BO';

function isLegacyModifiedInput(data: string): boolean {
  // Legacy terminals send Ctrl/Alt combos as C0 control bytes or ESC+char
  // sequences, which never reach the Kitty CSI-u decoder.
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    return code < 0x20
      && data !== '\t'
      && data !== '\n'
      && data !== '\r'
      && data !== '\u001B';
  }
  return data.startsWith('\u001B')
    && !data.startsWith(CSI_PREFIX)
    && !data.startsWith(SS3_PREFIX)
    && isPrintableChar(data.slice(1));
}

function shouldBypassVim(data: string, key: string): boolean {
  // Decoded CSI-u printables and bare Escape are vim keys, not terminal controls.
  if (isPrintableChar(key) || data === '\u001B') return false;
  // Legacy control and Alt sequences belong to app keybindings, as their
  // Kitty CSI-u equivalents already do.
  if (isLegacyModifiedInput(data)) return true;
  // pi-tui exclusively owns bracketed-paste markers and their payload registry.
  if (data.startsWith(BRACKET_PASTE_START)) return true;
  // Keep paste disjoint so removing its branch cannot fall through to this CSI branch.
  return (
    !data.startsWith(BRACKET_PASTE_START) &&
    (data.startsWith(CSI_PREFIX) || data.startsWith(SS3_PREFIX))
  );
}

// Kitty keyboard protocol CSI-u sequence: ESC [ keycode ; modifier[:eventType] u.
// We intentionally match only the simple two-field form — enough to rewrite
// `ctrl+<LETTER>` with caps_lock into `ctrl+<letter>` without caps_lock.
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match CSI
const KITTY_CSI_U = /^\u001B\[(\d+);(\d+)((?::\d+)*)u$/;
// Kitty modifier bit layout: shift=1, alt=2, ctrl=4, super=8, hyper=16,
// meta=32, caps_lock=64, num_lock=128. Reported value is `mask + 1`.
const CAPS_LOCK_BIT = 64;
const CTRL_BIT = 4;
const SHIFT_BIT = 1;

interface AutocompleteInternals {
  cancelAutocomplete(): void;
  requestAutocomplete?(options: { force: boolean; explicitTab: boolean }): void;
  readonly autocompleteAbort?: AbortController;
  readonly autocompleteDebounceTimer?: ReturnType<typeof setTimeout>;
  readonly autocompletePrefix?: string;
  readonly autocompleteList?: { getSelectedItem(): SelectItem | undefined };
}

interface AutocompleteListFactoryInternals {
  createAutocompleteList?: (prefix: string, items: SelectItem[]) => SelectList;
}

export interface CustomEditorOptions {
  readonly vimMode?: boolean;
}

// Mirror pi-tui's private SLASH_COMMAND_SELECT_LIST_LAYOUT
// (dist/components/editor.js); keep in sync when bumping pi-tui.
const SLASH_COMMAND_SELECT_LIST_LAYOUT = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
} as const;

/**
 * Workaround for a pi-tui bug that surfaces when Kitty keyboard protocol
 * is active AND caps_lock is on. In that state terminals emit, e.g.,
 * `ESC[68;69u` for ctrl+d (codepoint=68=`D`, modifier=ctrl|caps_lock).
 * pi-tui's `matchesKittySequence` masks `caps_lock` out of the *modifier*
 * but leaves the *codepoint* capitalised, so `matchesKey(data, "ctrl+d")`
 * (which expects codepoint=100=`d`) fails and every ctrl-shortcut is
 * silently dropped.
 *
 * We rewrite the sequence back to its unlocked form before dispatching,
 * but only when ctrl is held and shift is not — i.e. exactly the
 * `ctrl+<letter>` case. Plain uppercase (caps_lock only, no ctrl) and
 * explicit ctrl+shift+<letter> are left alone.
 */
export function normalizeCapsLockedCtrl(data: string): string {
  const m = data.match(KITTY_CSI_U);
  if (m === null) return data;
  const codepoint = Number(m[1]);
  const modifierPlus1 = Number(m[2]);
  const tail = m[3] ?? '';
  if (!Number.isFinite(codepoint) || !Number.isFinite(modifierPlus1)) return data;
  const modifier = modifierPlus1 - 1;
  if ((modifier & CAPS_LOCK_BIT) === 0) return data;
  if ((modifier & CTRL_BIT) === 0) return data;
  if ((modifier & SHIFT_BIT) !== 0) return data;
  if (codepoint < 65 || codepoint > 90) return data;
  const loweredCodepoint = codepoint + 32;
  const strippedModifier = (modifier & ~CAPS_LOCK_BIT) + 1;
  return `\u001B[${String(loweredCodepoint)};${String(strippedModifier)}${tail}u`;
}

/** Convert a visible-char index (ANSI-stripped) back to an index into the raw ANSI-bearing string. */
function mapVisibleIdxToRaw(line: string, visibleIdx: number): number {
  let visibleCount = 0;
  let i = 0;
  const re = new RegExp(ANSI_SGR.source, 'y');
  while (i < line.length && visibleCount < visibleIdx) {
    re.lastIndex = i;
    const m = re.exec(line);
    if (m !== null && m.index === i) {
      i += m[0].length;
    } else {
      visibleCount++;
      i++;
    }
  }
  return i;
}

function stripSgr(s: string): string {
  return s.replace(ANSI_SGR, '');
}

function findCursorMarkerRange(
  line: string,
): { rawStart: number; rawEnd: number; visibleStart: number; currentChar: string | undefined } | null {
  const rawStart = line.indexOf('\u001B[7m');
  if (rawStart < 0) return null;
  const rawEnd = line.indexOf('\u001B[0m', rawStart);
  if (rawEnd < 0) return null;
  const visibleStart = stripSgr(line.slice(0, rawStart)).length;
  const visible = stripSgr(line);
  return {
    rawStart,
    rawEnd: rawEnd + '\u001B[0m'.length,
    visibleStart,
    currentChar: visible[visibleStart],
  };
}

export function buildAutocompleteGhostSuffix(prefix: string, item: SelectItem): string | null {
  if (prefix.startsWith('/')) {
    const typed = prefix.slice(1);
    if (!item.value.startsWith(typed)) return null;
    return `${item.value.slice(typed.length)} `;
  }
  if (!item.value.startsWith(prefix)) return null;
  return item.value.slice(prefix.length);
}

export function insertAutocompleteGhost(line: string, ghostText: string): string | undefined {
  if (ghostText.length === 0) return undefined;
  const cursor = findCursorMarkerRange(line);
  if (cursor === null) return undefined;
  if (cursor.currentChar !== undefined && cursor.currentChar !== ' ' && cursor.currentChar !== '\t') {
    return undefined;
  }

  const visible = stripSgr(line);
  const insertStartVisible = cursor.visibleStart + 1;
  let insertEndVisible = insertStartVisible;
  while (insertEndVisible < visible.length) {
    const ch = visible[insertEndVisible];
    if (ch !== ' ' && ch !== '\t') break;
    insertEndVisible += 1;
  }

  const availableWidth = insertEndVisible - insertStartVisible;
  const ghostPlain = stripSgr(truncateToWidth(ghostText, availableWidth + 1, ''));
  const ghostWidth = visibleWidth(ghostPlain);
  if (ghostWidth <= 0) return undefined;

  const rawEnd = Math.max(
    mapVisibleIdxToRaw(line, cursor.visibleStart + ghostWidth),
    cursor.rawEnd,
  );
  const firstGhostChar = ghostPlain[0] ?? '';
  const rest = ghostPlain.slice(firstGhostChar.length);
  const ghost = rest.length === 0 ? '' : currentTheme.fg('textMuted', rest);
  return (
    line.slice(0, cursor.rawStart) +
    `\u001B[7m${firstGhostChar}\u001B[0m` +
    ghost +
    line.slice(rawEnd)
  );
}

export class CustomEditor extends Editor {
  public onEscape?: () => void;
  public onCtrlD?: () => void;
  public onCtrlC?: () => void;
  public onRedraw?: () => void;
  public onToggleToolExpand?: () => void;
  public onOpenExternalEditor?: () => void;
  public onSearchHistory?: () => void;
  public onMessageActions?: () => void;
  public onCtrlS?: () => void;
  public onCycleEffort?: () => void;
  public onUndo?: () => void;
  public onInsertNewline?: () => void;
  public onTextPaste?: () => void;
  public onCommand?: (command: string) => void;
  /**
   * Called when ↑ is pressed in an empty editor. Return `true` to consume
   * the key (e.g. recalled a queued message); return `false` to fall
   * through so pi-tui's built-in history navigation runs.
   */
  public onUpArrowEmpty?: () => boolean;
  public onDownArrowEmpty?: () => boolean;
  public connectedAbove = false;
  public borderHighlighted = false;
  /**
   * Called when the user triggers "paste image" (Ctrl-V on Unix,
   * Alt-V on Windows — Ctrl-V is terminal-reserved there). Return
   * `true` to consume the key (image was read and handled); return
   * `false` to let the key fall through to the normal paste path.
   * The callback may be async; pi-tui awaits it before dispatching
   * the next keystroke.
   */
  public onPasteImage?: () => Promise<boolean>;

  private consumingPaste = false;
  private consumeBuffer = '';
  private vimState?: VimState;
  private vimPersistent?: PersistentState;
  private keybindings = new KeybindingResolver(defaultKeybindings());

  constructor(tui: TUI, options?: CustomEditorOptions) {
    // paddingX: 4 reserves column 0 for the left vertical border (│),
    // column 1 as a single space between border and prompt, column 2 for
    // the `›` prompt token, and column 3 as the space between prompt and
    // content. The right side mirrors with 3 padding columns and the right
    // border at the last column.
    const theme = createPythinkerEditorTheme();
    const slashSelectListTheme = {
      ...theme.selectList,
      selectedText: (text: string) => currentTheme.boldFg('primary', text),
    };
    super(tui, theme, { paddingX: 4 });

    this.setVimMode(options?.vimMode === true);

    // pi-tui keeps `createAutocompleteList` private; shadow it with an
    // instance property so slash command menus render descriptions wrapped
    // to at most two lines. Non-slash completion (paths, @ mentions) keeps
    // pi-tui's single-line list.
    (this as unknown as AutocompleteListFactoryInternals).createAutocompleteList = (
      prefix,
      items,
    ) => {
      if (prefix.startsWith('/')) {
        return new WrappingSelectList(
          items,
          this.getAutocompleteMaxVisible(),
          slashSelectListTheme,
          SLASH_COMMAND_SELECT_LIST_LAYOUT,
        );
      }
      return new SelectList(items, this.getAutocompleteMaxVisible(), theme.selectList);
    };
  }

  private expandPasteMarkerAtCursor(): boolean {
    const { line, col } = this.getCursor();
    const lines = this.getLines();
    const currentLine = lines[line] ?? '';

    for (const match of currentLine.matchAll(PASTE_MARKER_RE)) {
      const start = match.index;
      const end = start + match[0].length;
      if (col < start || col > end) continue;

      const pasteId = Number(match[1]);
      const pastes = (this as unknown as { pastes: Map<number, string> }).pastes;
      const content = pastes.get(pasteId);
      if (content === undefined) return false;

      const text = this.getText();
      const offset = lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + start;
      const newText = text.slice(0, offset) + content + text.slice(offset + match[0].length);
      // pi-tui >=0.80 clears the paste registry in setText(); preserve the
      // other markers' contents so they stay expandable afterwards.
      const internals = this as unknown as { pastes: Map<number, string>; pasteCounter: number };
      const savedPastes = new Map(internals.pastes);
      const savedCounter = internals.pasteCounter;
      savedPastes.delete(pasteId);
      this.setText(newText);
      for (const [id, paste] of savedPastes) internals.pastes.set(id, paste);
      internals.pasteCounter = savedCounter;
      return true;
    }
    return false;
  }

  private hasAutocompleteActivity(): boolean {
    const autocomplete = this as unknown as AutocompleteInternals;
    return (
      this.isShowingAutocomplete() ||
      autocomplete.autocompleteAbort !== undefined ||
      autocomplete.autocompleteDebounceTimer !== undefined
    );
  }

  private cancelAutocompleteActivity(): void {
    // pi-tui exposes `isShowingAutocomplete()` but keeps cancellation private.
    // Pythinker needs Esc to win over app-level cancel while the slash menu request is active.
    (this as unknown as AutocompleteInternals).cancelAutocomplete();
  }

  private hasMidPromptSlashContext(): boolean {
    const { line, col } = this.getCursor();
    const currentLine = this.getLines()[line] ?? '';
    const context = findSlashAutocompleteContext(currentLine, col);
    return context !== null && currentLine.slice(0, context.commandStart).trim().length > 0;
  }

  private requestMidPromptSlashAutocomplete(explicitTab: boolean): boolean {
    if (!this.hasMidPromptSlashContext()) return false;
    const autocomplete = this as unknown as AutocompleteInternals;
    autocomplete.requestAutocomplete?.({ force: false, explicitTab });
    return autocomplete.requestAutocomplete !== undefined;
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length < 3) return lines;
    const topBorderIdx = lines.findIndex(isHorizontalBorder);
    const bottomBorderIdx = lines.findIndex(
      (line, index) => index > topBorderIdx && isHorizontalBorder(line),
    );
    if (topBorderIdx < 0 || bottomBorderIdx < 0) return lines;

    const autocompleteLines = lines.slice(bottomBorderIdx + 1);
    const autocomplete = this as unknown as AutocompleteInternals;
    const slashMenuOpen =
      autocompleteLines.length > 0 &&
      autocomplete.autocompletePrefix?.startsWith('/') === true;
    const firstContentIdx = topBorderIdx + 1;
    const firstContent = lines[firstContentIdx];
    if (firstContent !== undefined) {
      const withPrompt = injectPromptSymbol(firstContent);
      if (withPrompt !== undefined) {
        lines[firstContentIdx] = withPrompt;
      }
    }

    let slashTokenColumn: number | undefined;
    const cursorLineIdx = lines.findIndex((line) => line.includes('\u001B[7m'));
    if (cursorLineIdx >= 0) {
      const cursorLine = lines[cursorLineIdx];
      if (cursorLine !== undefined) {
        slashTokenColumn = activeSlashTokenColumn(cursorLine);
        const highlighted = highlightFirstSlashToken(cursorLine, 'textStrong');
        const decoratedLine = highlighted ?? cursorLine;
        const autocomplete = this as unknown as AutocompleteInternals;
        const selectedItem = autocomplete.autocompleteList?.getSelectedItem();
        const prefix = autocomplete.autocompletePrefix ?? '';
        const ghostSuffix =
          selectedItem === undefined ? null : buildAutocompleteGhostSuffix(prefix, selectedItem);
        const withGhost =
          ghostSuffix === null ? undefined : insertAutocompleteGhost(decoratedLine, ghostSuffix);
        lines[cursorLineIdx] = withGhost ?? decoratedLine;
      }
    }

    // `this.borderColor` is pi-tui's per-render paint function. The host may
    // overwrite it (e.g. plan-mode / slash-context highlight via
    // `editor.borderColor = chalk.hex(primary)`), so we route corners and
    // side bars through the same hook to stay in sync. Rainbow mode instead
    // uses one stateful painter for the complete frame.
    const paintBorder = isRainbowColorActive()
      ? createRainbowPainter()
      : (text: string) => this.borderColor(text);
    const contentRows = lines.slice(firstContentIdx, bottomBorderIdx);
    if (contentRows.length === 1 && !this.getText().includes('\n')) {
      const compact = lines[firstContentIdx];
      const top = lines[topBorderIdx];
      const bottom = lines[bottomBorderIdx];
      if (compact === undefined || top === undefined || bottom === undefined) return lines;
      // Compact mode keeps the top and bottom rules but drops the corners and
      // side bars, so a single-line prompt reads as one open lane.
      const composer = [
        horizontalRule(top, paintBorder),
        compactPromptRow(
          compact,
          slashMenuOpen
            ? (text) => currentTheme.fg('textStrong', text)
            : paintBorder,
        ),
        decorateVimModeBorder(
          horizontalRule(bottom, paintBorder),
          this.vimState?.mode,
          paintBorder,
        ),
      ];
      return slashMenuOpen
        ? [
            ...composer,
            ...renderSlashCommandMenu(
              autocompleteLines,
              width,
              this.getPaddingX(),
              // Compact mode removes two leading composer cells. Menu labels
              // already start two cells after their selection marker.
              Math.max(0, (slashTokenColumn ?? 4) - 4),
            ),
          ]
        : [...composer, ...autocompleteLines];
    }

    const editorLines = slashMenuOpen
      ? lines.slice(0, bottomBorderIdx + 1)
      : lines;
    const editor = wrapWithSideBorders(editorLines, paintBorder, {
      connectedAbove: this.connectedAbove && !this.borderHighlighted,
    });
    const bottomBorder = editor[bottomBorderIdx];
    if (bottomBorder !== undefined) {
      editor[bottomBorderIdx] = decorateVimModeBorder(
        bottomBorder,
        this.vimState?.mode,
        paintBorder,
      );
    }
    return slashMenuOpen
      ? [
          ...editor,
          ...renderSlashCommandMenu(
            autocompleteLines,
            width,
            this.getPaddingX(),
            // Boxed composers retain their rendered slash column. Menu labels
            // already start two cells after their selection marker.
            Math.max(0, (slashTokenColumn ?? 2) - 2),
          ),
        ]
      : editor;
  }

  isVimModeEnabled(): boolean {
    return this.vimState !== undefined;
  }

  /** Toggles vim ownership of editor input; state survives until toggled off. */
  setVimMode(enabled: boolean): void {
    if (enabled) {
      if (this.vimState !== undefined && this.vimPersistent !== undefined) return;
      this.vimState = createInitialState();
      this.vimPersistent = createInitialPersistent();
      return;
    }
    if (this.vimState === undefined && this.vimPersistent === undefined) return;
    this.vimState = undefined;
    this.vimPersistent = undefined;
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.keybindings = new KeybindingResolver(bindings);
  }

  override handleInput(data: string): void {
    // Normalize and drop key-release events before vim ownership is decided,
    // so a release cannot fall through to vim or app keybinding handling.
    const normalized = normalizeCapsLockedCtrl(data);
    if (isKeyRelease(normalized)) {
      return;
    }

    const key = printableChar(normalized);
    if (
      this.vimState !== undefined &&
      this.vimPersistent !== undefined &&
      !shouldBypassVim(normalized, key)
    ) {
      const result = applyKey(
        this.vimState,
        this.vimPersistent,
        readBuffer(this),
        key,
      );
      this.vimState = result.state;
      this.vimPersistent = result.persistent;
      if (result.handled) {
        if (matchesKey(normalized, Key.escape) && this.hasAutocompleteActivity()) {
          this.cancelAutocompleteActivity();
        }
        applyBuffer(this, result.buffer);
        return;
      }
      super.handleInput(normalized);
      if (!this.hasAutocompleteActivity()) this.requestMidPromptSlashAutocomplete(false);
      return;
    }

    // When a paste marker was just expanded, discard the trailing bracketed
    // paste data that the terminal sends alongside the Ctrl-V keystroke.
    if (this.consumingPaste) {
      this.consumeBuffer += normalized;
      if (this.consumeBuffer.includes(BRACKET_PASTE_END)) {
        this.consumingPaste = false;
        this.consumeBuffer = '';
      }
      return;
    }

    // If a bracketed paste arrives while the cursor sits on an existing
    // paste marker, expand that marker instead of pasting new content.
    if (normalized.includes(BRACKET_PASTE_START) && this.expandPasteMarkerAtCursor()) {
      if (!normalized.includes(BRACKET_PASTE_END)) {
        this.consumingPaste = true;
      }
      return;
    }

    const contexts = this.hasAutocompleteActivity()
      ? (['Autocomplete', 'Chat'] as const)
      : (['Chat'] as const);
    if (this.keybindings.dispatch(normalized, contexts, {
      'autocomplete:accept': () => super.handleInput('\t'),
      'autocomplete:dismiss': () => this.cancelAutocompleteActivity(),
      'autocomplete:previous': () => super.handleInput('\u001B[A'),
      'autocomplete:next': () => super.handleInput('\u001B[B'),
      'app:interrupt': () => this.onCtrlC?.(),
      'app:exit': () => this.getText().length === 0
        ? this.onCtrlD?.()
        : super.handleInput(normalized),
      'app:redraw': () => this.onRedraw?.(),
      'app:toggleTranscript': () => this.onToggleToolExpand?.(),
      'history:search': () => this.onSearchHistory?.(),
      'chat:historySearch': () => this.onSearchHistory?.(),
      'history:previous': () => super.handleInput('\u001B[A'),
      'history:next': () => super.handleInput('\u001B[B'),
      'chat:cancel': () => this.onEscape?.(),
      // Deprecated action kept for schema back-compat; treat as thinkingToggle.
      'chat:cycleMode': () => this.onCycleEffort?.(),
      'chat:externalEditor': () => this.onOpenExternalEditor?.(),
      'chat:messageActions': () => this.onMessageActions?.(),
      'chat:modelPicker': () => this.onCommand?.('model'),
      'chat:submit': () => super.handleInput('\r'),
      'chat:stash': () => this.onCtrlS?.(),
      'chat:thinkingToggle': () => this.onCycleEffort?.(),
      'chat:undo': () => {
        this.onUndo?.();
        super.handleInput('\u001F');
      },
      'chat:newline': () => {
        this.onInsertNewline?.();
        super.handleInput('\n');
      },
      'chat:imagePaste': () => this.handlePasteKeybinding(normalized),
    }, { onCommand: (command) => this.onCommand?.(command) })) {
      return;
    }

    if (matchesKey(normalized, Key.up)) {
      if (this.getText().length === 0 && this.onUpArrowEmpty) {
        if (this.onUpArrowEmpty()) return;
        // fall through to super so Editor's built-in history navigation runs
      }
    }

    if (matchesKey(normalized, Key.down)) {
      if (this.getText().length === 0 && this.onDownArrowEmpty) {
        if (this.onDownArrowEmpty()) return;
      }
    }

    if (matchesKey(normalized, Key.escape)) {
      if (this.hasAutocompleteActivity()) {
        this.cancelAutocompleteActivity();
        return;
      }
      this.onEscape?.();
      return;
    }

    if (matchesKey(normalized, Key.tab) && this.requestMidPromptSlashAutocomplete(true)) {
      return;
    }

    super.handleInput(normalized);
    if (!this.hasAutocompleteActivity()) this.requestMidPromptSlashAutocomplete(false);
  }

  private handlePasteKeybinding(data: string): void {
    if (this.expandPasteMarkerAtCursor()) return;
    if (this.onPasteImage === undefined) {
      super.handleInput(data);
      return;
    }
    const pasteAsText = (): void => {
      this.onTextPaste?.();
      super.handleInput(data);
    };
    void this.onPasteImage().then(
      (handled) => {
        if (!handled) pasteAsText();
      },
      () => {
        pasteAsText();
      },
    );
  }
}

/**
 * Return a copy of `line` with the active slash-command token coloured using
 * the current theme, even when the command lives mid-prompt.
 */
export function highlightFirstSlashToken(
  line: string,
  token: 'primary' | 'textStrong',
): string | undefined {
  const cursor = findCursorMarkerRange(line);
  if (cursor === null) return undefined;
  const ranges = getSlashHighlightRanges(stripSgr(line), cursor.visibleStart);
  if (ranges.length === 0) return undefined;
  return highlightVisibleRanges(line, ranges, token);
}

function activeSlashTokenColumn(line: string): number | undefined {
  // The slash menu is indented so its labels line up under the active `/cmd`
  // token; this computes that token's visible (terminal-cell) column.
  const cursor = findCursorMarkerRange(line);
  if (cursor === null) return undefined;
  const visible = stripSgr(line);
  const start = getSlashHighlightRanges(visible, cursor.visibleStart)[0]?.start;
  return start === undefined ? undefined : visibleWidth(visible.slice(0, start));
}

function highlightVisibleRanges(
  line: string,
  ranges: Array<{ start: number; end: number }>,
  token: 'primary' | 'textStrong',
): string {
  let out = '';
  let rawCursor = 0;
  for (const range of ranges) {
    const rawStart = mapVisibleIdxToRaw(line, range.start);
    const rawEnd = mapVisibleIdxToRaw(line, range.end);
    out += line.slice(rawCursor, rawStart);
    out += paintHighlightRange(line.slice(rawStart, rawEnd), token);
    rawCursor = rawEnd;
  }
  return out + line.slice(rawCursor);
}

function paintHighlightRange(
  text: string,
  token: 'primary' | 'textStrong',
): string {
  // The cursor marker injects an SGR reset inside the token; re-apply the
  // highlight to every non-reset segment so the token stays colored.
  return text
    .split(/(\u001B\[0m)/u)
    .map((part) =>
      part.length === 0 || part === '\u001B[0m'
        ? part
        : currentTheme.boldFg(token, part),
    )
    .join('');
}

/**
 * Overlay a terminal-style `❯ ` prompt symbol on the first content line.
 * Column 0 is reserved for the left vertical border (overlaid later by
 * wrapWithSideBorders); column 1 is a single-space gap, so the `❯` token
 * lives at column 2 with column 3 separating it from content.
 * Relies on the editor being configured with `paddingX >= 4` so the line
 * starts with at least four literal spaces. Emits no SGR so the terminal's
 * default foreground colour renders the symbol. Returns `undefined` if the
 * line is too short or doesn't begin with the expected padding.
 */
export function injectPromptSymbol(line: string): string | undefined {
  if (line.length < 4) return undefined;
  for (let i = 0; i < 4; i++) {
    if (line[i] !== ' ') return undefined;
  }
  return '  ❯ ' + line.slice(4);
}

function isHorizontalBorder(line: string): boolean {
  const plain = stripSgr(line);
  return plain.length > 0 && plain[0] === '─';
}

/**
 * Repaint a border row as a plain full-width rule. Rows carrying a scroll
 * indicator (`── ↑ N more ──`) keep their own text.
 */
/**
 * Embed ` NORMAL `/` INSERT `/` VISUAL ` in the composer's bottom border so
 * the active vim mode stays visible while typing. Plain rules keep their
 * scroll-indicator text; boxed and flat bottom rows are rewritten.
 */
function decorateVimModeBorder(
  line: string,
  mode: VimMode | undefined,
  paint: (text: string) => string,
): string {
  if (mode === undefined) return line;
  const plain = stripSgr(line);
  const boxed = /^╰─+╯$/u.test(plain);
  if (!boxed && !/^─+$/u.test(plain)) return line;

  const label = ` ${mode} `;
  const left = boxed ? '╰─' : '─';
  const right = boxed ? '╯' : '';
  const fillWidth =
    visibleWidth(plain) - visibleWidth(left) - visibleWidth(label) - visibleWidth(right);
  if (fillWidth < 1) return line;

  const token = mode === 'NORMAL' ? 'primary' : mode === 'INSERT' ? 'success' : 'warning';
  return paint(left) +
    currentTheme.boldFg(token, label) +
    paint(`${'─'.repeat(fillWidth)}${right}`);
}

function horizontalRule(line: string, paint: (text: string) => string): string {
  const plain = stripSgr(line);
  return /^─+$/u.test(plain) ? paint(plain) : line;
}

function renderSlashCommandMenu(
  lines: readonly string[],
  width: number,
  editorPadding: number,
  leftIndent: number,
): string[] {
  const safeWidth = Math.max(0, Math.trunc(Number.isFinite(width) ? width : 0));
  const indent = ' '.repeat(Math.max(0, leftIndent));
  return lines.map((line) =>
    fitMenuLine(`${indent}${stripEditorPadding(line, editorPadding)}`, safeWidth),
  );
}

function stripEditorPadding(line: string, padding: number): string {
  let start = 0;
  while (start < padding && line[start] === ' ') start += 1;

  let end = line.length;
  let removed = 0;
  while (removed < padding && end > start && line[end - 1] === ' ') {
    end -= 1;
    removed += 1;
  }
  return line.slice(start, end);
}

function fitMenuLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, '');
  return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

function compactPromptRow(line: string, paint: (text: string) => string): string {
  if (line.startsWith('  ❯ ')) return paint('❯') + line.slice(3);

  const withPrompt = injectPromptSymbol(line);
  if (withPrompt === undefined) return line;
  // Compact mode removes the two cells reserved for the legacy left border
  // and paints only the prompt glyph when rainbow mode is active.
  return paint('❯') + ' ' + line.slice(4);
}

/**
 * Post-process pi-tui's editor output to draw a full box around it.
 *
 * pi-tui only renders horizontal top/bottom borders; we wrap them with
 * `╭╮╰╯` corners and add vertical `│` bars on each row's outer columns.
 * Horizontal-border rows (those whose first visible char is `─`, including
 * scroll indicators like `── ↑ N more ──`) are stripped of their existing
 * SGR and repainted as a single box-drawn span. Content rows keep their
 * inner SGR intact; only column 0 and the last column are overlaid, and
 * only if they're literal spaces — that protects the cursor-overflow
 * case where the rightmost column is an SGR-tagged inverse cursor.
 */
export function wrapWithSideBorders(
  lines: string[],
  paint: (s: string) => string,
  options: {
    readonly connectedAbove?: boolean;
  } = {},
): string[] {
  let seenTop = false;
  return lines.map((line) => {
    const plain = stripSgr(line);
    if (plain.length > 0 && plain[0] === '─') {
      const leftCorner = seenTop ? '╰' : options.connectedAbove === true ? '├' : '╭';
      const rightCorner = seenTop ? '╯' : options.connectedAbove === true ? '┤' : '╮';
      seenTop = true;
      if (plain.length === 1) return paint(leftCorner);
      const middle = plain.slice(1, -1);
      return paint(leftCorner + middle + rightCorner);
    }
    if (line.length === 0) return line;
    const firstCh = line[0];
    const lastCh = line.at(-1);
    const head = firstCh === ' ' ? paint('│') : (firstCh ?? '');
    const tail =
      line.length > 1 && lastCh === ' ' ? paint('│') : (lastCh ?? '');
    if (line.length === 1) return head;
    return head + line.slice(1, -1) + tail;
  });
}
