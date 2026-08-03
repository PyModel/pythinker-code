import { currentTheme, type ColorToken } from '#/tui/theme';

export interface ShimmerTextOptions {
  baseToken: ColorToken;
  shimmerToken: ColorToken;
  frame: number;
  windowSize?: number;
  phaseOffset?: number;
}

const MIN_WINDOW_SIZE = 2;
const MAX_WINDOW_SIZE = 6;

function resolveWindowSize(length: number, requested?: number): number {
  if (length <= 0) return 0;
  const fallback = Math.max(MIN_WINDOW_SIZE, Math.min(MAX_WINDOW_SIZE, Math.ceil(length / 3)));
  return Math.max(1, Math.min(length, requested ?? fallback));
}

export function shimmerText(text: string, options: ShimmerTextOptions): string {
  const chars = Array.from(text);
  if (chars.length === 0) return '';

  const windowSize = resolveWindowSize(chars.length, options.windowSize);
  const cycleLength = chars.length + windowSize;
  const start = ((options.frame + (options.phaseOffset ?? 0)) % cycleLength) - windowSize;
  const end = start + windowSize;

  let result = '';
  let segment = '';
  let activeToken: ColorToken | undefined;

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === undefined) continue;

    const token = index >= start && index < end ? options.shimmerToken : options.baseToken;
    if (activeToken === undefined) {
      activeToken = token;
      segment = char;
      continue;
    }

    if (token === activeToken) {
      segment += char;
      continue;
    }

    result += currentTheme.fg(activeToken, segment);
    activeToken = token;
    segment = char;
  }

  if (activeToken !== undefined) {
    result += currentTheme.fg(activeToken, segment);
  }

  return result;
}
