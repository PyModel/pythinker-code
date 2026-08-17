import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylePath = ['src/style.css', 'apps/pythinker-web/src/style.css'].find(existsSync);
if (!stylePath) throw new Error('style.css source was not found');

const styleSource = readFileSync(stylePath, 'utf8');
const lightPalette = styleSource.match(/:root:not\(\[data-ds-dark-theme\]\)\s*\{([^}]*)\}/u)?.[1];

function tokenValue(name: string): string {
  const value = lightPalette?.match(new RegExp(`--${name}:\\s*(#[\\da-f]{6})\\s*;`, 'iu'))?.[1];
  if (!value) throw new Error(`Light palette token --${name} was not found`);
  return value;
}

function luminance(hex: string): number {
  const [red, green, blue] = hex.slice(1).match(/.{2}/gu)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

describe('Explore light palette contrast', () => {
  it('meets WCAG contrast thresholds on white', () => {
    expect(contrastRatio(tokenValue('dim'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue('muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokenValue('faint'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
