import chalk from 'chalk';

import { darkColors } from './colors';
import { currentTheme, type ColorToken } from './theme';

export type ColorSpec = ColorToken | `#${string}`;

/** Curried theme-aware colourizer: resolves a palette token or a raw hex to a
 *  reusable text transformer. `undefined` returns the identity function. */
export function colorize(
  spec: ColorSpec | undefined,
  variant: 'foreground' | 'background' = 'foreground',
): (text: string) => string {
  if (spec === undefined) return (text) => text;

  if (spec.startsWith('#')) {
    return variant === 'background' ? chalk.bgHex(spec) : chalk.hex(spec);
  }

  return (text) => {
    if (!Object.hasOwn(darkColors, spec)) return text;

    const color = currentTheme.palette[spec as ColorToken];
    return variant === 'background' ? chalk.bgHex(color)(text) : chalk.hex(color)(text);
  };
}
