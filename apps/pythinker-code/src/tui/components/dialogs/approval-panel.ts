/**
 * ApprovalPanel — pi-tui version of the approval request UI.
 *
 * Container-based component with keyboard navigation.
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
import { currentTheme } from '#/tui/theme';
import { combinedBindingHint, formatBindingKeys } from '#/tui/components/dialogs/choice-picker';
import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { renderDiffLinesClustered } from '#/tui/components/media/diff-preview';
import type {
  ApprovalPanelChoice,
  DiffDisplayBlock,
  DisplayBlock,
  FileContentDisplayBlock,
  PendingApproval,
  WorkflowPlanDisplayBlock,
} from '#/tui/reverse-rpc/types';
import { printableChar } from '#/tui/utils/printable-key';

export interface ApprovalPanelResponse {
  readonly response: 'approved' | 'approved_for_session' | 'rejected' | 'cancelled';
  readonly feedback?: string | undefined;
  readonly selected_label?: string | undefined;
}

function truncateOneLine(text: string, max: number): string {
  const firstLine = text.split('\n')[0] ?? '';
  return firstLine.length > max ? firstLine.slice(0, max - 1) + '…' : firstLine;
}

const DIFF_SUMMARY_MAX_LINES = 10;
const CONTENT_SUMMARY_MAX_LINES = 10;

interface BlockStyles {
  strong: (s: string) => string;
  dim: (s: string) => string;
  accent: (s: string) => string;
  gutter: (s: string) => string;
  errorBold: (s: string) => string;
}

function makeBlockStyles(): BlockStyles {
  return {
    strong: (s) => currentTheme.fg('textStrong', s),
    dim: (s) => currentTheme.fg('textDim', s),
    accent: (s) => currentTheme.fg('accent', s),
    gutter: (s) => currentTheme.fg('diffGutter', s),
    errorBold: (s) => currentTheme.boldFg('error', s),
  };
}

function appendWrappedLine(
  lines: string[],
  firstPrefix: string,
  continuationPrefix: string,
  content: string,
  width: number,
): void {
  const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
  const wrapped = wrapTextWithAnsi(content, Math.max(1, width - prefixWidth));
  if (wrapped.length === 0) {
    lines.push(firstPrefix);
    return;
  }
  lines.push(`${firstPrefix}${wrapped[0] ?? ''}`);
  for (let i = 1; i < wrapped.length; i++) {
    lines.push(`${continuationPrefix}${wrapped[i] ?? ''}`);
  }
}

function renderShellDisplayBlock(
  block: Extract<DisplayBlock, { type: 'shell' }>,
  s: BlockStyles,
  width: number,
): string[] {
  const lines: string[] = [];
  if (block.cwd !== undefined && block.cwd.length > 0) {
    lines.push(s.dim(`cwd: ${block.cwd}`));
  }
  if (block.danger !== undefined) {
    lines.push(s.errorBold(`Dangerous: ${block.danger}`));
  }
  const cmdLines = block.command.length > 0 ? block.command.split('\n') : [''];
  cmdLines.forEach((cmdLine, idx) => {
    const prefix = idx === 0 ? `${s.accent('$')} ` : `${s.dim('·')} `;
    appendWrappedLine(lines, prefix, '  ', s.strong(cmdLine), width);
  });
  if (block.description !== undefined && block.description.length > 0) {
    lines.push(`  ${s.dim(block.description)}`);
  }
  return lines;
}

function renderDisplayBlock(
  block: DisplayBlock,
  s: BlockStyles,
  contentWidth: number,
): string[] {
  switch (block.type) {
    case 'diff':
      return renderDiffLinesClustered(block.old_text, block.new_text, block.path, {
        contextLines: 3,
        expandKeyHint: 'ctrl+e to preview',
        maxLines: DIFF_SUMMARY_MAX_LINES,
      });
    case 'file_content': {
      const lang = block.language ?? langFromPath(block.path);
      const allLines = highlightLines(block.content, lang);
      const shown = allLines.slice(0, CONTENT_SUMMARY_MAX_LINES);
      const lines = [s.strong(block.path)];
      for (const [i, line] of shown.entries()) {
        lines.push(s.gutter(String(i + 1).padStart(4) + '  ') + line);
      }
      const remaining = allLines.length - shown.length;
      if (remaining > 0) {
        lines.push(
          s.dim(
            `     … ${String(remaining)} more line${remaining > 1 ? 's' : ''} hidden (ctrl+e to preview)`,
          ),
        );
      }
      return lines;
    }
    case 'shell':
      return renderShellDisplayBlock(block, s, contentWidth);
    case 'file_op': {
      const op = s.accent(block.operation.padEnd(5));
      const lines = [`${op} ${s.strong(block.path)}`];
      if (block.detail !== undefined && block.detail.length > 0) {
        lines.push(s.dim(block.detail));
      }
      return lines;
    }
    case 'url_fetch': {
      const method = s.accent((block.method ?? 'GET').toUpperCase().padEnd(5));
      return [`${method} ${s.strong(block.url)}`];
    }
    case 'search': {
      const lines = [`${s.accent('search')} ${s.strong(block.query)}`];
      if (block.scope !== undefined && block.scope.length > 0) {
        lines.push(s.dim(`scope: ${block.scope}`));
      }
      return lines;
    }
    case 'invocation': {
      const lines = [`${s.accent(block.kind.padEnd(5))} ${s.strong(block.name)}`];
      if (block.description !== undefined && block.description.length > 0) {
        lines.push(s.dim(truncateOneLine(block.description, 200)));
      }
      return lines;
    }
    case 'workflow_plan':
      return renderWorkflowPlanDisplayBlock(block, s);
    case 'brief':
      return block.text
        ? block.text.split('\n').map((line) => (line.length > 0 ? s.strong(line) : ''))
        : [];
    case 'background_task':
      return [
        s.strong(`${block.status} ${block.kind} task ${block.task_id}: ${block.description}`),
      ];
    case 'todo':
      return block.items.map((item) => s.strong(`- [${item.status}] ${item.title}`));
    default:
      return [];
  }
}

/**
 * A workflow can carry up to 128 items. Listing all of them would push the
 * buttons off the screen, so the panel shows enough to judge the shape of the
 * fan-out and says how many it held back.
 */
