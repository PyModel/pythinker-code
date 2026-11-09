import { describe, expect, it } from 'vitest';

import { accentHexForHue, sessionAccentHex } from '#/tui/utils/session-accent';

function channelSum(hex: string): number {
  return [1, 3, 5].reduce((sum, start) => sum + Number.parseInt(hex.slice(start, start + 2), 16), 0);
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
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

  it('keeps every light-theme hue above the chrome contrast floor', () => {
    for (let hue = 0; hue < 360; hue++) {
      const contrast = 1.05 / (relativeLuminance(accentHexForHue(hue, 'light')) + 0.05);
      expect(contrast, `hue ${String(hue)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the dark-theme hue mapping unchanged', () => {
    expect(accentHexForHue(60, 'dark')).toBe('#F8F877');
  });
});
