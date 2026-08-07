/**
 * Thinking-effort presentation helpers (TUI-only).
 *
 * The level rules themselves live in the SDK (`#/thinking-levels` there) so the
 * terminal and VS Code renderers offer the same levels for the same model; they
 * are re-exported here so existing TUI importers keep their import path. Only
 * the theme-bound presentation stays local, because the SDK must not depend on
 * the TUI theme.
 */

import type { ColorToken } from '#/tui/theme';

export {
  CANONICAL_EFFORT_ORDER,
  coerceEffortForModel,
  DEFAULT_SUPPORTED_EFFORTS,
  effortLevelsForModel,
  thinkingAvailability,
  type ThinkingAvailability,
} from '@pythoughts/pythinker-code-sdk';

const EFFORT_COLOR_TOKENS = {
  minimal: 'effortLow',
  low: 'effortLow',
  medium: 'effortMedium',
  high: 'effortHigh',
  xhigh: 'effortXHigh',
  max: 'effortMax',
} as const satisfies Record<string, ColorToken>;

export function effortColorToken(level: string): ColorToken {
  return EFFORT_COLOR_TOKENS[level as keyof typeof EFFORT_COLOR_TOKENS] ?? 'primary';
}

/** Compact label for footer / editor badges: `medium` → `med`, others unchanged. */
export function shortEffortLabel(level: string): string {
  return level === 'medium' ? 'med' : level;
}