const MAX_PREVIEW_ITEMS = 10;

function renderWorkflowPlanDisplayBlock(
  block: WorkflowPlanDisplayBlock,
  s: BlockStyles,
): string[] {
  const plural = block.agent_count === 1 ? 'subagent' : 'subagents';
  const summary = [
    `${String(block.agent_count)} ${plural}`,
    `~${String(block.prompt_tokens)} prompt tokens`,
  ];
  if (block.model !== undefined && block.model.length > 0) {
    summary.push(`model: ${block.model}`);
  }
  const lines = [s.strong(summary.join('  '))];

  if (block.prompt_template !== undefined && block.prompt_template.length > 0) {
    lines.push(`${s.accent('prompt')} ${s.dim(truncateOneLine(block.prompt_template, 200))}`);
  }

  for (const [index, item] of block.items.slice(0, MAX_PREVIEW_ITEMS).entries()) {
    lines.push(s.dim(`${String(index + 1).padStart(3)}. ${truncateOneLine(item, 120)}`));
  }
  const hidden = block.items.length - MAX_PREVIEW_ITEMS;
  if (hidden > 0) {
    lines.push(s.dim(`     +${String(hidden)} more`));
  }
  return lines;
}

function normalizeApprovalText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

function isDuplicateBriefBlock(block: DisplayBlock, description: string): boolean {
  if (block.type !== 'brief' || block.text.trim().length === 0) return false;
  const normalizedDescription = normalizeApprovalText(description);
  if (normalizedDescription.length === 0) return false;
  const normalizedBlockText = normalizeApprovalText(block.text);
  if (normalizedBlockText === normalizedDescription) return true;
  const blockLines = normalizedBlockText.split('\n');
  if (blockLines.length <= 1) return false;
  return normalizeApprovalText(blockLines.slice(1).join('\n')) === normalizedDescription;
}

function headerFor(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'Run this command?';
    case 'Write':
      return 'Write this file?';
    case 'Edit':
      return 'Apply these edits?';
    case 'TaskStop':
      return 'Stop this task?';
    case 'ExitPlanMode':
      return 'Ready to build with this plan?';
    case 'DynamicWorkflow':
      return 'Run this Dynamic Workflow?';
    default:
      return `Approve ${toolName}?`;
  }
}

export class ApprovalPanelComponent extends Container implements Focusable {
  focused = false;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver(
    this.bindings.filter(
      (binding) =>
        binding.action === 'confirm:yes' ||
        binding.action === 'confirm:no' ||
        binding.action === 'confirm:previous' ||
        binding.action === 'confirm:next' ||
        binding.action === 'confirm:toggle' ||
        binding.action === 'confirm:toggleExplanation',
    ),
  );
  private feedbackKeybindings = new KeybindingResolver(
    this.bindings.filter((binding) => binding.action === 'confirm:no'),
  );
  private selectedIndex = 0;
  private feedbackMode = false;
  private readonly feedbackInput = new Input();
  private onResponse: (response: ApprovalPanelResponse) => void;
  private request: PendingApproval;
  private readonly onToggleToolOutput: (() => void) | undefined;
  private readonly onOpenPreview:
    | ((block: DiffDisplayBlock | FileContentDisplayBlock) => void)
    | undefined;

