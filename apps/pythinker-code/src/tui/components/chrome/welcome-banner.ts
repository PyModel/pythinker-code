/**
 * Welcome banner layout — mirrors the Python shell `_print_welcome_info` design:
 * panel title + subtitle chip, robot mark, facts grid, and optional tips column.
 */

import { readFileSync } from 'node:fs';

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { gt, valid } from 'semver';
import chalk from 'chalk';

import { getUpdateStateFile } from '#/utils/paths';
import { createGitStatusCache, type GitStatusCache } from '#/utils/git/git-status';
import { currentTheme } from '#/tui/theme';
import type { AppState } from '#/tui/types';

import {
  PYTHINKER_LOGO_COLORS,
  renderPythinkerLogo,
} from './pythinker-logo';

const WELCOME_LABEL_WIDTH = 10;
const WELCOME_PANEL_CHROME_WIDTH = 4;
const WELCOME_COLUMNS_MIN_WIDTH = 84;
const WELCOME_LEFT_COLUMN_WIDTH = 52;
const WELCOME_LEFT_COLUMN_MAX_WIDTH = 64;
const WELCOME_TIPS_MIN_WIDTH = 24;
const WELCOME_COLUMNS_CHROME_WIDTH = 3;
const LOGO_STACKED_MIN_WIDTH = 68;

const ASCII_FALLBACKS: Record<string, string> = {
  '✦': '*',
  '↑': '^',
  '•': '*',
  '·': '-',
  '—': '-',
  '…': '~',
  '─': '-',
};

const WELCOME_TIPS = [
  'shift+tab cycles thinking effort, /plan toggles plan mode',
  '/model switches the active model',
  'ctrl+s steers the agent mid-turn',
  '/compact compacts the context window',
  'ctrl+o expands tool output',
  '/tasks lists background tasks',
  '@ mentions files in your prompt',
  '/help shows all slash commands',
] as const;

export type WelcomeInfoLevel = 'info' | 'warn' | 'error';

export interface WelcomeInfoItem {
  readonly name: string;
  readonly value: string;
  readonly level?: WelcomeInfoLevel;
}

export interface WelcomeBannerCopy {
  readonly head: string;
  readonly strapline: string;
  readonly prompt: string;
}

export interface RenderWelcomeBannerOptions {
  readonly width: number;
  readonly version: string;
  readonly infoItems: readonly WelcomeInfoItem[];
  readonly copy: WelcomeBannerCopy;
  readonly subtitleChip?: string | null;
  readonly logoLines?: readonly string[];
  readonly asciiMode?: boolean;
}

export function asciiGlyphsEnabled(): boolean {
  const term = process.env['TERM'] ?? '';
  return term === 'linux' || term === 'dumb';
}

function applyAsciiFallback(text: string): string {
  return text.replaceAll(/[✦↑•·—…─]/g, (char) => ASCII_FALLBACKS[char] ?? char);
}

function borderPaint(text: string): string {
  return chalk.hex(currentTheme.palette.border)(text);
}

function paintWithSlashAccent(text: string, baseHex: string, accentHex: string): string {
  const base = chalk.hex(baseHex);
  const accent = chalk.hex(accentHex);
  return text
    .split(/(\/[A-Za-z][A-Za-z0-9_-]*)/g)
    .map((part) => (part.startsWith('/') ? accent(part) : base(part)))
    .join('');
}

function padRight(text: string, targetWidth: number): string {
  const vis = visibleWidth(text);
  if (vis >= targetWidth) return text;
  return text + ' '.repeat(targetWidth - vis);
}

function takeCellsLeft(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  let used = 0;
  let out = '';
  for (const char of text) {
    const width = visibleWidth(char);
    if (used + width > maxWidth) break;
    out += char;
    used += width;
  }
  return out;
}

function takeCellsRight(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const chars = Array.from(text);
  let used = 0;
  const out: string[] = [];
  for (let index = chars.length - 1; index >= 0; index--) {
    const char = chars[index]!;
    const width = visibleWidth(char);
    if (used + width > maxWidth) break;
    out.unshift(char);
    used += width;
  }
  return out.join('');
}

function truncateMiddle(text: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return '';
  const cleaned = text.replaceAll('\r', ' ').replaceAll('\n', ' ');
  if (visibleWidth(cleaned) <= maxWidth) return cleaned;
  if (maxWidth <= 1) return truncateToWidth(cleaned, maxWidth, ellipsis);
  const leftWidth = Math.max(1, Math.floor((maxWidth - 1) / 2));
  const rightWidth = Math.max(1, maxWidth - 1 - leftWidth);
  return `${takeCellsLeft(cleaned, leftWidth)}${ellipsis}${takeCellsRight(cleaned, rightWidth)}`;
}

