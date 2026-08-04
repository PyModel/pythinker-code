/**
 * Display-width helpers shared by the split-footer rows, composer, and dialogs.
 *
 * The footer's fixed four-row height depends on truncation measuring terminal
 * cells rather than code units. A differential test keeps this OpenTUI copy in
 * parity with the legacy pi-tui renderer while that renderer still exists.
 */

const ANSI_RESET = '\u001B[0m';
const ELLIPSIS = '…';
const TAB_WIDTH = 3;
const VISIBLE_WIDTH_MEMO_CAP = 1_000;

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});
const visibleWidthMemo = new Map<string, number>();

const ANSI_PATTERN =
  /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007]*?(?:\u0007|\u001B\\)/gu;

export function truncateToWidth(value: string, width: number): string {
  if (width <= 0) return '';
  const normalized = value.replaceAll(/[\r\n]+/gu, ' ');
  if (normalized.length === 0) return '';

  const valueWidth = visibleWidth(normalized);
  const ellipsisWidth = visibleWidth(ELLIPSIS);
  const containsAnsi = stripAnsi(normalized) !== normalized;
  if (ellipsisWidth >= width) {
    if (valueWidth <= width) return normalized;
    return containsAnsi
      ? `${ANSI_RESET}${ELLIPSIS}${ANSI_RESET}`
      : ELLIPSIS;
  }
  if (valueWidth <= width) return normalized;

  const prefix = takeWidth(normalized, width - ellipsisWidth);
  return containsAnsi
    ? `${prefix}${ANSI_RESET}${ELLIPSIS}${ANSI_RESET}`
    : prefix + ELLIPSIS;
}

function takeWidth(value: string, width: number): string {
  let result = '';
  let used = 0;
  let index = 0;
  let pendingAnsi = '';

  while (index < value.length) {
    const ansi = readAnsi(value, index);
    if (ansi !== undefined) {
      pendingAnsi += ansi.sequence;
      index = ansi.end;
      continue;
    }

    let plainEnd = index + 1;
    while (plainEnd < value.length && value[plainEnd] !== '\u001B') {
      plainEnd += 1;
    }

    for (const { segment } of graphemeSegmenter.segment(
      value.slice(index, plainEnd),
    )) {
      const segmentWidth = graphemeWidth(segment);
      if (used + segmentWidth > width) return result;
      result += pendingAnsi + segment;
      pendingAnsi = '';
      used += segmentWidth;
    }
    index = plainEnd;
  }

  return result;
}

export function visibleWidth(value: string): number {
  const cached = visibleWidthMemo.get(value);
  if (cached !== undefined) return cached;

  const stripped = stripAnsi(value);
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(stripped)) {
    width += graphemeWidth(segment);
  }

  visibleWidthMemo.set(value, width);
  if (visibleWidthMemo.size > VISIBLE_WIDTH_MEMO_CAP) {
    visibleWidthMemo.clear();
  }

  return width;
}

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_PATTERN, '');
}

function readAnsi(
  value: string,
  index: number,
): { sequence: string; end: number } | undefined {
  if (value[index] !== '\u001B') return undefined;

  if (value[index + 1] === '[') {
    for (let end = index + 2; end < value.length; end += 1) {
      const codePoint = value.codePointAt(end);
      if (
        codePoint !== undefined &&
        codePoint >= 0x40 &&
        codePoint <= 0x7e
      ) {
        return {
          sequence: value.slice(index, end + 1),
          end: end + 1,
        };
      }
    }
    return undefined;
  }

  if (value[index + 1] === ']') {
    for (let end = index + 2; end < value.length; end += 1) {
      if (value[end] === '\u0007') {
        return {
          sequence: value.slice(index, end + 1),
          end: end + 1,
        };
      }
      if (value[end] === '\u001B' && value[end + 1] === '\\') {
        return {
          sequence: value.slice(index, end + 2),
          end: end + 2,
        };
      }
    }
  }

  return undefined;
}

function graphemeWidth(segment: string): number {
  // pi-tui expands every visible tab to three cells regardless of its column.
  if (segment === '\t') return TAB_WIDTH;

  let width = 0;
  let baseWidth = 0;
  let regionalIndicators = 0;
  let hasJoinedEmoji = false;

  for (const char of segment) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) {
      regionalIndicators += 1;
    }
    if (
      codePoint === 0x200d ||
      (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    ) {
      hasJoinedEmoji = true;
      continue;
    }

    const charWidth = codePointWidth(char);
    if (baseWidth === 0 && charWidth > 0) baseWidth = charWidth;
    width += charWidth;
  }

  if (regionalIndicators === 2) return 2;
  return hasJoinedEmoji ? baseWidth : width;
}

function codePointWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint === 0x200d || (codePoint >= 0x300 && codePoint <= 0x36f))
    return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff))
  );
}