  constructor(
    request: PendingApproval,
    onResponse: (response: ApprovalPanelResponse) => void,
    onToggleToolOutput?: () => void,
    onOpenPreview?: (block: DiffDisplayBlock | FileContentDisplayBlock) => void,
  ) {
    super();
    this.request = request;
    this.onResponse = onResponse;
    this.onToggleToolOutput = onToggleToolOutput;
    this.onOpenPreview = onOpenPreview;
    this.feedbackInput.onSubmit = (value) => {
      this.submit(this.selectedIndex, value);
    };
    this.feedbackInput.onEscape = () => {
      this.feedbackMode = false;
      this.feedbackInput.setValue('');
    };
  }

  private submit(index: number, feedback: string = ''): void {
    const option = this.choiceAt(index);
    if (!option) return;
    this.onResponse({
      response: option.response,
      feedback: feedback || undefined,
      selected_label: option.selected_label,
    });
  }

  private selectAndSubmit(index: number): void {
    const option = this.choiceAt(index);
    if (!option) return;
    if (option.requires_feedback === true) {
      this.selectedIndex = index;
      this.feedbackMode = true;
    } else {
      this.submit(index);
    }
  }

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
          binding.action === 'confirm:toggle' ||
          binding.action === 'confirm:toggleExplanation',
      ),
    );
    this.feedbackKeybindings = new KeybindingResolver(
      [...winners.values()].filter((binding) => binding.action === 'confirm:no'),
    );
  }

  handleInput(data: string): void {
    if (this.feedbackMode) {
      this.handleFeedbackInput(data);
      return;
    }

    const handlers = this.handlers();
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.onResponse({ response: 'rejected' });
      return;
    }
    if (
      keyId === undefined
        ? this.keybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.keybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.onResponse({ response: 'rejected' });
      return;
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      this.onToggleToolOutput?.();
      return;
    }
    const printable = printableChar(data);
    const numericIndex = Number(printable) - 1;
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < this.choiceCount()) {
      this.selectAndSubmit(numericIndex);
    }
  }

  private handleFeedbackInput(data: string): void {
    const keyId = parseKey(data);
    if (
      (keyId ?? data) === Key.escape &&
      keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no') === undefined
    ) {
      this.onResponse({ response: 'rejected' });
      return;
    }
    const handlers: KeybindingHandlers = {
      'confirm:no': () => this.onResponse({ response: 'rejected' }),
    };
    if (
      keyId === undefined
        ? this.feedbackKeybindings.dispatchKeyId(data, ['Confirmation'], handlers)
        : this.feedbackKeybindings.dispatch(data, ['Confirmation'], handlers)
    ) {
      return;
    }
    if (matchesKey(data, Key.ctrl('c')) || matchesKey(data, Key.ctrl('d'))) {
      this.onResponse({ response: 'rejected' });
      return;
    }
    this.feedbackInput.handleInput(data);
  }

  private handlers(): KeybindingHandlers {
    return {
      'confirm:yes': () => this.selectAndSubmit(this.selectedIndex),
      'confirm:no': () => this.onResponse({ response: 'rejected' }),
      'confirm:previous': () => {
        if (this.choiceCount() > 0) {
          this.selectedIndex = (this.selectedIndex - 1 + this.choiceCount()) % this.choiceCount();
        }
      },
      'confirm:next': () => {
        if (this.choiceCount() > 0) this.selectedIndex = (this.selectedIndex + 1) % this.choiceCount();
      },
      'confirm:toggle': () => this.selectAndSubmit(this.selectedIndex),
      'confirm:toggleExplanation': () => {
        const previewable = this.findPreviewableBlock();
        if (previewable !== undefined && this.onOpenPreview !== undefined) {
          this.onOpenPreview(previewable);
        }
      },
    };
  }

  override render(width: number): string[] {
    this.clear();
    this.ensureValidSelection();
    this.feedbackInput.focused = this.focused && this.feedbackMode;
    const { data } = this.request;
    const blockStyles = makeBlockStyles();
    const borderColor = (text: string) => currentTheme.fg('borderFocus', text);
    const borderColorBold = (text: string) => currentTheme.boldFg('borderFocus', text);
    const selectColorBold = (text: string) => currentTheme.boldFg('accent', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const strong = (text: string) => currentTheme.fg('textStrong', text);
    const horizontalBar = borderColor('─'.repeat(width));
    const indent = (s: string): string => `  ${s}`;

    const title = headerFor(data.tool_name);
    const lines: string[] = [
      horizontalBar,
      indent(`${borderColorBold('▶')} ${borderColorBold(title)}`),
    ];

    const dedupedBlocks = data.display.filter(
      (block) => !isDuplicateBriefBlock(block, data.description),
    );
    const visibleBlocks = dedupedBlocks.slice(0, 5);
    const hasPreviewable = visibleBlocks.some(
      (block) => block.type === 'diff' || block.type === 'file_content',
    );

    if (visibleBlocks.length > 0) {
      lines.push('');
      for (const block of visibleBlocks) {
        const blockLines = renderDisplayBlock(
          block,
          blockStyles,
          Math.max(1, width - 2),
        );
        for (const line of blockLines) {
          lines.push(indent(line));
        }
      }
    } else if (data.description) {
      lines.push('');
      for (const descLine of data.description.split('\n')) {
        lines.push(indent(dim(descLine)));
      }
    }

    lines.push('');
    for (let idx = 0; idx < data.choices.length; idx++) {
      const option = data.choices[idx];
      if (option === undefined) continue;
      const isSelected = idx === this.selectedIndex;
      const num = idx + 1;

      const labelWithNum = `${String(num)}. ${option.label}`;
      if (this.feedbackMode && option.requires_feedback === true && isSelected) {
        lines.push(indent(this.renderInlineFeedbackLine(width - 2, labelWithNum)));
      } else if (isSelected) {
        lines.push(indent(`${selectColorBold('▶')} ${selectColorBold(labelWithNum)}`));
      } else {
        lines.push(indent(strong(`  ${labelWithNum}`)));
      }
    }

    lines.push('');
    if (this.feedbackMode) {
      const cancel = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:no');
      const hint = [
        'Type feedback',
        '↵ submit',
        cancel === undefined ? undefined : `${formatBindingKeys(cancel)} reject`,
      ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');
      lines.push(indent(dim(`${hint}.`)));
    } else {
      const navigation = combinedBindingHint(
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:previous'),
        keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:next'),
        'select',
      );
      const confirm = keybindingDisplayText(this.bindings, 'Confirmation', 'confirm:yes');
      const preview = keybindingDisplayText(
        this.bindings,
        'Confirmation',
        'confirm:toggleExplanation',
      );
      const hint = [
        navigation,
        `${buildNumericHint(data.choices.length)} choose`,
        confirm === undefined ? undefined : `${formatBindingKeys(confirm)} confirm`,
        hasPreviewable && preview !== undefined ? `${formatBindingKeys(preview)} preview` : undefined,
      ]
        .filter((part): part is string => part !== undefined)
        .join(' · ');
      lines.push(
        indent(
          dim(hint),
        ),
      );
    }
    lines.push(horizontalBar);

    return lines.map((line) => truncateToWidth(line, width));
  }

  private findPreviewableBlock(): DiffDisplayBlock | FileContentDisplayBlock | undefined {
    for (const block of this.request.data.display) {
      if (block.type === 'diff' || block.type === 'file_content') return block;
    }
    return undefined;
  }

  private choiceAt(index: number): ApprovalPanelChoice | undefined {
    return this.request.data.choices[index];
  }

  private choiceCount(): number {
    return this.request.data.choices.length;
  }

  private ensureValidSelection(): void {
    const count = this.choiceCount();
    if (count === 0) {
      this.selectedIndex = 0;
      return;
    }
    if (this.selectedIndex < 0 || this.selectedIndex >= count) {
      this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, count - 1));
    }
  }

  private renderInlineFeedbackLine(width: number, labelWithNum: string): string {
    const prefix = `${currentTheme.boldFg('accent', '▶')} ${currentTheme.boldFg('accent', labelWithNum)}  `;
    const inputWidth = Math.max(4, width - visibleWidth(prefix) + 2);
    const inputLine = this.feedbackInput.render(inputWidth)[0] ?? '> ';
    const inlineInput = inputLine.startsWith('> ') ? inputLine.slice(2) : inputLine;
    return prefix + inlineInput;
  }

  override invalidate(): void {
    super.invalidate();
    this.feedbackInput.invalidate();
  }
}

function buildNumericHint(count: number): string {
  if (count <= 0) return '↵';
  return Array.from({ length: Math.min(count, 9) }, (_, idx) => String(idx + 1)).join('/');
}