function wrapPlain(text: string, maxWidth: number): string[] {
  const cleaned = text.replaceAll('\r', ' ').replaceAll('\n', ' ').trim();
  if (!cleaned) return [''];
  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, '…');
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function valueStyleForLabel(label: string, level: WelcomeInfoLevel): string {
  const palette = currentTheme.palette;
  if (level === 'warn') return palette.warning;
  if (level === 'error') return palette.error;
  switch (label.trim()) {
    case 'Directory':
      return palette.accent;
    case 'Session':
      return palette.textDim;
    case 'Model':
      return palette.warning;
    case 'Branch':
      return palette.textDim;
    case 'Auto-save':
      return palette.textMuted;
    default:
      return palette.textDim;
  }
}

function formatWelcomeValue(
  label: string,
  value: string,
  maxWidth: number,
  ellipsis: string,
): string {
  const cleaned = value.replaceAll('\r', ' ').replaceAll('\n', ' ');
  if (['Directory', 'Auto-save', 'Session'].includes(label.trim())) {
    return truncateMiddle(cleaned, maxWidth, ellipsis);
  }
  return truncateToWidth(cleaned, maxWidth, ellipsis);
}

function renderFactsRows(items: readonly WelcomeInfoItem[], width: number, ellipsis: string): string[] {
  const labelWidth = Math.min(WELCOME_LABEL_WIDTH, Math.max(4, Math.floor(width / 3)));
  const valueWidth = Math.max(4, width - labelWidth - 2);
  const labelStyle = chalk.bold.hex(currentTheme.palette.textMuted);
  const rows: string[] = [];

  for (const item of items) {
    const level = item.level ?? 'info';
    const valueStyle = valueStyleForLabel(item.name, level);
    const value = formatWelcomeValue(item.name, item.value, valueWidth, ellipsis);
    const labelText = truncateToWidth(item.name, labelWidth, ellipsis);
    const label = labelStyle(
      ' '.repeat(Math.max(0, labelWidth - visibleWidth(labelText))) + labelText,
    );
    rows.push(`${label}  ${chalk.hex(valueStyle)(value)}`);
  }
  return rows;
}

function renderTipsBlock(
  tips: readonly WelcomeInfoItem[],
  width: number,
  withRule: boolean,
  asciiMode: boolean,
): string[] {
  const gutter = 2;
  const tipWidth = Math.max(4, width - gutter);
  const muted = chalk.hex(currentTheme.palette.textMuted);
  const accent = PYTHINKER_LOGO_COLORS.accent;
  const bullet = asciiMode ? '* ' : '• ';
  const lines: string[] = [muted('Tips')];

  if (withRule) {
    const ruleChar = asciiMode ? '-' : '─';
    lines.push(muted(ruleChar.repeat(tipWidth)));
  }

  for (const item of tips) {
    const wrapped = wrapPlain(item.value, tipWidth).map((line) =>
      truncateToWidth(line, tipWidth, asciiMode ? '~' : '…'),
    );
    for (let index = 0; index < wrapped.length; index++) {
      const prefix = index === 0 ? bullet : '  ';
      const level = item.level ?? 'info';
      const levelHex =
        level === 'warn'
          ? currentTheme.palette.warning
          : level === 'error'
            ? currentTheme.palette.error
            : currentTheme.palette.textDim;
      const styled = paintWithSlashAccent(wrapped[index]!, levelHex, accent);
      lines.push(`${muted(prefix)}${styled}`);
    }
  }
  return lines;
}

function centerBlock(lines: readonly string[], width: number): string[] {
  if (lines.length === 0) return [];
  const maxVis = Math.max(...lines.map((line) => visibleWidth(line)));
  const pad = Math.max(0, Math.floor((width - maxVis) / 2));
  const prefix = ' '.repeat(pad);
  return lines.map((line) => prefix + line);
}

function renderStackedLogoHeader(
  logoLines: readonly string[],
  copy: WelcomeBannerCopy,
  innerWidth: number,
  ellipsis: string,
  centerLogo: boolean,
): string[] {
  const copyLines = [copy.head, copy.strapline, copy.prompt];
  const lines: string[] = [];

  if (logoLines.length > 0) {
    lines.push(...(centerLogo ? centerBlock(logoLines, innerWidth) : logoLines), '');
  }

  lines.push(...copyLines.map((line) => truncateToWidth(line, innerWidth, ellipsis)));
  return lines;
}

