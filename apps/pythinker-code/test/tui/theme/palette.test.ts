import { readFileSync } from 'node:fs';

import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  colorize,
  currentTheme,
  darkColors,
  lightColors,
  type ColorSpec,
} from '#/tui/theme';

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const SCHEMA_HEX_PATTERN = '^#[0-9a-fA-F]{6}$';

const textTokens = [
  'accent',
  'text',
  'textStrong',
  'textDim',
  'textMuted',
  'roleUser',
  'workflowTitle',
  'success',
  'warning',
  'error',
  'diffAdded',
  'diffRemoved',
  'diffAddedStrong',
  'diffRemovedStrong',
  'diffMeta',
  'diffAddedDimmed',
  'diffRemovedDimmed',
] as const;

const effortTokens = [
  'effortLow',
  'effortMedium',
  'effortHigh',
  'effortXHigh',
  'effortMax',
] as const;

const chromeTokens = [
  ...effortTokens,
  'primary',
  'border',
  'borderFocus',
  'diffGutter',
  'agentRed',
  'agentOrange',
  'agentYellow',
  'agentGreen',
  'agentCyan',
  'agentBlue',
  'agentPurple',
  'agentPink',
  'rainbowRed',
  'rainbowOrange',
  'rainbowYellow',
  'rainbowGreen',
  'rainbowBlue',
  'rainbowIndigo',
  'rainbowViolet',
  'modeAutoAccept',
  'modePlan',
  'modePermission',
  'modeFast',
  'primaryShimmer',
  'accentShimmer',
  'warningShimmer',
  'borderShimmer',
  'textDimShimmer',
  'progressFill',
  'progressHead',
] as const;

const exemptTokens = [
  'background',
  'inverseText',
  'selectionBg',
  'surfaceHighlight',
  'progressEmpty',
] as const;

const shimmerPairs = [
  ['primaryShimmer', 'primary'],
  ['accentShimmer', 'accent'],
  ['warningShimmer', 'warning'],
  ['borderShimmer', 'border'],
  ['textDimShimmer', 'textDim'],
] as const;

const agentTokens = [
  'agentRed',
  'agentOrange',
  'agentYellow',
  'agentGreen',
  'agentCyan',
  'agentBlue',
  'agentPurple',
  'agentPink',
] as const;

const rainbowTokens = [
  'rainbowRed',
  'rainbowOrange',
  'rainbowYellow',
  'rainbowGreen',
  'rainbowBlue',
  'rainbowIndigo',
  'rainbowViolet',
] as const;

const expectedVisualDefaults = {
  dark: {
    primary: '#BBC6FF',
    primaryShimmer: '#F4F5FF',
    effortLow: '#8A8A8A',
    effortMedium: '#6FA8DC',
    effortHigh: '#D33682',
    effortXHigh: '#C0392B',
    effortMax: '#F2C744',
    workflowTitle: '#EE9983',
    progressFill: '#25764A',
    progressHead: '#4EC87E',
    progressEmpty: '#D9DEE8',
  },
  light: {
    effortLow: '#8A8A8A',
    effortMedium: '#2E6FB8',
    effortHigh: '#A81D6E',
    effortXHigh: '#8B1A1A',
    effortMax: '#B8860B',
    workflowTitle: '#9C261C',
    progressFill: '#3B9A65',
    progressHead: '#0E7A38',
    progressEmpty: '#6B7280',
  },
} as const;

const existingDarkColors = {
  primary: '#BBC6FF',
  accent: '#7B8CE8',
  text: '#E0E0E0',
  textStrong: '#F5F5F5',
  textDim: '#888888',
  textMuted: '#6B6B6B',
  border: '#5A5A5A',
  borderFocus: '#E8A838',
  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',
  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',
  roleUser: '#FFCB6B',
} as const;

const existingLightColors = {
  primary: '#4A5BC4',
  accent: '#5566CC',
  text: '#1A1A1A',
  textStrong: '#1A1A1A',
  textDim: '#454545',
  textMuted: '#5F5F5F',
  border: '#737373',
  borderFocus: '#92660A',
  success: '#0E7A38',
  warning: '#92660A',
  error: '#B91C1C',
  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',
  roleUser: '#9A4A00',
} as const;

