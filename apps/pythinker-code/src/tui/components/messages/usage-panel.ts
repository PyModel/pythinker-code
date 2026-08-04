/**
 * UsagePanelComponent — wraps pre-coloured `/usage` lines in a blue box
 * border with a left indent, mirroring the PlanBoxComponent layout so
 * the pattern stays consistent across command-triggered panels.
 */

import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type {
  ContextUsageReport,
  ModelCostRates,
  SessionUsage,
  TokenUsage,
} from '@pythoughts/pythinker-code-sdk';

import {
  formatTokenCount,
  ratioSeverity,
  renderProgressBar,
  safeUsageRatio,
  usagePercent,
} from '#/utils/usage/usage-format';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';

const LEFT_MARGIN = 2;
const SIDE_PADDING = 1;
const BOX_OVERHEAD = LEFT_MARGIN + 2 + 2 * SIDE_PADDING;
const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});
const COST_RATE_ROWS = [
  ['Input', 'input'],
  ['Output', 'output'],
  ['Cache read', 'cacheRead'],
  ['Cache write', 'cacheWrite'],
] as const satisfies readonly (readonly [string, keyof ModelCostRates])[];

type Colorize = (text: string) => string;

export interface ManagedUsageRow {
  readonly label: string;
  readonly used: number;
  readonly limit: number;
  readonly resetHint?: string;
}

export interface ManagedUsageReport {
  readonly summary: ManagedUsageRow | null;
  readonly limits: readonly ManagedUsageRow[];
}

export interface UsageReportOptions {
  readonly sessionUsage?: SessionUsage;
  readonly sessionUsageError?: string;
  readonly contextUsage: number;
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
}

export interface ManagedUsageReportLineOptions {
  readonly managedUsage?: ManagedUsageReport;
  readonly managedUsageError?: string;
}

export interface CostReportOptions {
  readonly model: string;
  readonly modelCostRates?: ModelCostRates;
  readonly totalCostUsd?: number;
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
  const byModel = (usage as { readonly byModel?: Record<string, TokenUsage> } | undefined)
    ?.byModel;
  const entries = Object.entries(byModel ?? {});
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

function buildManagedUsageSection(
  usage: ManagedUsageReport | undefined,
  error: string | undefined,
  accent: Colorize,
  value: Colorize,
  muted: Colorize,
  errorStyle: Colorize,
): string[] {
  if (error !== undefined) return [accent('Plan usage'), errorStyle(`  ${error}`)];
  if (usage === undefined) return [];
  const { summary, limits } = usage;
  if (summary === null && limits.length === 0) {
    return [accent('Plan usage'), muted('  No usage data available.')];
  }

  const rows: ManagedUsageRow[] = [];
  if (summary !== null) rows.push(summary);
  rows.push(...limits);
  const usedRatio = (r: ManagedUsageRow): number =>
    r.limit > 0 ? Math.max(0, Math.min(r.used / r.limit, 1)) : 0;
  const labelWidth = Math.max(10, ...rows.map((r) => r.label.length));
  const pctWidth = Math.max(...rows.map((r) => `${Math.round(usedRatio(r) * 100)}% used`.length));
  const severityColor = (sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';
  const out: string[] = [accent('Plan usage')];
  for (const row of rows) {
    const ratioUsed = usedRatio(row);
    const bar = renderProgressBar(ratioUsed, 20);
    const pct = `${Math.round(ratioUsed * 100)}% used`;
    const barColoured = currentTheme.fg(severityColor(ratioSeverity(ratioUsed)), bar);
    const label = row.label.padEnd(labelWidth, ' ');
    const resetStr = row.resetHint ? `  ${muted(row.resetHint)}` : '';
    out.push(`  ${muted(label)}  ${barColoured}  ${value(pct.padEnd(pctWidth, ' '))}${resetStr}`);
  }
  return out;
}

export function buildManagedUsageReportLines(options: ManagedUsageReportLineOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);

  return buildManagedUsageSection(
    options.managedUsage,
    options.managedUsageError,
    accent,
    value,
    muted,
    errorStyle,
  );
}

export function buildContextUsageReportLines(report: ContextUsageReport): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const maxTokens = report.maxTokens > 0 ? formatTokenCount(report.maxTokens) : 'unknown';
  const lines = [
    `${value(report.model ?? 'Model not configured')}  ${value(
      formatTokenCount(report.estimatedTokens),
    )} / ${value(maxTokens)} tokens (${value(`${String(report.percentage)}%`)})`,
    '',
    accent('Estimated usage by category'),
  ];
  const visibleCategories = report.categories.filter((category) => category.tokens > 0);
  const categoryWidth = Math.max(1, ...visibleCategories.map((category) => category.name.length));
  for (const category of visibleCategories) {
    lines.push(
      `  ${muted(category.name.padEnd(categoryWidth))}  ${value(
        formatTokenCount(category.tokens).padStart(6),
      )}  ${muted(`${String(category.percentage)}%`)}`,
    );
  }
  if (report.tools.length > 0) {
    const toolWidth = Math.max(...report.tools.map((tool) => tool.name.length));
    lines.push('', accent(`Active tools (${String(report.tools.length)})`));
    for (const tool of report.tools) {
      lines.push(
        `  ${muted(tool.name.padEnd(toolWidth))}  ${value(
          formatTokenCount(tool.tokens).padStart(6),
        )}  ${muted(tool.source)}`,
      );
    }
  }
  return lines;
}