function renderTwoColumns(
  leftLines: readonly string[],
  rightLines: readonly string[],
  leftWidth: number,
  rightWidth: number,
): string[] {
  const divider = chalk.hex(currentTheme.palette.border)(' │ ');
  const maxRows = Math.max(leftLines.length, rightLines.length);
  const rows: string[] = [];

  for (let row = 0; row < maxRows; row++) {
    const left = padRight(truncateToWidth(leftLines[row] ?? '', leftWidth, '…'), leftWidth);
    const right = padRight(truncateToWidth(rightLines[row] ?? '', rightWidth, '…'), rightWidth);
    rows.push(left + divider + right);
  }

  return rows;
}

function renderPanelTopBorder(title: string, subtitle: string | null, width: number): string {
  const inner = Math.max(0, width - 2);
  const titlePart = ` ${title} `;
  const titleWidth = visibleWidth(titlePart);

  if (!subtitle) {
    const dashCount = Math.max(0, inner - titleWidth);
    return borderPaint('╭') + titlePart + borderPaint('─'.repeat(dashCount)) + borderPaint('╮');
  }

  const subtitlePart = ` ${subtitle} `;
  const subtitleWidth = visibleWidth(subtitlePart);
  const dashCount = Math.max(1, inner - titleWidth - subtitleWidth);
  return (
    borderPaint('╭') +
    titlePart +
    borderPaint('─'.repeat(dashCount)) +
    subtitlePart +
    borderPaint('╮')
  );
}

export function buildWelcomeCopy(isLoggedOut: boolean): WelcomeBannerCopy {
  const palette = currentTheme.palette;
  const accent = PYTHINKER_LOGO_COLORS.accent;
  const head = chalk.bold.hex(palette.textStrong)('Welcome to Pythinker — think first, then code.');
  const strapline = chalk.hex(palette.textMuted)(
    'Review · Secure · Diagnose · Build with confidence.',
  );
  const promptText = isLoggedOut
    ? 'Run /login or /provider to get started.'
    : 'Type /help for commands.';
  const prompt = paintWithSlashAccent(promptText, palette.textMuted, accent);
  return { head, strapline, prompt };
}

export function buildWelcomeInfoItems(
  state: AppState,
  gitCache: GitStatusCache | null,
): WelcomeInfoItem[] {
  const isLoggedOut = !state.model;
  const activeModel = state.availableModels[state.model];
  const modelValue = isLoggedOut
    ? 'not set, run /login or /provider'
    : (activeModel?.displayName ?? activeModel?.model ?? state.model);

  const gitStatus = gitCache?.getStatus();
  const items: WelcomeInfoItem[] = [{ name: 'Directory', value: state.workDir }];
  if (gitStatus?.branch) {
    items.push({ name: 'Branch', value: gitStatus.branch });
  }

  items.push(
    {
      name: 'Model',
      value: modelValue,
      level: isLoggedOut ? 'warn' : 'info',
    },
    { name: 'Session', value: state.sessionId || 'pending' },
    { name: 'Auto-save', value: 'on' },
  );

  if (state.mcpServersSummary) {
    items.push({ name: 'MCP', value: state.mcpServersSummary });
  }

  return items;
}

export function buildWelcomeTips(): WelcomeInfoItem[] {
  return WELCOME_TIPS.map((value) => ({ name: 'Tip', value }));
}

export function readWelcomeUpdateTarget(currentVersion: string): string | null {
  try {
    const raw = readFileSync(getUpdateStateFile(), 'utf-8');
    const parsed = JSON.parse(raw) as { latest?: string | null };
    const latest = parsed.latest;
    if (
      typeof latest === 'string' &&
      valid(latest) &&
      valid(currentVersion) &&
      gt(latest, currentVersion)
    ) {
      return latest;
    }
  } catch {
    // Missing or malformed cache — no chip.
  }
  return null;
}

export function buildWelcomeSubtitleChip(version: string): string | null {
  const updateTarget = readWelcomeUpdateTarget(version);
  const palette = currentTheme.palette;
  if (updateTarget) {
    return paintWithSlashAccent(
      `↑ Update available — v${updateTarget} · /update`,
      palette.warning,
      PYTHINKER_LOGO_COLORS.accent,
    );
  }
  return null;
}

