import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(import.meta.dirname, '../src/components/settings/settings.css'),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^{}]*)\\}`, 'u'));
  if (!match?.[1]) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1];
}

function declaration(selector: string, property: string): string {
  const escaped = property.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rule(selector).match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`, 'u'));
  if (!match?.[1]) throw new Error(`Missing ${property} in ${selector}`);
  return match[1].trim();
}

function resolvePx(value: string, fontSize: number, variables: Record<string, string> = {}): number {
  let expression = value.trim().replace(/^calc\((.*)\)$/u, '$1');
  expression = expression.replaceAll(/var\((--[\w-]+)\)/gu, (_match: string, name: string) => {
    if (name === '--ui-font-size') return String(fontSize);
    const variable = variables[name];
    if (variable === undefined) throw new Error(`Missing test variable: ${name}`);
    return String(resolvePx(variable, fontSize, variables));
  });
  expression = expression.replaceAll(/px\b/gu, '');
  if (!/^[\d\s.+*()-]+$/u.test(expression)) throw new Error(`Unsupported CSS arithmetic: ${value}`);

  // `calc()` requires whitespace around + and -, so splitting on the spaced
  // operator is both safe and a check that the expression is valid CSS.
  const parts = expression.split(/\s+([+-])\s+/u);
  let sum = 0;
  let sign = 1;
  for (const part of parts) {
    if (part === '+' || part === '-') {
      sign = part === '+' ? 1 : -1;
      continue;
    }
    const product = part.split(/\s*\*\s*/u).reduce((acc, factor) => acc * Number(factor), 1);
    if (Number.isNaN(product)) throw new Error(`Unsupported CSS arithmetic: ${value}`);
    sum += sign * product;
  }
  return sum;
}

function transformDistance(selector: string, variables: Record<string, string>, fontSize: number): number {
  const transform = declaration(selector, 'transform');
  const match = transform.match(/^translateX\((.*)\)$/u);
  if (!match?.[1]) throw new Error(`Missing translateX in ${selector}`);
  return resolvePx(match[1], fontSize, variables);
}

function splitCssValues(value: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (/\s/u.test(value[index]!) && depth === 0) {
      if (start < index) values.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (start < value.length) values.push(value.slice(start));
  return values;
}

type SwitchSize = '' | 'base' | 'small';

function switchVariables(size: Exclude<SwitchSize, ''>): Record<string, string> {
  return {
    '--switch-knob-size': declaration(size === 'base' ? '.switch' : '.switch.sm', '--switch-knob-size'),
  };
}

const derivedSizes = [
  ['.row', 'min-height', 34, ''],
  ['.act', 'padding-top', 6, ''],
  ['.act', 'padding-right', 12, ''],
  ['.icon-btn', 'width', 24, ''],
  ['.icon-btn', 'height', 24, ''],
  ['.icon-btn svg', 'width', 15, ''],
  ['.icon-btn svg', 'height', 15, ''],
  ['.switch', 'width', 40, 'base'],
  ['.switch', 'height', 22, 'base'],
  ['.switch.sm', 'width', 30, 'small'],
  ['.switch.sm', 'height', 17, 'small'],
  ['.knob', 'width', 18, 'base'],
  ['.knob', 'height', 18, 'base'],
  ['.switch.sm .knob', 'width', 13, 'small'],
  ['.switch.sm .knob', 'height', 13, 'small'],
] as const;

function sizeValue(selector: string, property: string): string {
  if (selector === '.act' && property.startsWith('padding-')) {
    const padding = splitCssValues(declaration('.act', 'padding'));
    return property === 'padding-top' || property === 'padding-bottom' ? padding[0]! : padding[1]!;
  }
  return declaration(selector, property);
}

describe('settings design tokens', () => {
  it('rejects raw colours and dark-mode utilities', () => {
    expect(css.match(/#[\da-f]{3,8}\b/giu) ?? []).toHaveLength(0);
    expect(css.match(/\brgba?\s*\(/gu) ?? []).toHaveLength(0);
    expect(css.match(/\bdark:/gu) ?? []).toHaveLength(0);
  });

  it('allows only token, pill, and circle radii and maps the five named radii', () => {
    const radii = [...css.matchAll(/border-radius\s*:\s*([^;]+);/gu)].map((match) => match[1]!.trim());

    expect(radii.length).toBeGreaterThan(0);
    expect(radii.filter((radius) => !/^(?:var\(--r-[\w-]+\)|999px|50%)$/u.test(radius))).toEqual([]);

    const mappings = {
      '.tag': '--r-xs',
      '.act': '--r-sm',
      '.icon-btn': '--r-sm',
      '.page-search': '--r-sm',
      '.stat-card': '--r-md',
    } as const;
    for (const [selector, token] of Object.entries(mappings)) {
      expect(declaration(selector, 'border-radius')).toBe(`var(${token})`);
    }
  });

  it('uses the ink token for the knob shadow', () => {
    expect(declaration('.knob', 'box-shadow')).toBe(
      '0 1px 2px color-mix(in srgb, var(--ink) 20%, transparent)',
    );
  });

  it('keeps every listed control size at its current 14px value', () => {
    for (const [selector, property, expected, size] of derivedSizes) {
      const variables = size === '' ? {} : switchVariables(size);
      const value = sizeValue(selector, property);
      expect(value).toMatch(/calc\(|var\(--switch-knob-size\)/u);
      expect(resolvePx(value, 14, variables)).toBeCloseTo(expected, 5);
    }

    expect(transformDistance('.switch.on .knob', switchVariables('base'), 14)).toBeCloseTo(18, 5);
    expect(transformDistance('.switch.sm.on .knob', switchVariables('small'), 14)).toBeCloseTo(13, 5);
  });

  it('grows every listed control size when the UI font grows to 20px', () => {
    for (const [selector, property, _expected, size] of derivedSizes) {
      const variables = size === '' ? {} : switchVariables(size);
      expect(resolvePx(sizeValue(selector, property), 20, variables)).toBeGreaterThan(
        resolvePx(sizeValue(selector, property), 14, variables),
      );
    }
    expect(transformDistance('.switch.on .knob', switchVariables('base'), 20)).toBeGreaterThan(
      transformDistance('.switch.on .knob', switchVariables('base'), 14),
    );
    expect(transformDistance('.switch.sm.on .knob', switchVariables('small'), 20)).toBeGreaterThan(
      transformDistance('.switch.sm.on .knob', switchVariables('small'), 14),
    );
  });

  it('derives switch tracks and travel from the same knob size', () => {
    for (const [fontSize, size, trackSelector, travelSelector] of [
      [14, 'base', '.switch', '.switch.on .knob'],
      [14, 'small', '.switch.sm', '.switch.sm.on .knob'],
      [20, 'base', '.switch', '.switch.on .knob'],
      [20, 'small', '.switch.sm', '.switch.sm.on .knob'],
    ] as const) {
      const variables = switchVariables(size);
      const knob = resolvePx(variables['--switch-knob-size'], fontSize, variables);
      const trackWidth = resolvePx(declaration(trackSelector, 'width'), fontSize, variables);
      const trackHeight = resolvePx(declaration(trackSelector, 'height'), fontSize, variables);
      const travel = transformDistance(travelSelector, variables, fontSize);

      expect(trackWidth).toBeCloseTo(knob + travel + 4, 5);
      expect(trackHeight).toBeCloseTo(knob + 4, 5);
      expect(travel).toBeCloseTo(knob, 5);
    }
  });
});
