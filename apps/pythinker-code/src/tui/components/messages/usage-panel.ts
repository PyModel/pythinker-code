import type { Component } from '@pymodel/pi-tui';
import { truncateToWidth, visibleWidth } from '@pymodel/pi-tui';
import type { SessionUsage, TokenUsage } from '@pymodel/pythinker-code-sdk';

import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  formatTokenCount,
  ratioSeverity,
  renderProgressBar,
  safeUsageRatio,
  usagePercent,
} from '#/utils/usage/usage-format';

const LEFT_MARGIN = 2;
const SIDE_PADDING = 1;
const BOX_OVERHEAD = LEFT_MARGIN + 2 + 2 * SIDE_PADDING;

type Colorize = (text: string) => string;

export interface UsageReportOptions {
  readonly sessionUsage?: SessionUsage;
  readonly sessionUsageError?: string;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function usageInputTotal(usage: TokenUsage): number {
  return (
    usageNumber(usage.inputOther) +
    usageNumber(usage.inputCacheRead) +
    usageNumber(usage.inputCacheCreation)
  );
}

function buildSessionUsageSection(
  usage: SessionUsage | undefined,
  error: string | undefined,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (error !== undefined) return [errorStyle(`  ${error}`)];
  const entries = Object.entries(usage?.byModel ?? {});
  if (entries.length === 0) return [muted('  No token usage recorded yet.')];

  const lines: string[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  for (const [model, row] of entries) {
    const input = usageInputTotal(row);
    const output = usageNumber(row.output);
    totalInput += input;
    totalOutput += output;
    lines.push(
      `  ${muted(model)}  input ${value(formatTokenCount(input))}  output ${value(
        formatTokenCount(output),
      )}  total ${value(formatTokenCount(input + output))}`,
    );
  }
  if (entries.length > 1) {
    lines.push(
      `  ${muted('total')}  input ${value(formatTokenCount(totalInput))}  output ${value(
        formatTokenCount(totalOutput),
      )}  total ${value(formatTokenCount(totalInput + totalOutput))}`,
    );
  }
  return lines;
}

function severityColor(severity: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' {
  return severity === 'danger' ? 'error' : severity === 'warn' ? 'warning' : 'success';
}

export function buildUsageReportLines(options: UsageReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const lines = [
    accent('Session usage'),
    ...buildSessionUsageSection(
      options.sessionUsage,
      options.sessionUsageError,
      value,
      muted,
      errorStyle,
    ),
  ];

  if (options.maxContextTokens > 0) {
    const ratio = safeUsageRatio(options.contextUsage);
    const bar = currentTheme.fg(severityColor(ratioSeverity(ratio)), renderProgressBar(ratio, 20));
    const percent = `${String(usagePercent(options.contextTokens, options.maxContextTokens))}%`;
    lines.push(
      '',
      accent('Context window'),
      `  ${bar}  ${value(percent.padStart(6, ' '))}  ${muted(
        `(${formatTokenCount(options.contextTokens)} / ${formatTokenCount(options.maxContextTokens)})`,
      )}`,
    );
  }
  return lines;
}

export class UsagePanelComponent implements Component {
  private lines: readonly string[];

  constructor(
    private readonly buildLines: () => readonly string[],
    private readonly borderToken: ColorToken,
    private readonly title: string = ' Usage ',
  ) {
    this.lines = buildLines();
  }

  invalidate(): void {
    this.lines = this.buildLines();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const paint = (text: string): string => currentTheme.fg(this.borderToken, text);
    const availableInterior = safeWidth - BOX_OVERHEAD;
    if (availableInterior < 1) {
      return [
        truncateToWidth(this.title.trim(), safeWidth, '…'),
        ...this.lines.map((line) => truncateToWidth(line, safeWidth, '…')),
      ];
    }

    const indent = ' '.repeat(LEFT_MARGIN);
    const longestLine = this.lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
    const contentWidth = Math.max(
      1,
      Math.min(availableInterior, Math.max(longestLine, visibleWidth(this.title))),
    );
    const horizontalLength = contentWidth + 2 * SIDE_PADDING;
    const title = truncateToWidth(this.title, horizontalLength, '…');
    const top =
      indent +
      paint('╭') +
      paint(title) +
      paint('─'.repeat(Math.max(0, horizontalLength - visibleWidth(title)))) +
      paint('╮');
    const bottom = indent + paint(`╰${'─'.repeat(horizontalLength)}╯`);
    const output = [top];
    for (const line of this.lines) {
      const clipped = visibleWidth(line) > contentWidth ? truncateToWidth(line, contentWidth) : line;
      const padding = Math.max(0, contentWidth - visibleWidth(clipped));
      output.push(`${indent}${paint('│')} ${clipped}${' '.repeat(padding)} ${paint('│')}`);
    }
    output.push(bottom);
    return output.map((line) => truncateToWidth(line, safeWidth, '…'));
  }
}
