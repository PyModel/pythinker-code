import { describe, expect, it } from 'vitest';

import { sessionAccentHex } from '#/tui/utils/session-accent';

function channelSum(hex: string): number {
  return [1, 3, 5].reduce((sum, start) => sum + Number.parseInt(hex.slice(start, start + 2), 16), 0);
}

describe('sessionAccentHex', () => {
  it('returns a stable six-digit hex color for each key', () => {
    const accent = sessionAccentHex('session-alpha', 'dark');

    expect(accent).toBe(sessionAccentHex('session-alpha', 'dark'));
    expect(accent).toMatch(/^#[0-9a-fA-F]{6}$/u);
  });

  it('gives known session keys different hues', () => {
    expect(sessionAccentHex('session-alpha', 'dark')).not.toBe(
      sessionAccentHex('session-beta', 'dark'),
    );
  });

  it('uses a darker light-theme variant', () => {
    expect(channelSum(sessionAccentHex('session-alpha', 'light'))).toBeLessThan(
      channelSum(sessionAccentHex('session-alpha', 'dark')),
    );
  });
});
