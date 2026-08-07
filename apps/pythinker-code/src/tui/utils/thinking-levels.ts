/**
 * Thinking-effort presentation helpers (TUI-only).
 *
 * Only theme-bound presentation lives here, because the SDK must not depend on
 * the TUI theme. The level rules themselves are
 * `@pythoughts/pythinker-code-sdk`'s, so the terminal and VS Code renderers
 * offer the same levels for the same model; import them from there.
 */

import type { ColorToken } from '#/tui/theme';

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