interface ThemeSchema {
  properties: {
    colors: {
      properties: Record<
        string,
        {
          type: string;
          pattern: string;
          description: string;
        }
      >;
    };
  };
}

const schema = JSON.parse(
  readFileSync(new URL('../../../src/tui/theme/theme-schema.json', import.meta.url), 'utf8'),
) as ThemeSchema;

const originalPalette = currentTheme.palette;

afterEach(() => {
  currentTheme.setPalette(originalPalette);
});

function markdownColorTokens(url: URL): string[] {
  const source = readFileSync(url, 'utf8');
  return [...source.matchAll(/^\| `([A-Za-z][A-Za-z0-9]*)` \|/gmu)]
    .map((match) => match[1])
    .filter((token): token is string => token !== undefined)
    .toSorted();
}

function documentedBuiltInColors(url: URL): Record<string, { dark: string; light: string }> {
  const source = readFileSync(url, 'utf8');
  return Object.fromEntries(
    [...source.matchAll(
      /^\| `([A-Za-z][A-Za-z0-9]*)` \| `(#[0-9A-Fa-f]{6})` \| `(#[0-9A-Fa-f]{6})` \|/gmu,
    )].flatMap((match) => {
      const token = match[1];
      const dark = match[2];
      const light = match[3];
      return token === undefined || dark === undefined || light === undefined
        ? []
        : [[token, { dark, light }] as const];
    }),
  );
}

function paletteDescriptions(): Record<string, string> {
  const source = readFileSync(
    new URL('../../../src/tui/theme/colors.ts', import.meta.url),
    'utf8',
  );
  const palette = source.match(/export interface ColorPalette \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  return Object.fromEntries(
    [...palette.matchAll(/\/\*\*([\s\S]*?)\*\/\s*([A-Za-z][A-Za-z0-9]*): string;/gu)].map(
      ([, comment, token]) => [
        token,
        comment
          ?.split('\n')
          .map((line) => line.replace(/^\s*\*\s?/u, '').trim())
          .join(' ')
          .trim(),
      ],
    ),
  );
}

function documentedDescriptions(url: URL): Record<string, string> {
  const source = readFileSync(url, 'utf8');
  return Object.fromEntries(
    [...source.matchAll(
      /^\| `([A-Za-z][A-Za-z0-9]*)` \| (?:`#[0-9A-Fa-f]{6}` \| `#[0-9A-Fa-f]{6}` \| )?(.+) \|$/gmu,
    )].map(([, token, description]) => [token, description]),
  );
}

function channel(hex: string, start: number): number {
  return Number.parseInt(hex.slice(start, start + 2), 16);
}

function relativeLuminance(hex: string): number {
  const linearize = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(channel(hex, 1)) +
    0.7152 * linearize(channel(hex, 3)) +
    0.0722 * linearize(channel(hex, 5))
  );
}

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function meanChannelDelta(first: string, second: string): number {
  return (
    (Math.abs(channel(first, 1) - channel(second, 1)) +
      Math.abs(channel(first, 3) - channel(second, 3)) +
      Math.abs(channel(first, 5) - channel(second, 5))) /
    3
  );
}

function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const red = channel(hex, 1) / 255;
  const green = channel(hex, 3) / 255;
  const blue = channel(hex, 5) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation: saturation * 100, lightness: lightness * 100 };
}

function expectPairwiseHueDistance(
  palette: typeof darkColors,
  tokens: readonly (keyof typeof darkColors)[],
  minimumDistance: number,
): void {
  for (let firstIndex = 0; firstIndex < tokens.length; firstIndex += 1) {
    const firstToken = tokens[firstIndex];
    if (firstToken === undefined) throw new Error('missing first color token');

    for (let secondIndex = firstIndex + 1; secondIndex < tokens.length; secondIndex += 1) {
      const secondToken = tokens[secondIndex];
      if (secondToken === undefined) throw new Error('missing second color token');

      const firstHue = hexToHsl(palette[firstToken]).hue;
      const secondHue = hexToHsl(palette[secondToken]).hue;
      const directDistance = Math.abs(firstHue - secondHue);
      const circularDistance = Math.min(directDistance, 360 - directDistance);

      expect(
        circularDistance,
        `${String(firstToken)} and ${String(secondToken)} are only ${circularDistance.toFixed(2)}° apart`,
      ).toBeGreaterThanOrEqual(minimumDistance);
    }
  }
}

