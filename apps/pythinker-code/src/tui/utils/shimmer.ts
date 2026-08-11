import { currentTheme, type ColorToken } from '#/tui/theme';

export interface ShimmerTextOptions {
  baseToken: ColorToken;
  shimmerToken: ColorToken;
  frame: number;
  windowSize?: number;
  phaseOffset?: number;
}

const CELLS_PER_SECOND = 30;
const BAND_HALF_WIDTH = 6;

type ShimmerTier = 'dim' | 'base' | 'shimmer';

export function shimmerText(text: string, options: ShimmerTextOptions): string {
  const chars = Array.from(text);
  if (chars.length === 0) return '';

  const halfWidth = Math.max(1, options.windowSize ?? BAND_HALF_WIDTH);
  const cycleLength = chars.length + halfWidth * 2;
  const center =
    ((Date.now() / 1_000 * CELLS_PER_SECOND + (options.phaseOffset ?? 0)) % cycleLength) -
    halfWidth;

  let result = '';
  let segment = '';
  let activeTier: ShimmerTier | undefined;

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === undefined) continue;

    const distance = Math.abs(index - center);
    const intensity =
      distance >= halfWidth ? 0 : (Math.cos(Math.PI * distance / halfWidth) + 1) / 2;
    const tier: ShimmerTier = intensity < 0.22 ? 'dim' : intensity < 0.65 ? 'base' : 'shimmer';
    if (activeTier === undefined) {
      activeTier = tier;
      segment = char;
      continue;
    }

    if (tier === activeTier) {
      segment += char;
      continue;
    }

    result += paintTier(activeTier, segment, options);
    activeTier = tier;
    segment = char;
  }

  if (activeTier !== undefined) {
    result += paintTier(activeTier, segment, options);
  }

  return result;
}

function paintTier(tier: ShimmerTier, text: string, options: ShimmerTextOptions): string {
  if (tier === 'dim') return currentTheme.fg('textDim', text);
  if (tier === 'shimmer') return currentTheme.boldFg(options.shimmerToken, text);
  return currentTheme.fg(options.baseToken, text);
}
