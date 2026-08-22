import { currentTheme, type ColorToken } from '#/tui/theme';

export interface ShimmerTextOptions {
  baseToken: ColorToken;
  shimmerToken: ColorToken;
  altShimmerToken?: ColorToken;
  /** Half-width of the cosine shimmer band, in terminal cells. */
  bandHalfWidth?: number;
  phaseOffset?: number;
}

const CELLS_PER_SECOND = 20;
const BAND_HALF_WIDTH = 6;

type ShimmerTier = 'dim' | 'base' | 'shimmer';

export function shimmerText(text: string, options: ShimmerTextOptions): string {
  const chars = Array.from(text);
  if (chars.length === 0) return '';

  const halfWidth = Math.max(1, options.bandHalfWidth ?? BAND_HALF_WIDTH);
  const cycleLength = chars.length + halfWidth * 2;
  const rawPosition = Date.now() / 1_000 * CELLS_PER_SECOND + (options.phaseOffset ?? 0);
  const center = rawPosition % cycleLength - halfWidth;
  const passIndex = Math.floor(rawPosition / cycleLength);
  const peakToken = options.altShimmerToken !== undefined && passIndex % 2 !== 0
    ? options.altShimmerToken
    : options.shimmerToken;

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

    result += paintTier(activeTier, segment, options.baseToken, peakToken);
    activeTier = tier;
    segment = char;
  }

  if (activeTier !== undefined) {
    result += paintTier(activeTier, segment, options.baseToken, peakToken);
  }

  return result;
}

function paintTier(
  tier: ShimmerTier,
  text: string,
  baseToken: ColorToken,
  peakToken: ColorToken,
): string {
  if (tier === 'dim') return currentTheme.fg('textDim', text);
  if (tier === 'shimmer') return currentTheme.boldFg(peakToken, text);
  return currentTheme.fg(baseToken, text);
}