describe('theme palettes', () => {
  it('keeps palette and schema token sets complete and synchronized', () => {
    const darkTokens = Object.keys(darkColors).toSorted();
    const lightTokens = Object.keys(lightColors).toSorted();
    const schemaProperties = schema.properties.colors.properties;

    expect(darkTokens).toHaveLength(57);
    expect(lightTokens).toEqual(darkTokens);
    expect(Object.keys(schemaProperties).toSorted()).toEqual(darkTokens);
    expect(
      markdownColorTokens(
        new URL('../../../../../docs/customization/themes.md', import.meta.url),
      ),
    ).toEqual(darkTokens);
    expect(
      documentedBuiltInColors(
        new URL('../../../../../docs/customization/themes.md', import.meta.url),
      ),
    ).toEqual(
      Object.fromEntries(
        darkTokens.map((token) => [
          token,
          {
            dark: darkColors[token as keyof typeof darkColors],
            light: lightColors[token as keyof typeof lightColors],
          },
        ]),
      ),
    );
    const documentationUrls = [
      new URL('../../../../../docs/customization/themes.md', import.meta.url),
      new URL(
        '../../../../../packages/agent-core/src/skill/builtin/custom-theme.md',
        import.meta.url,
      ),
    ];
    expect(markdownColorTokens(documentationUrls[1] as URL)).toEqual(darkTokens);
    for (const url of documentationUrls) {
      expect(documentedDescriptions(url)).toEqual(paletteDescriptions());
    }

    for (const token of darkTokens) {
      const property = schemaProperties[token];
      expect(property, `${token} is missing from the theme schema`).toBeDefined();
      expect(property).toMatchObject({
        type: 'string',
        pattern: SCHEMA_HEX_PATTERN,
        description: expect.any(String),
      });
      expect(property?.description).not.toContain('\n');
    }
  });

  it('keeps active-tab semantics and custom-theme contrast guidance synchronized', () => {
    const descriptions = paletteDescriptions();
    const activeTabDescriptions = {
      inverseText:
        'Foreground for active `/model` provider and `AskUserQuestion` tabs; pair with `selectionBg` at 4.5:1 contrast or higher.',
      selectionBg:
        'Background for active `/model` provider and `AskUserQuestion` tabs; pair with `inverseText` at 4.5:1 contrast or higher.',
    } as const;

    expect(descriptions).toMatchObject(activeTabDescriptions);
    for (const [token, description] of Object.entries(activeTabDescriptions)) {
      expect(schema.properties.colors.properties[token]?.description).toBe(description);
    }

    const activeTabGuidance =
      'Active `/model` provider and `AskUserQuestion` tabs use `selectionBg` for the background and `inverseText` for the foreground. Keep this pair at 4.5:1 contrast or higher.';
    const runtimeGuidance =
      'The runtime validates six-digit hex syntax for each color, but it does not enforce or repair color contrast.';
    const referenceUrls = [
      new URL('../../../src/tui/theme/colors.ts', import.meta.url),
      new URL('../../../src/tui/theme/theme-schema.json', import.meta.url),
      new URL('../../../../../docs/customization/themes.md', import.meta.url),
      new URL(
        '../../../../../packages/agent-core/src/skill/builtin/custom-theme.md',
        import.meta.url,
      ),
      new URL('../../../../../.agents/skills/write-tui/DESIGN.md', import.meta.url),
    ];

    for (const url of referenceUrls) {
      const source = readFileSync(url, 'utf8')
        .replaceAll(/^\s*\/\/\s?/gmu, '')
        .replaceAll(/\s+/gu, ' ');
      expect(source, url.pathname).toContain(activeTabGuidance);
      expect(source, url.pathname).toContain(runtimeGuidance);
    }

    const colorsSchema = schema.properties.colors as ThemeSchema['properties']['colors'] & {
      description: string;
    };
    expect(colorsSchema.description).toContain(
      'Omitted tokens fall back to the selected base palette.',
    );
  });

  it('uses the professional visual defaults', () => {
    expect(darkColors).toMatchObject(expectedVisualDefaults.dark);
    expect(lightColors).toMatchObject(expectedVisualDefaults.light);
  });

  it('uses progressHead with no progressShimmer fallback token', () => {
    expect(darkColors).toHaveProperty('progressHead');
    expect(lightColors).toHaveProperty('progressHead');
    expect(darkColors).not.toHaveProperty('progressShimmer');
    expect(lightColors).not.toHaveProperty('progressShimmer');
    expect(schema.properties.colors.properties).toHaveProperty('progressHead');
    expect(schema.properties.colors.properties).not.toHaveProperty('progressShimmer');
  });

  it('uses six-digit hex values in both palettes', () => {
    for (const palette of [darkColors, lightColors]) {
      for (const [token, value] of Object.entries(palette)) {
        expect(value, token).toMatch(HEX_PATTERN);
      }
    }
  });

  it('meets light-palette WCAG contrast floors against white', () => {
    for (const token of textTokens) {
      expect(contrastRatio(lightColors[token], '#FFFFFF'), token).toBeGreaterThanOrEqual(4.5);
    }
    for (const token of chromeTokens) {
      expect(contrastRatio(lightColors[token], '#FFFFFF'), token).toBeGreaterThanOrEqual(3);
    }
  });

  it('meets the dark-palette contrast floor against black', () => {
    const exempt = new Set<string>(exemptTokens);

    for (const [token, value] of Object.entries(darkColors)) {
      if (exempt.has(token)) continue;
      expect(contrastRatio(value, '#000000'), token).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps inverse text readable on every filled surface', () => {
    for (const palette of [darkColors, lightColors]) {
      for (const fill of ['progressFill', 'selectionBg', 'surfaceHighlight'] as const) {
        expect(contrastRatio(palette.inverseText, palette[fill]), fill).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps every shimmer visibly distinct from its base token', () => {
    for (const palette of [darkColors, lightColors]) {
      for (const [shimmer, base] of shimmerPairs) {
        expect(meanChannelDelta(palette[shimmer], palette[base]), shimmer).toBeGreaterThanOrEqual(
          16,
        );
      }
    }
  });

  it('keeps agent identity hues pairwise distinct', () => {
    expect.hasAssertions();
    expectPairwiseHueDistance(darkColors, agentTokens, 25);
    expectPairwiseHueDistance(lightColors, agentTokens, 25);
  });

  it('keeps rainbow hues pairwise distinct', () => {
    expect.hasAssertions();
    expectPairwiseHueDistance(darkColors, rainbowTokens, 20);
    expectPairwiseHueDistance(lightColors, rainbowTokens, 20);
  });

  it('keeps all pre-existing palette values unchanged', () => {
    expect(darkColors).toMatchObject(existingDarkColors);
    expect(lightColors).toMatchObject(existingLightColors);
  });
});

describe('colorize', () => {
  it('returns identity for an undefined color', () => {
    expect(colorize(undefined)('plain text')).toBe('plain text');
  });

  it('applies raw hex foreground and background colors directly', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;

    try {
      expect(colorize('#ff0000')('text')).toBe(chalk.hex('#ff0000')('text'));
      expect(colorize('#ff0000', 'background')('text')).toBe(
        chalk.bgHex('#ff0000')('text'),
      );
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('resolves a palette token when the curried function is called', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    const applyPrimary = colorize('primary');

    try {
      const darkOutput = applyPrimary('text');
      currentTheme.setPalette(lightColors);
      const lightOutput = applyPrimary('text');

      expect(darkOutput).toBe(chalk.hex(darkColors.primary)('text'));
      expect(lightOutput).toBe(chalk.hex(lightColors.primary)('text'));
      expect(lightOutput).not.toBe(darkOutput);
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('returns identity for an unknown palette token', () => {
    expect(colorize('removedToken' as ColorSpec)('plain text')).toBe('plain text');
  });

  it('ignores an unknown token retained by a custom palette', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    const customPalette = { ...darkColors, removedToken: '#FF0000' };
    currentTheme.setPalette(customPalette);

    try {
      expect(colorize('removedToken' as ColorSpec)('plain text')).toBe('plain text');
    } finally {
      chalk.level = previousLevel;
    }
  });
});
