/**
 * Welcome banner layout — mirrors the Python shell welcome panel:
 * branded mark, coding-session facts, and optional command tips.
 */

import { truncateToWidth, visibleWidth } from '@pymodel/pi-tui';

import { effectiveModelAlias } from '@pymodel/pythinker-code-sdk';

import { currentTheme, type ColorToken } from '#/tui/theme';
import type { AppState } from '#/tui/types';
import { createGitStatusCache, type GitStatusCache } from '#/utils/git/git-status';

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
  '↓': 'v',
  '•': '*',
  '·': '-',
  '—': '-',
  '…': '~',
  '─': '-',
  '±': '+/-',
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

export interface WelcomeBannerCopyText {
  readonly head: string;
  readonly strapline: string;
  readonly prompt: string;
}

export interface WelcomeBannerCopy extends WelcomeBannerCopyText {}

export interface RenderWelcomeBannerOptions {
  readonly width: number;
  readonly version: string;
  readonly infoItems: readonly WelcomeInfoItem[];
  readonly copy: WelcomeBannerCopy;
  readonly logoLines?: readonly string[];
  readonly tips?: readonly WelcomeInfoItem[];
  readonly asciiMode?: boolean;
}

export function asciiGlyphsEnabled(): boolean {
  const term = process.env['TERM'] ?? '';
  return term === 'linux' || term === 'dumb';
}

function applyAsciiFallback(text: string): string {
  return text.replaceAll(/[✦↑↓•·—…─±]/g, (char) => ASCII_FALLBACKS[char] ?? char);
}

function borderPaint(text: string): string {
  return currentTheme.fg('border', text);
}

