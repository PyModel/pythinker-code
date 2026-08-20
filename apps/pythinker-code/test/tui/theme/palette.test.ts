import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { darkColors, lightColors } from '#/tui/theme';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const SCHEMA_HEX_PATTERN = '^#[0-9a-fA-F]{6}$';

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
});