export function renderWelcomeBanner(options: RenderWelcomeBannerOptions): string[] {
  const safeWidth = Math.max(0, options.width);
  if (safeWidth < 24) {
    return [
      '',
      truncateToWidth(options.copy.head, safeWidth, '…'),
      truncateToWidth(options.copy.prompt, safeWidth, '…'),
    ];
  }

  const asciiMode = options.asciiMode ?? false;
  const ellipsis = asciiMode ? '~' : '…';
  const panelWidth = safeWidth;
  const innerWidth = Math.max(1, panelWidth - WELCOME_PANEL_CHROME_WIDTH);
  const pad = '  ';

  const copy: WelcomeBannerCopy = asciiMode
    ? {
        head: applyAsciiFallback(options.copy.head),
        strapline: applyAsciiFallback(options.copy.strapline),
        prompt: applyAsciiFallback(options.copy.prompt),
      }
    : options.copy;

  const facts = options.infoItems
    .filter((item) => item.name.trim() !== 'Tip')
    .map((item) =>
      asciiMode
        ? { ...item, name: applyAsciiFallback(item.name), value: applyAsciiFallback(item.value) }
        : item,
    );
  const resolvedTips = buildWelcomeTips().map((item) =>
    asciiMode
      ? { ...item, name: applyAsciiFallback(item.name), value: applyAsciiFallback(item.value) }
      : item,
  );
  const showLogo = !asciiMode;
  const useColumns = resolvedTips.length > 0 && innerWidth >= WELCOME_COLUMNS_MIN_WIDTH;
  const centerLogo = showLogo && innerWidth < LOGO_STACKED_MIN_WIDTH;

  const logoLines =
    options.logoLines ??
    (showLogo ? renderPythinkerLogo() : []);

  const contentLines: string[] = [];

  if (useColumns) {
    let wantedLeft = WELCOME_LEFT_COLUMN_WIDTH;
    if (facts.length > 0) {
      const longestFact = Math.max(...facts.map((item) => visibleWidth(item.value)));
      wantedLeft = Math.max(
        wantedLeft,
        Math.min(WELCOME_LEFT_COLUMN_MAX_WIDTH, longestFact + WELCOME_LABEL_WIDTH + 2),
      );
    }
    const leftWidth = Math.max(
      WELCOME_LEFT_COLUMN_WIDTH,
      Math.min(
        wantedLeft,
        innerWidth - WELCOME_COLUMNS_CHROME_WIDTH - WELCOME_TIPS_MIN_WIDTH,
      ),
    );
    const tipsWidth = innerWidth - WELCOME_COLUMNS_CHROME_WIDTH - leftWidth;

    const leftFactsRows = facts.length > 0 ? renderFactsRows(facts, leftWidth, ellipsis) : [];
    const leftLines = [
      ...[copy.head, copy.strapline, copy.prompt].map((line) =>
        truncateToWidth(line, leftWidth, ellipsis),
      ),
      '',
      ...centerBlock(logoLines, leftWidth),
      '',
      ...leftFactsRows,
    ];
    const rightTipsRows = renderTipsBlock(resolvedTips, tipsWidth, true, asciiMode);

    contentLines.push(...renderTwoColumns(leftLines, rightTipsRows, leftWidth, tipsWidth));
  } else {
    contentLines.push(
      ...renderStackedLogoHeader(logoLines, copy, innerWidth, ellipsis, centerLogo),
    );
    if (facts.length > 0) {
      contentLines.push('', ...renderFactsRows(facts, innerWidth, ellipsis));
    }
    if (resolvedTips.length > 0) {
      contentLines.push('', ...renderTipsBlock(resolvedTips, innerWidth, false, asciiMode));
    }
  }

  const versionTitle =
    chalk.hex(currentTheme.palette.textMuted)('Pythinker Code') +
    chalk.hex(currentTheme.palette.textDim)(` v${options.version}`);
  const subtitle = options.subtitleChip ?? null;

  const lines: string[] = [
    '',
    renderPanelTopBorder(versionTitle, subtitle, panelWidth),
    borderPaint('│') + ' '.repeat(panelWidth - 2) + borderPaint('│'),
  ];

  for (const content of contentLines) {
    const truncated = truncateToWidth(content, innerWidth, ellipsis);
    const rightPad = Math.max(0, innerWidth - visibleWidth(truncated));
    lines.push(
      borderPaint('│') + pad + truncated + ' '.repeat(rightPad) + borderPaint('│'),
    );
  }

  lines.push(borderPaint('│') + ' '.repeat(panelWidth - 2) + borderPaint('│'), borderPaint('╰' + '─'.repeat(panelWidth - 2) + '╯'), '');

  return lines.map((line) => truncateToWidth(line, panelWidth, ellipsis));
}

export function createWelcomeGitCache(workDir: string): GitStatusCache {
  return createGitStatusCache(workDir);
}
