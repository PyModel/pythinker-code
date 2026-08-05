/**
 * QuestionDialog — pi-tui version of the structured question prompt.
 *
 * Each question collects an answer locally, and a final Submit tab
 * reviews everything before the answers are emitted upstream.
 */

import {
  Container,
  Input,
  matchesKey,
  Key,
  parseKey,
  type Focusable,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui';

import { combinedBindingHint, formatBindingKeys } from '#/tui/components/dialogs/choice-picker';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';
import type {
  PendingQuestion,
  QuestionPanelResponse,
  QuestionSubmissionMethod,
} from '#/tui/reverse-rpc/types';
import { printableChar } from '#/tui/utils/printable-key';

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const MAX_BODY_LINES = 12;
const MAX_PREVIEW_LINES = 20;
const PREVIEW_SPLIT_MIN_WIDTH = 72;
const DEFAULT_OTHER_LABEL = 'Other';
const NOT_ANSWERED_LABEL = 'Not answered';
const REVIEW_TITLE = 'Review your answer before submit';
const SUBMIT_PROMPT = 'Ready to submit your answers?';
const UNANSWERED_WARNING = 'Some questions are still unanswered.';
const SUBMIT_ACTIONS = ['Submit', 'Cancel'] as const;

interface DisplayOption {
  readonly label: string;
  readonly description?: string | undefined;
  readonly preview?: string | undefined;
  readonly kind: 'preset' | 'other';
}

/**
 * Push `content` to `lines`, wrapping it to fit `width` with a hanging
 * indent. The first physical line starts with `firstPrefix`; continuation
 * lines get `continuationPrefix`. Pass `tone` to wrap every emitted line
 * in a single ANSI span (cleaner for selection highlights and matches the
 * pre-wrap rendering tests expect); leave it undefined when the prefixes
 * already carry their own mixed styling.
 */
function appendWrapped(
  lines: string[],
  firstPrefix: string,
  continuationPrefix: string,
  content: string,
  width: number,
  tone?: (s: string) => string,
): void {
  const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
  const contentWidth = Math.max(1, width - prefixWidth);
  const wrapped = wrapTextWithAnsi(content, contentWidth);
  const styleLine = tone ?? ((s: string) => s);
  if (wrapped.length === 0) {
    lines.push(styleLine(firstPrefix));
    return;
  }
  lines.push(styleLine(`${firstPrefix}${wrapped[0] ?? ''}`));
  for (let i = 1; i < wrapped.length; i++) {
    lines.push(styleLine(`${continuationPrefix}${wrapped[i] ?? ''}`));
  }
}

function fitToWidth(line: string, width: number): string {
  const fitted =
    visibleWidth(line) > width ? truncateToWidth(line, width, '…') : line;
  return fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
}

function renderPreviewBox(content: string, width: number): string[] {
  const boxWidth = Math.max(12, width);
  const innerWidth = Math.max(1, boxWidth - 4);
  const wrapped = content
    .split('\n')
    .flatMap((line) => {
      const rows = wrapTextWithAnsi(line, innerWidth);
      return rows.length === 0 ? [''] : rows;
    });
  const hidden = Math.max(0, wrapped.length - MAX_PREVIEW_LINES);
  const visible = wrapped.slice(0, MAX_PREVIEW_LINES);
  if (hidden > 0) {
    visible[visible.length - 1] = `… ${String(hidden)} more lines`;
  }

  const top = `┌─ Preview ${'─'.repeat(Math.max(0, boxWidth - 12))}┐`;
  const bottom = `└${'─'.repeat(Math.max(0, boxWidth - 2))}┘`;
  const dim = (text: string) => currentTheme.fg('textDim', text);
  return [
    dim(top),
    ...visible.map((line) => `${dim('│')} ${fitToWidth(line, innerWidth)} ${dim('│')}`),
    dim(bottom),
  ];
}

function joinColumns(
  left: readonly string[],
  right: readonly string[],
  leftWidth: number,
  rightWidth: number,
): string[] {
  const height = Math.max(left.length, right.length);
  return Array.from({ length: height }, (_, index) => {
    const leftLine = fitToWidth(left[index] ?? '', leftWidth);
    const rightLine = fitToWidth(right[index] ?? '', rightWidth);
    return `${leftLine}  ${rightLine}`;
  });
}

export class QuestionDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly request: PendingQuestion;
  private readonly onAnswer: (response: QuestionPanelResponse) => void;
  private readonly maxVisibleOptions: number;
  private readonly otherInput = new Input();

  private currentTab = 0;
  private submitActionIdx = 0;
  private editingOther = false;
  private editingNotes = false;
  private reviewMessage: string | undefined;
  private lastAnswerMethod: QuestionSubmissionMethod | undefined;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver(
    this.bindings.filter(
      (binding) =>
        binding.action === 'confirm:yes' ||
        binding.action === 'confirm:no' ||
        binding.action === 'confirm:previous' ||
        binding.action === 'confirm:next' ||
        binding.action === 'confirm:nextField' ||
        binding.action === 'confirm:previousField' ||
        binding.action === 'confirm:toggle' ||
        binding.action === 'confirm:toggleExplanation',
    ),
  );
  private nestedKeybindings = new KeybindingResolver(
    this.bindings.filter(
      (binding) =>
        binding.action === 'confirm:no' ||
        binding.action === 'confirm:nextField' ||
        binding.action === 'confirm:previousField',
    ),
  );

  /** Per-question cursor position. */
  private readonly cursors: number[];
  /** Per-question single-select choice. */
  private readonly singleSelections: (number | undefined)[];
  /** Per-question multi-select choices. */
  private readonly multiSelections: Set<number>[];
  /** Per-question free-text drafts for the synthetic Other option. */
  private readonly otherDrafts: string[];
  /** Per-question committed Other values. */
  private readonly committedOtherValues: (string | undefined)[];
  /** Per-question notes for preview choices. */
  private readonly noteDrafts: string[];
  /** Per-question derived answers used by tabs + review. */
  private readonly answers: (string | undefined)[];

  private readonly onToggleToolOutput: (() => void) | undefined;

  constructor(
    request: PendingQuestion,
    onAnswer: (response: QuestionPanelResponse) => void,
    maxVisibleOptions = 6,
    onToggleToolOutput?: () => void,
  ) {
    super();
    this.request = request;
    this.onAnswer = onAnswer;
    this.maxVisibleOptions = maxVisibleOptions;
    this.onToggleToolOutput = onToggleToolOutput;
    this.otherInput.onSubmit = (value) =>
      this.isEditingNotes()
        ? this.commitNotesInput(value)
        : this.commitOtherInput(value, 'enter');

    const total = request.data.questions.length;
    this.cursors = Array.from({ length: total }, (): number => 0);
    this.singleSelections = Array.from({ length: total }, (): number | undefined => undefined);
    this.multiSelections = Array.from({ length: total }, () => new Set<number>());
    this.otherDrafts = Array.from({ length: total }, (): string => '');
    this.committedOtherValues = Array.from({ length: total }, (): string | undefined => undefined);
    this.noteDrafts = Array.from({ length: total }, (): string => '');
    this.answers = Array.from({ length: total }, (): string | undefined => undefined);
  }

  // ── Input ─────────────────────────────────────────────────────────

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
          binding.action === 'confirm:nextField' ||
          binding.action === 'confirm:previousField' ||
          binding.action === 'confirm:toggle' ||
          binding.action === 'confirm:toggleExplanation',
      ),
    );
    this.nestedKeybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) =>
          binding.action === 'confirm:no' ||
          binding.action === 'confirm:nextField' ||
          binding.action === 'confirm:previousField',
      ),
    );
  }

  handleInput(data: string): void {
    if (this.isEditingNotes()) {
      this.handleNotesInput(data);
      return;
    }

    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.onAnswer({ answers: [] });
      return;
    }

    if (matchesKey(data, Key.ctrl('o'))) {
      this.onToggleToolOutput?.();
      return;
    }

    if (this.isEditingOther()) {
      this.handleOtherInput(data);
      return;
    }

    const previewQuestionIdx = this.currentQuestionIndex();
    const useLocalNotesFallback =
      previewQuestionIdx !== undefined &&
      printableChar(data) === 'n' &&
      this.hasPreview(previewQuestionIdx);
    const handlers: KeybindingHandlers = useLocalNotesFallback
      ? { ...this.handlers(), 'confirm:no': () => false }
      : this.handlers();
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.onAnswer({ answers: [] });
      return;
    }
    if (
      keyId === undefined
        ? this.keybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.keybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (useLocalNotesFallback) {
      this.enterNotesInput(previewQuestionIdx);
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.gotoTab(this.currentTab - 1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.gotoTab(this.currentTab + 1);
      return;
    }
    if (this.isSubmitTab()) {
      const printable = printableChar(data);
      if (printable === '1') {
        this.submitActionIdx = 0;
        this.executeSubmitAction(0, 'number_key');
      } else if (printable === '2') {
        this.submitActionIdx = 1;
        this.executeSubmitAction(1, 'number_key');
      }
      return;
    }

    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    const optionCount = this.displayOptions(questionIdx).length;
    if (optionCount === 0) return;

    const printable = printableChar(data);
    const numIdx = NUMBER_KEYS.indexOf(printable);
    if (numIdx >= 0 && numIdx < optionCount) {
      this.cursors[questionIdx] = numIdx;
      this.activateQuestionOption(numIdx, 'number_key');
      return;
    }

  }

  private handleOtherInput(data: string): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const handlers: KeybindingHandlers = {
      'confirm:no': () => this.onAnswer({ answers: [] }),
      'confirm:nextField': () => {
        this.syncOtherDraft(questionIdx);
        this.editingOther = false;
        this.gotoTab(this.currentTab + 1);
      },
      'confirm:previousField': () => {
        this.syncOtherDraft(questionIdx);
        this.editingOther = false;
        this.gotoTab(this.currentTab - 1);
      },
    };
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.onAnswer({ answers: [] });
      return;
    }
    if (
      keyId === undefined
        ? this.nestedKeybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.nestedKeybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.syncOtherDraft(questionIdx);
      this.editingOther = false;
      this.moveQuestionCursor(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.syncOtherDraft(questionIdx);
      this.editingOther = false;
      this.moveQuestionCursor(1);
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.onAnswer({ answers: [] });
      return;
    }

    this.otherInput.handleInput(data);
    this.syncOtherDraft(questionIdx);
    this.reviewMessage = undefined;
  }

  private handleNotesInput(data: string): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const cancelNotes = (): void => {
      this.syncNotesDraft(questionIdx);
      this.editingNotes = false;
    };
    const handlers: KeybindingHandlers = {
      'confirm:no': cancelNotes,
      'confirm:nextField': () => {
        this.syncNotesDraft(questionIdx);
        this.editingNotes = false;
        this.gotoTab(this.currentTab + 1);
      },
      'confirm:previousField': () => {
        this.syncNotesDraft(questionIdx);
        this.editingNotes = false;
        this.gotoTab(this.currentTab - 1);
      },
    };
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      cancelNotes();
      return;
    }
    if (
      keyId === undefined
        ? this.nestedKeybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.nestedKeybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.syncNotesDraft(questionIdx);
      this.editingNotes = false;
      return;
    }

    this.otherInput.handleInput(data);
    this.syncNotesDraft(questionIdx);
    this.reviewMessage = undefined;
  }

  private handlers(): KeybindingHandlers {
    return {
      'confirm:yes': () => {
        if (this.isSubmitTab()) this.executeSubmitAction(this.submitActionIdx, 'enter');
        else this.activateQuestionOption(this.currentCursor(), 'enter');
      },
      'confirm:no': () => this.onAnswer({ answers: [] }),
      'confirm:previous': () => {
        if (this.isSubmitTab()) {
          this.submitActionIdx =
            (this.submitActionIdx - 1 + SUBMIT_ACTIONS.length) % SUBMIT_ACTIONS.length;
          this.reviewMessage = undefined;
        } else {
          this.moveQuestionCursor(-1);
        }
      },
      'confirm:next': () => {
        if (this.isSubmitTab()) {
          this.submitActionIdx = (this.submitActionIdx + 1) % SUBMIT_ACTIONS.length;
          this.reviewMessage = undefined;
        } else {
          this.moveQuestionCursor(1);
        }
      },
      'confirm:nextField': () => this.gotoTab(this.currentTab + 1),
      'confirm:previousField': () => this.gotoTab(this.currentTab - 1),
      'confirm:toggle': () => {
        if (!this.isSubmitTab() && this.request.data.questions[this.currentTab]?.multi_select === true) {
          this.activateQuestionOption(this.currentCursor(), 'space');
        }
      },
      'confirm:toggleExplanation': () => {
        if (!this.isSubmitTab() && this.hasPreview(this.currentTab)) this.enterNotesInput(this.currentTab);
      },
    };
  }

  // ── State mutation ────────────────────────────────────────────────

  private gotoTab(target: number): void {
    const total = this.totalTabs();
    if (total <= 0) return;

    const wrapped = ((target % total) + total) % total;
    if (wrapped === this.currentTab) return;

    this.currentTab = wrapped;
    this.editingOther = false;
    this.editingNotes = false;
    this.reviewMessage = undefined;
    if (this.isSubmitTab()) this.submitActionIdx = 0;
  }

  private moveQuestionCursor(delta: number): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const total = this.displayOptions(questionIdx).length;
    if (total <= 0) return;

    this.cursors[questionIdx] = (this.currentCursor() + delta + total) % total;
    this.reviewMessage = undefined;
  }

  private activateQuestionOption(optionIdx: number, method: QuestionSubmissionMethod): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    this.cursors[questionIdx] = optionIdx;
    this.editingOther = false;
    this.reviewMessage = undefined;

    if (this.isOtherOption(questionIdx, optionIdx)) {
      // Toggling a committed "Other" answer deselects it (multi-select only);
      // Enter always (re)opens the custom input.
      const set = this.multiSelections[questionIdx];
      if (question.multi_select && method !== 'enter' && set?.has(optionIdx) === true) {
        set.delete(optionIdx);
        this.lastAnswerMethod = method;
        this.updateAnswer(questionIdx);
        return;
      }
      this.enterOtherInput(questionIdx);
      return;
    }

    if (question.multi_select) {
      const set = this.multiSelections[questionIdx];
      if (set === undefined) return;
      if (set.has(optionIdx)) set.delete(optionIdx);
      else set.add(optionIdx);
      this.lastAnswerMethod = method;
      this.updateAnswer(questionIdx);
      return;
    }

    this.singleSelections[questionIdx] = optionIdx;
    this.committedOtherValues[questionIdx] = undefined;
    this.lastAnswerMethod = method;
    this.updateAnswer(questionIdx);
    this.advanceAfterSingleSelect(questionIdx);
  }

  private enterOtherInput(questionIdx: number): void {
    this.cursors[questionIdx] = this.otherOptionIndex(questionIdx);
    this.editingOther = true;
    this.otherInput.setValue(this.otherDraftValue(questionIdx));
    this.reviewMessage = undefined;
  }

  private enterNotesInput(questionIdx: number): void {
    this.editingNotes = true;
    this.otherInput.setValue(this.noteDrafts[questionIdx] ?? '');
    this.reviewMessage = undefined;
  }

  private commitOtherInput(rawValue: string | undefined, method: QuestionSubmissionMethod): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;

    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    const value = (rawValue ?? this.otherInput.getValue()).trim();
    if (value.length === 0) return;

    this.otherInput.setValue(value);
    this.otherDrafts[questionIdx] = value;
    this.committedOtherValues[questionIdx] = value;

    if (question.multi_select) {
      this.multiSelections[questionIdx]?.add(this.otherOptionIndex(questionIdx));
    } else {
      this.singleSelections[questionIdx] = this.otherOptionIndex(questionIdx);
    }

    this.lastAnswerMethod = method;
    this.updateAnswer(questionIdx);
    this.editingOther = false;
    this.reviewMessage = undefined;

    if (!question.multi_select) this.advanceAfterSingleSelect(questionIdx);
  }

  private commitNotesInput(rawValue: string | undefined): void {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return;
    this.noteDrafts[questionIdx] = rawValue ?? this.otherInput.getValue();
    this.editingNotes = false;
    this.reviewMessage = undefined;
  }

  private advanceAfterSingleSelect(questionIdx: number): void {
    const next = this.findNextUnansweredAfter(questionIdx);
    this.currentTab = next ?? this.submitTabIndex();
    this.reviewMessage = undefined;
    if (this.isSubmitTab()) this.submitActionIdx = 0;
  }

  private findNextUnansweredAfter(fromIdx: number): number | null {
    const total = this.request.data.questions.length;
    for (let idx = fromIdx + 1; idx < total; idx++) {
      if (!this.isAnswered(idx)) return idx;
    }
    return null;
  }

  private updateAnswer(questionIdx: number): void {
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return;

    if (question.multi_select) {
      const labels: string[] = [];
      const set = this.multiSelections[questionIdx] ?? new Set<number>();
      const otherIdx = this.otherOptionIndex(questionIdx);
      for (let i = 0; i < question.options.length; i++) {
        if (!set.has(i)) continue;
        const label = question.options[i]?.label;
        if (label !== undefined && label.length > 0) labels.push(label);
      }
      const otherText = this.committedOtherValues[questionIdx];
      if (set.has(otherIdx) && otherText !== undefined && otherText.length > 0) {
        labels.push(otherText);
      }
      this.answers[questionIdx] = labels.length > 0 ? labels.join(', ') : undefined;
      return;
    }

    const selection = this.singleSelections[questionIdx];
    if (selection === undefined) {
      this.answers[questionIdx] = undefined;
      return;
    }

    if (this.isOtherOption(questionIdx, selection)) {
      const otherText = this.committedOtherValues[questionIdx];
      this.answers[questionIdx] =
        otherText !== undefined && otherText.length > 0 ? otherText : undefined;
      return;
    }

    const label = question.options[selection]?.label;
    this.answers[questionIdx] = label !== undefined && label.length > 0 ? label : undefined;
  }

  private executeSubmitAction(actionIdx: number, method: QuestionSubmissionMethod): void {
    if (actionIdx === 1) {
      this.onAnswer({ answers: [] });
      return;
    }

    this.reviewMessage = undefined;
    this.emitAnswers(method);
  }

  private emitAnswers(method: QuestionSubmissionMethod): void {
    const out: string[] = [];
    const annotations: Record<string, { preview?: string; notes?: string }> = {};
    for (let i = 0; i < this.answers.length; i++) {
      const answer = this.answers[i];
      if (answer !== undefined && answer.length > 0) out[i] = answer;

      const question = this.request.data.questions[i];
      if (question === undefined) continue;
      const selection = this.singleSelections[i];
      const preview =
        selection === undefined ? undefined : question.options[selection]?.preview;
      const notes = this.noteDrafts[i]?.trim();
      if ((preview !== undefined && preview.length > 0) || (notes !== undefined && notes.length > 0)) {
        annotations[question.question] = {
          preview,
          notes: notes?.length ? notes : undefined,
        };
      }
    }
    this.onAnswer({
      answers: out,
      method: this.lastAnswerMethod ?? method,
      annotations: Object.keys(annotations).length > 0 ? annotations : undefined,
    });
  }

  // ── Render ────────────────────────────────────────────────────────

  override render(width: number): string[] {
    this.otherInput.focused =
      this.focused && (this.isEditingOther() || this.isEditingNotes());
    return this.isSubmitTab() ? this.renderSubmitTab(width) : this.renderQuestionTab(width);
  }

  private renderQuestionTab(width: number): string[] {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return this.renderSubmitTab(width);

    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return [];

    const accent = (text: string) => currentTheme.fg('primary', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const success = (text: string) => currentTheme.fg('success', text);

    const renderWidth = Math.max(1, width);
    const lines: string[] = [accent('─'.repeat(renderWidth)), currentTheme.boldFg('primary', ' question'), ''];
    this.pushTabs(lines);
    lines.push('');

    appendWrapped(lines, ' ? ', '   ', question.question, renderWidth, accent);
    if (this.isEditingOther()) {
      lines.push(dim('   Type your answer, then press Enter to save.'));
    }

    if (question.body !== undefined && question.body.trim().length > 0) {
      lines.push('');
      const bodyLines = question.body.trim().split('\n');
      const visibleBodyLines = bodyLines.slice(0, MAX_BODY_LINES);
      for (const bodyLine of visibleBodyLines) {
        appendWrapped(lines, '   ', '   ', bodyLine, renderWidth, dim);
      }
      if (bodyLines.length > visibleBodyLines.length) {
        lines.push(dim(`   ... ${String(bodyLines.length - visibleBodyLines.length)} more lines`));
      }
    }

    lines.push('');

    const options = this.displayOptions(questionIdx);
    const cursor = this.currentCursor();
    const visibleStart = this.computeVisibleStart(cursor, options.length);
    const visibleEnd = Math.min(options.length, visibleStart + this.maxVisibleOptions);
    const multiSet = this.multiSelections[questionIdx] ?? new Set<number>();
    const singleSelection = this.singleSelections[questionIdx];

    const previewMode = this.hasPreview(questionIdx);
    const splitPreview = previewMode && renderWidth >= PREVIEW_SPLIT_MIN_WIDTH;
    const optionWidth = splitPreview
      ? Math.max(24, Math.floor((renderWidth - 2) * 0.4))
      : renderWidth;
    const optionLines: string[] = [];

    for (let i = visibleStart; i < visibleEnd; i++) {
      const option = options[i];
      if (option === undefined) continue;
      const num = i + 1;
      const isCursor = i === cursor;
      const isOther = option.kind === 'other';
      const isSelected = question.multi_select ? multiSet.has(i) : singleSelection === i;

      if (this.isEditingOther() && isCursor && isOther) {
        optionLines.push(
          this.renderEditingOtherLine(optionWidth, questionIdx, option, num, isSelected),
        );
        continue;
      }

      const label = this.renderOptionLabel(questionIdx, option, isCursor);

      let tone: (s: string) => string;
      let prefix: string;
      if (question.multi_select) {
        const checked = isSelected ? '✓' : ' ';
        prefix = `  [${checked}] `;
        if (isSelected && isCursor) tone = (s) => currentTheme.boldFg('success', s);
        else if (isSelected) tone = success;
        else if (isCursor) tone = accent;
        else tone = dim;
      } else if (isSelected && this.isAnswered(questionIdx)) {
        prefix = isCursor ? `  → [${String(num)}] ` : `    [${String(num)}] `;
        tone = isCursor ? (s) => currentTheme.boldFg('success', s) : success;
      } else if (isCursor) {
        prefix = `  → [${String(num)}] `;
        tone = accent;
      } else {
        prefix = `    [${String(num)}] `;
        tone = dim;
      }
      const continuation = ' '.repeat(visibleWidth(prefix));
      appendWrapped(optionLines, prefix, continuation, label, optionWidth, tone);

      if (
        option.description !== undefined &&
        option.description.length > 0 &&
        !(this.isEditingOther() && isCursor && isOther)
      ) {
        appendWrapped(optionLines, '        ', '        ', option.description, optionWidth, dim);
      }
    }

    if (visibleEnd < options.length || visibleStart > 0) {
      optionLines.push(
        dim(
          `   showing ${String(visibleStart + 1)}-${String(visibleEnd)} of ${String(options.length)}`,
        ),
      );
    }

    if (previewMode) {
      const content = options[cursor]?.preview?.trim() || 'No preview for this option.';
      if (splitPreview) {
        const previewWidth = renderWidth - optionWidth - 2;
        lines.push(
          ...joinColumns(
            optionLines,
            renderPreviewBox(content, previewWidth),
            optionWidth,
            previewWidth,
          ),
        );
      } else {
        lines.push(...optionLines, '', ...renderPreviewBox(content, renderWidth));
      }
    } else {
      lines.push(...optionLines);
    }

    if (previewMode) {
      const notes = this.noteDrafts[questionIdx] ?? '';
      lines.push('');
      if (this.isEditingNotes()) {
        const inputLine = this.otherInput.render(Math.max(4, renderWidth - 10))[0] ?? '> ';
        lines.push(`${accent(' Notes: ')}${inputLine.startsWith('> ') ? inputLine.slice(2) : inputLine}`);
      } else if (notes.trim().length > 0) {
        lines.push(`${accent(' Notes: ')}${notes.trim()}`);
      } else {
        const nAction = this.bindings.findLast(
          (binding) =>
            binding.context === 'Confirmation' &&
            binding.chord.length === 1 &&
            binding.chord[0] === 'n',
        )?.action;
        if (
          nAction === undefined ||
          nAction === null ||
          nAction === 'confirm:no' ||
          this.handlers()[nAction] === undefined
        ) {
          lines.push(`${accent(' Notes: ')}${dim('press n to add notes')}`);
        }
      }
    }

    lines.push('', this.buildQuestionHint(dim, questionIdx), accent('─'.repeat(renderWidth)));

    return lines.map((line) => truncateToWidth(line, width));
  }

  private renderSubmitTab(width: number): string[] {
    const accent = (text: string) => currentTheme.fg('primary', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const text = (t: string) => currentTheme.fg('text', t);
    const warning = (text: string) => currentTheme.fg('warning', text);

    const renderWidth = Math.max(1, width);
    const lines: string[] = [accent('─'.repeat(renderWidth)), currentTheme.boldFg('primary', ' question'), ''];
    this.pushTabs(lines);
    lines.push('', currentTheme.boldFg('text', ` ${REVIEW_TITLE}`));
    const reviewWarning =
      this.reviewMessage ?? (this.hasUnansweredQuestions() ? UNANSWERED_WARNING : undefined);
    if (reviewWarning !== undefined) {
      lines.push(warning(`  ${reviewWarning}`));
    }
    lines.push('');

    for (let i = 0; i < this.request.data.questions.length; i++) {
      const question = this.request.data.questions[i];
      if (question === undefined) continue;
      const answer = this.answers[i];
      appendWrapped(
        lines,
        `  ${dim('Q')}  `,
        '       ',
        question.question,
        renderWidth,
      );
      if (answer !== undefined && answer.length > 0) {
        appendWrapped(
          lines,
          `  ${accent('→')}  `,
          '       ',
          text(answer),
          renderWidth,
        );
      } else {
        lines.push(`  ${dim('→')}  ${dim(NOT_ANSWERED_LABEL)}`);
      }
    }

    lines.push('', text(` ${SUBMIT_PROMPT}`), '');

    for (let i = 0; i < SUBMIT_ACTIONS.length; i++) {
      const label = SUBMIT_ACTIONS[i];
      if (label === undefined) continue;
      const num = i + 1;
      if (i === this.submitActionIdx) {
        lines.push(accent(`  → [${String(num)}] ${label}`));
      } else {
        lines.push(dim(`    [${String(num)}] ${label}`));
      }
    }

    lines.push('', this.buildSubmitHint(dim), accent('─'.repeat(renderWidth)));

    return lines.map((line) => truncateToWidth(line, width));
  }

  private pushTabs(lines: string[]): void {
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const active = (text: string) =>
      currentTheme.bg('selectionBg', currentTheme.boldFg('inverseText', text));

    const tabs: string[] = [];
    for (let i = 0; i < this.request.data.questions.length; i++) {
      const question = this.request.data.questions[i];
      if (question === undefined) continue;
      const label =
        question.header !== undefined && question.header.length > 0
          ? question.header
          : `Q${String(i + 1)}`;
      if (i === this.currentTab) tabs.push(active(` ${label} `));
      else if (this.isAnswered(i)) tabs.push(currentTheme.fg('success', `(✓) ${label}`));
      else tabs.push(dim(`(○) ${label}`));
    }

    const submitLabel = 'Submit';
    if (this.isSubmitTab()) tabs.push(active(` ${submitLabel} `));
    else tabs.push(dim(` ${submitLabel} `));

    lines.push(` ${tabs.join('  ')}`);
  }

  private buildQuestionHint(dim: (s: string) => string, questionIdx: number): string {
    if (this.isEditingNotes()) {
      const field = combinedBindingHint(
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previousField'),
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:nextField'),
        'switch',
      );
      const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
      const parts = [
        'type notes',
        '↵ save',
        this.totalTabs() > 1 ? field : undefined,
        cancel === undefined ? undefined : `${formatBindingKeys(cancel)} return`,
      ].filter((part): part is string => part !== undefined);
      return dim(`  ${parts.join('  ')}`);
    }

    if (this.isEditingOther()) {
      const field = combinedBindingHint(
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previousField'),
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:nextField'),
        'switch',
      );
      const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
      const parts = [
        'type answer',
        '↵ save',
        this.totalTabs() > 1 ? field : undefined,
        cancel === undefined ? undefined : `${formatBindingKeys(cancel)} cancel`,
      ].filter((part): part is string => part !== undefined);
      return dim(`  ${parts.join('  ')}`);
    }

    const optionCount = Math.min(this.displayOptions(questionIdx).length, NUMBER_KEYS.length);
    const numberHint = optionCount <= 1 ? '1' : `1-${String(optionCount)}`;
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return dim('  esc cancel');

    const navigation = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previous'),
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:next'),
      'select',
    );
    const confirm = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:yes');
    const field = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previousField'),
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:nextField'),
      'switch',
    );
    const explain = keybindingDisplayText(
      this.bindings,
      'Confirmation',
      'confirm:toggleExplanation',
    );
    const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
    const parts = [
      navigation,
      `${numberHint}${confirm === undefined ? '' : ` / ${formatBindingKeys(confirm)}`} ${question.multi_select ? 'toggle' : 'choose'}`,
      this.totalTabs() > 1 ? field : undefined,
      this.hasPreview(questionIdx) && explain !== undefined
        ? `${formatBindingKeys(explain)} notes`
        : undefined,
      cancel === undefined ? undefined : `${formatBindingKeys(cancel)} cancel`,
    ].filter((part): part is string => part !== undefined);
    return dim(`  ${parts.join('  ')}`);
  }

  private buildSubmitHint(dim: (s: string) => string): string {
    const navigation = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previous'),
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:next'),
      'select',
    );
    const confirm = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:yes');
    const field = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previousField'),
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:nextField'),
      'switch',
    );
    const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
    const parts = [
      navigation,
      '1/2 choose',
      confirm === undefined ? undefined : `${formatBindingKeys(confirm)} confirm`,
      this.totalTabs() > 1 ? field : undefined,
      cancel === undefined ? undefined : `${formatBindingKeys(cancel)} cancel`,
    ].filter((part): part is string => part !== undefined);
    return dim(`  ${parts.join('  ')}`);
  }

  private computeVisibleStart(cursor: number, total: number): number {
    if (total <= this.maxVisibleOptions) return 0;
    const half = Math.floor(this.maxVisibleOptions / 2);
    const max = Math.max(0, total - this.maxVisibleOptions);
    return Math.max(0, Math.min(cursor - half, max));
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private totalTabs(): number {
    return this.request.data.questions.length + 1;
  }

  private submitTabIndex(): number {
    return this.request.data.questions.length;
  }

  private isSubmitTab(): boolean {
    return this.currentTab === this.submitTabIndex();
  }

  private isEditingOther(): boolean {
    return this.editingOther && !this.isSubmitTab();
  }

  private isEditingNotes(): boolean {
    return this.editingNotes && !this.isSubmitTab();
  }

  private currentQuestionIndex(): number | undefined {
    return this.isSubmitTab() ? undefined : this.currentTab;
  }

  private currentCursor(): number {
    const questionIdx = this.currentQuestionIndex();
    if (questionIdx === undefined) return 0;
    return this.cursors[questionIdx] ?? 0;
  }

  private displayOptions(questionIdx: number): DisplayOption[] {
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return [];

    return [
      ...question.options.map((option) => ({
        label: option.label,
        description: option.description,
        preview: option.preview,
        kind: 'preset' as const,
      })),
      ...(question.allow_other === false || this.hasPreview(questionIdx)
        ? []
        : [
            {
              label: question.other_label?.length ? question.other_label : DEFAULT_OTHER_LABEL,
              description: question.other_description?.length
                ? question.other_description
                : undefined,
              kind: 'other' as const,
            },
          ]),
    ];
  }

  private otherOptionIndex(questionIdx: number): number {
    return this.request.data.questions[questionIdx]?.options.length ?? 0;
  }

  private isOtherOption(questionIdx: number, optionIdx: number): boolean {
    return optionIdx === this.otherOptionIndex(questionIdx);
  }

  private renderOptionLabel(questionIdx: number, option: DisplayOption, isCursor: boolean): string {
    if (option.kind !== 'other') return option.label;

    const value = this.otherDraftValue(questionIdx);
    if (this.isEditingOther() && isCursor) {
      return `${option.label}: ${value ?? ''}█`;
    }
    if (value !== undefined && value.length > 0) return `${option.label}: ${value}`;
    return option.label;
  }

  private renderEditingOtherLine(
    width: number,
    questionIdx: number,
    option: DisplayOption,
    num: number,
    isSelected: boolean,
  ): string {
    const question = this.request.data.questions[questionIdx];
    if (question === undefined) return option.label;

    let prefix: string;
    if (question.multi_select) {
      const checked = isSelected ? '✓' : ' ';
      const body = `  [${checked}] ${option.label}: `;
      prefix = isSelected
        ? currentTheme.boldFg('success', body)
        : currentTheme.fg('primary', body);
    } else {
      const body = `  → [${String(num)}] ${option.label}: `;
      prefix =
        isSelected && this.isAnswered(questionIdx)
          ? currentTheme.boldFg('success', body)
          : currentTheme.fg('primary', body);
    }

    const inputWidth = Math.max(4, width - visibleWidth(prefix) + 2);
    const inputLine = this.otherInput.render(inputWidth)[0] ?? '> ';
    const inlineInput = inputLine.startsWith('> ') ? inputLine.slice(2) : inputLine;
    return prefix + inlineInput;
  }

  private otherDraftValue(questionIdx: number): string {
    return (this.otherDrafts[questionIdx] ?? this.committedOtherValues[questionIdx]) ?? '';
  }

  private syncOtherDraft(questionIdx: number): void {
    this.otherDrafts[questionIdx] = this.otherInput.getValue();
  }

  private syncNotesDraft(questionIdx: number): void {
    this.noteDrafts[questionIdx] = this.otherInput.getValue();
  }

  private hasPreview(questionIdx: number): boolean {
    return this.request.data.questions[questionIdx]?.options.some(
      (option) => option.preview !== undefined && option.preview.trim().length > 0,
    ) ?? false;
  }

  private isAnswered(questionIdx: number): boolean {
    const answer = this.answers[questionIdx];
    return answer !== undefined && answer.length > 0;
  }

  private hasUnansweredQuestions(): boolean {
    for (let i = 0; i < this.request.data.questions.length; i++) {
      if (!this.isAnswered(i)) return true;
    }
    return false;
  }

  override invalidate(): void {
    super.invalidate();
    this.otherInput.invalidate();
  }
}