export function buildCostReportLines(options: CostReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const spend = options.totalCostUsd;
  const spendText =
    spend !== undefined && Number.isFinite(spend) && spend >= 0
      ? value(formatUsdAmount(spend))
      : muted('unavailable');
  const model = options.model.trim() || 'Not configured';
  const lines = [
    `${muted('Session spend')}  ${spendText}`,
    `${muted('Current model')}  ${value(model)}`,
    '',
    accent('Rates per 1M tokens'),
  ];

  const rates: Array<readonly [string, number]> = [];
  for (const [label, key] of COST_RATE_ROWS) {
    const rate = options.modelCostRates?.[key];
    if (rate !== undefined && Number.isFinite(rate) && rate >= 0) {
      rates.push([label, rate]);
    }
  }
  if (rates.length === 0) {
    lines.push(muted('  Pricing unavailable for this model.'));
    return lines;
  }

  const labelWidth = Math.max(...rates.map(([label]) => label.length));
  for (const [label, rate] of rates) {
    lines.push(
      `  ${muted(label.padEnd(labelWidth))}  ${value(`${formatUsdAmount(rate)} / 1M tokens`)}`,
    );
  }
  return lines;
}

function formatUsdAmount(amount: number): string {
  if (amount > 0 && amount < 0.000001) return '<$0.000001';
  return USD_FORMATTER.format(amount);
}

export function buildUsageReportLines(options: UsageReportOptions): string[] {
  const accent = (text: string) => currentTheme.boldFg('primary', text);
  const value = (text: string) => currentTheme.fg('text', text);
  const muted = (text: string) => currentTheme.fg('textDim', text);
  const errorStyle = (text: string) => currentTheme.fg('error', text);
  const severityColor = (sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' =>
    sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';

  const lines: string[] = [
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
    const bar = renderProgressBar(ratio, 20);
    const pct = `${String(usagePercent(options.contextTokens, options.maxContextTokens))}%`;
    const barColoured = currentTheme.fg(severityColor(ratioSeverity(ratio)), bar);
    lines.push('');
    lines.push(accent('Context window'));
    lines.push(
      `  ${barColoured}  ${value(pct.padStart(6, ' '))}  ` +
        muted(
          `(${formatTokenCount(options.contextTokens)} / ${formatTokenCount(
            options.maxContextTokens,
          )})`,
        ),
    );
  }

  const managedSection = buildManagedUsageReportLines({
    managedUsage: options.managedUsage,
    managedUsageError: options.managedUsageError,
  });
  if (managedSection.length > 0) {
    lines.push('');
    lines.push(...managedSection);
  }

  return lines;
}

export class UsagePanelComponent implements Component {
  /** Cached coloured lines; rebuilt from `buildLines` on every invalidate. */
  private lines: readonly string[];

  constructor(
    private readonly buildLines: () => readonly string[],
    private readonly borderToken: ColorToken,
    private readonly title: string = ' Usage ',
  ) {
    this.lines = buildLines();
  }

  invalidate(): void {
    // Report bodies embed palette colours, so a theme switch must re-run the
    // builder to repaint the cached lines (the data itself is captured).
    this.lines = this.buildLines();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    const paint = (s: string): string => currentTheme.fg(this.borderToken, s);
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
    const horzLen = contentWidth + 2 * SIDE_PADDING;
    const title = truncateToWidth(this.title, horzLen, '…');

    const trailingDashLen = Math.max(0, horzLen - visibleWidth(title));
    const top =
      indent + paint('╭') + paint(title) + paint('─'.repeat(trailingDashLen)) + paint('╮');
    const bottom = indent + paint('╰' + '─'.repeat(horzLen) + '╯');

    const out: string[] = [top];
    for (const line of this.lines) {
      const clipped = visibleWidth(line) > contentWidth ? truncateToWidth(line, contentWidth) : line;
      const pad = Math.max(0, contentWidth - visibleWidth(clipped));
      out.push(indent + paint('│') + ' ' + clipped + ' '.repeat(pad) + ' ' + paint('│'));
    }
    out.push(bottom);
    return out.map((line) => truncateToWidth(line, safeWidth, '…'));
  }
}
