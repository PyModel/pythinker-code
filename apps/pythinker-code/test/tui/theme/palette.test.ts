import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors } from '#/tui/theme';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const SCHEMA_HEX_PATTERN = '^#[0-9a-fA-F]{6}$';

function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 0xff, value & 0xff].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].toSorted(
    (a, b) => b - a,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

interface ThemeSchema {
  properties: {
    colors: {
      properties: Record<string, { type: string; pattern: string }>;
    };
  };
}

const schema = JSON.parse(
  readFileSync(new URL('../../../src/tui/theme/theme-schema.json', import.meta.url), 'utf8'),
) as ThemeSchema;

const existingTokens = [
  'primary',
  'accent',
  'text',
  'textStrong',
  'textDim',
  'textMuted',
  'border',
  'borderFocus',
  'success',
  'warning',
  'error',
  'diffAdded',
  'diffRemoved',
  'diffAddedStrong',
  'diffRemovedStrong',
  'diffGutter',
  'diffMeta',
  'roleUser',
  'shellMode',
] as const;

describe('theme palettes', () => {
  it('keeps built-in palettes and the custom-theme schema synchronized', () => {
    const darkTokens = Object.keys(darkColors).toSorted();
    const lightTokens = Object.keys(lightColors).toSorted();
    const schemaTokens = Object.keys(schema.properties.colors.properties).toSorted();

    expect(darkTokens).toEqual(lightTokens);
    expect(schemaTokens).toEqual(darkTokens);
    for (const token of darkTokens) {
      expect(darkColors[token as keyof typeof darkColors]).toMatch(HEX_PATTERN);
      expect(lightColors[token as keyof typeof lightColors]).toMatch(HEX_PATTERN);
      expect(schema.properties.colors.properties[token]).toMatchObject({
        type: 'string',
        pattern: SCHEMA_HEX_PATTERN,
      });
    }
  });

  it('preserves the pre-existing custom-theme tokens', () => {
    for (const token of existingTokens) {
      expect(darkColors[token]).toBeDefined();
      expect(lightColors[token]).toBeDefined();
      expect(schema.properties.colors.properties[token]).toBeDefined();
    }
  });

  it('keeps active tabs at WCAG AA contrast in both built-in palettes', () => {
    for (const palette of [darkColors, lightColors]) {
      expect(contrastRatio(palette.inverseText, palette.selectionBg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses cyan actions with readable neutral text in both built-in palettes', () => {
    expect(darkColors.primary).toBe('#5FC3E8');
    expect(lightColors.primary).toBe('#006A88');

    for (const palette of [darkColors, lightColors]) {
      expect(palette.shellMode).toBe(palette.primary);
      expect(palette.modePlan).toBe(palette.primary);
      expect(contrastRatio(palette.primary, palette.background)).toBeGreaterThanOrEqual(4.5);
      for (const token of ['text', 'textStrong', 'textDim', 'textMuted'] as const) {
        expect(contrastRatio(palette[token], palette.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses a distinct coral accent hierarchy', () => {
    for (const palette of [darkColors, lightColors]) {
      expect(palette.accent).toBe(palette.workflowTitle);
      expect(palette.accentShimmer).not.toBe(palette.accent);
    }
  });

  it('uses cyan for active workflow progress and green for completion', () => {
    for (const palette of [darkColors, lightColors]) {
      expect(palette.progressFill).toBe(palette.primary);
      expect(palette.progressHead).toBe(palette.primaryShimmer);
      expect(palette.success).not.toBe(palette.progressFill);
    }
  });
});