function paintWithSlashAccent(
  text: string,
  baseToken: ColorToken,
  accentToken: ColorToken,
): string {
  return text
    .split(/(\/[A-Za-z][A-Za-z0-9_-]*)/g)
    .map((part) =>
      part.startsWith('/') ? currentTheme.fg(accentToken, part) : currentTheme.fg(baseToken, part),
    )
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

function valueStyleForLabel(label: string, level: WelcomeInfoLevel): ColorToken {
  if (level === 'warn') return 'warning';
  if (level === 'error') return 'error';
  switch (label.trim()) {
    case 'Directory':
      return 'accent';
    case 'Session':
    case 'Branch':
      return 'textDim';
    case 'Model':
      return 'warning';
    case 'Auto-save':
      return 'textMuted';
    default:
      return 'textDim';
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

function renderFactsRows(
  items: readonly WelcomeInfoItem[],
  width: number,
  ellipsis: string,
): string[] {
  const labelWidth = Math.min(WELCOME_LABEL_WIDTH, Math.max(4, Math.floor(width / 3)));
  const valueWidth = Math.max(4, width - labelWidth - 2);
  const rows: string[] = [];

  for (const item of items) {
    const level = item.level ?? 'info';
    const value = formatWelcomeValue(item.name, item.value, valueWidth, ellipsis);
    const labelText = truncateToWidth(item.name, labelWidth, ellipsis);
    const label = currentTheme.boldFg(
      'textMuted',
      ' '.repeat(Math.max(0, labelWidth - visibleWidth(labelText))) + labelText,
    );
    rows.push(`${label}  ${currentTheme.fg(valueStyleForLabel(item.name, level), value)}`);
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
  const bullet = asciiMode ? '* ' : '• ';
  const lines: string[] = [currentTheme.fg('textMuted', 'Tips')];

  if (withRule) {
    const ruleChar = asciiMode ? '-' : '─';
    lines.push(currentTheme.fg('textMuted', ruleChar.repeat(tipWidth)));
  }

  for (const item of tips) {
    const wrapped = wrapPlain(item.value, tipWidth).map((line) =>
      truncateToWidth(line, tipWidth, asciiMode ? '~' : '…'),
    );
    for (let index = 0; index < wrapped.length; index++) {
      const prefix = index === 0 ? bullet : '  ';
      const level = item.level ?? 'info';
      const levelToken: ColorToken =
        level === 'warn' ? 'warning' : level === 'error' ? 'error' : 'textDim';
      const styled = paintWithSlashAccent(
        wrapped[index]!,
        levelToken,
        PYTHINKER_LOGO_COLORS.accent,
      );
      lines.push(`${currentTheme.fg('textMuted', prefix)}${styled}`);
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
  asciiMode: boolean,
): string[] {
  const divider = currentTheme.fg('border', asciiMode ? ' | ' : ' │ ');
  const maxRows = Math.max(leftLines.length, rightLines.length);
  const rows: string[] = [];

  for (let row = 0; row < maxRows; row++) {
    const left = padRight(truncateToWidth(leftLines[row] ?? '', leftWidth, '…'), leftWidth);
    const right = padRight(truncateToWidth(rightLines[row] ?? '', rightWidth, '…'), rightWidth);
    rows.push(left + divider + right);
  }
  return rows;
}

function renderPanelTopBorder(title: string, width: number, asciiMode: boolean): string {
  const inner = Math.max(0, width - 2);
  const titlePart = ` ${title} `;
  const titleWidth = visibleWidth(titlePart);
  const dashCount = Math.max(0, inner - titleWidth);
  const left = asciiMode ? '+' : '╭';
  const horizontal = asciiMode ? '-' : '─';
  const right = asciiMode ? '+' : '╮';
  return (
    borderPaint(left) +
    titlePart +
    borderPaint(horizontal.repeat(dashCount)) +
    borderPaint(right)
  );
}

export function buildWelcomeCopyText(isLoggedOut: boolean): WelcomeBannerCopyText {
  return {
    head: 'Welcome to Pythinker — think first, then code.',
    strapline: 'Review · Secure · Diagnose · Build with confidence.',
    prompt: isLoggedOut
      ? 'Run /login or /provider to get started.'
      : 'Type /help for commands.',
  };
}

export function buildWelcomeCopy(isLoggedOut: boolean): WelcomeBannerCopy {
  const text = buildWelcomeCopyText(isLoggedOut);
  return {
    head: currentTheme.boldFg('textStrong', text.head),
    strapline: currentTheme.fg('textMuted', text.strapline),
    prompt: paintWithSlashAccent(text.prompt, 'textMuted', PYTHINKER_LOGO_COLORS.accent),
  };
}

export function buildWelcomeInfoItems(
  state: AppState,
  gitCache: GitStatusCache | null,
): WelcomeInfoItem[] {
  const isLoggedOut = !state.model;
  const activeModel = state.availableModels[state.model];
  const effectiveActiveModel =
    activeModel === undefined ? undefined : effectiveModelAlias(activeModel);
  const modelValue = isLoggedOut
    ? 'not set, run /login or /provider'
    : (effectiveActiveModel?.displayName ??
      effectiveActiveModel?.model ??
      activeModel?.displayName ??
      activeModel?.model ??
      state.model);

  const gitStatus = gitCache?.getStatus();
  const items: WelcomeInfoItem[] = [{ name: 'Directory', value: state.workDir }];
  if (gitStatus?.branch) items.push({ name: 'Branch', value: gitStatus.branch });

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

export function renderWelcomeBanner(options: RenderWelcomeBannerOptions): string[] {
  const safeWidth = Math.max(0, options.width);
  const asciiMode = options.asciiMode ?? false;
  const ellipsis = asciiMode ? '~' : '…';
  const copy: WelcomeBannerCopy = asciiMode
    ? {
        head: applyAsciiFallback(options.copy.head),
        strapline: applyAsciiFallback(options.copy.strapline),
        prompt: applyAsciiFallback(options.copy.prompt),
      }
    : options.copy;

  if (safeWidth < 24) {
    const lines = [
      '',
      truncateToWidth(copy.head, safeWidth, ellipsis),
      truncateToWidth(copy.prompt, safeWidth, ellipsis),
    ];
    const modelItem = options.infoItems.find((item) => item.name === 'Model');
    if (modelItem !== undefined) {
      const value = asciiMode ? applyAsciiFallback(modelItem.value) : modelItem.value;
      const modelLine =
        modelItem.level === 'warn'
          ? `Model: ${currentTheme.fg('warning', value)}`
          : `Model: ${value}`;
      lines.push(truncateToWidth(modelLine, safeWidth, ellipsis));
    }
    return lines;
  }

  const panelWidth = safeWidth;
  const innerWidth = Math.max(1, panelWidth - WELCOME_PANEL_CHROME_WIDTH);
  const pad = '  ';
  const facts = options.infoItems
    .filter((item) => item.name.trim() !== 'Tip')
    .map((item) =>
      asciiMode
        ? { ...item, name: applyAsciiFallback(item.name), value: applyAsciiFallback(item.value) }
        : item,
    );
  const resolvedTips = (options.tips ?? buildWelcomeTips()).map((item) =>
    asciiMode
      ? { ...item, name: applyAsciiFallback(item.name), value: applyAsciiFallback(item.value) }
      : item,
  );
  const showLogo = !asciiMode;
  const useColumns = resolvedTips.length > 0 && innerWidth >= WELCOME_COLUMNS_MIN_WIDTH;
  const centerLogo = showLogo && innerWidth < LOGO_STACKED_MIN_WIDTH;
  const logoLines = showLogo
    ? (options.logoLines ?? renderPythinkerLogo())
    : [];
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
    contentLines.push(...renderTwoColumns(leftLines, rightTipsRows, leftWidth, tipsWidth, asciiMode));
  } else {
    contentLines.push(
      ...renderStackedLogoHeader(logoLines, copy, innerWidth, ellipsis, centerLogo),
    );
    if (facts.length > 0) contentLines.push('', ...renderFactsRows(facts, innerWidth, ellipsis));
    if (resolvedTips.length > 0) {
      contentLines.push('', ...renderTipsBlock(resolvedTips, innerWidth, false, asciiMode));
    }
  }

  const versionTitle =
    currentTheme.fg('textMuted', 'Pythinker Code') +
    currentTheme.fg('textDim', ` v${options.version}`);
  const vertical = asciiMode ? '|' : '│';
  const horizontal = asciiMode ? '-' : '─';
  const bottomLeft = asciiMode ? '+' : '╰';
  const bottomRight = asciiMode ? '+' : '╯';
  const lines: string[] = [
    '',
    renderPanelTopBorder(versionTitle, panelWidth, asciiMode),
    borderPaint(vertical) + ' '.repeat(panelWidth - 2) + borderPaint(vertical),
  ];

  for (const content of contentLines) {
    const truncated = truncateToWidth(content, innerWidth, ellipsis);
    const rightPad = Math.max(0, innerWidth - visibleWidth(truncated));
    lines.push(
      borderPaint(vertical) + pad + truncated + ' '.repeat(rightPad) + borderPaint(vertical),
    );
  }

  lines.push(
    borderPaint(vertical) + ' '.repeat(panelWidth - 2) + borderPaint(vertical),
    borderPaint(bottomLeft + horizontal.repeat(panelWidth - 2) + bottomRight),
    '',
  );

  return lines.map((line) => truncateToWidth(line, panelWidth, ellipsis));
}

export function createWelcomeGitCache(workDir: string): GitStatusCache {
  return createGitStatusCache(workDir);
}
