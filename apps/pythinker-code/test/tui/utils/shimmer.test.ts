import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentTheme, darkColors } from '#/tui/theme';
import { shimmerText } from '#/tui/utils/shimmer';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/gu, '');
}

describe('shimmerText', () => {
  let previousLevel = chalk.level;
  let previousPalette = currentTheme.palette;

  beforeEach(() => {
    previousLevel = chalk.level;
    previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    chalk.level = previousLevel;
    currentTheme.setPalette(previousPalette);
  });

  it('preserves the input text when ANSI is removed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const text = 'Thinking carefully';

    expect(
      stripAnsi(
        shimmerText(text, {
          baseToken: 'primary',
          shimmerToken: 'primaryShimmer',
        }),
      ),
    ).toBe(text);
  });

  it('moves the cosine band with wall-clock time', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    const first = shimmerText('abcdefghijklmno', {
      baseToken: 'primary',
      shimmerToken: 'primaryShimmer',
    });
    now.mockReturnValue(100);
    const second = shimmerText('abcdefghijklmno', {
      baseToken: 'primary',
      shimmerToken: 'primaryShimmer',
    });

    expect(second).not.toBe(first);
  });

  it('alternates the peak token after one full sweep', () => {
    const now = vi.spyOn(Date, 'now');
    const options = {
      baseToken: 'primary' as const,
      shimmerToken: 'primaryShimmer' as const,
      altShimmerToken: 'warningShimmer' as const,
      bandHalfWidth: 1,
    };

    now.mockReturnValue(50);
    const first = shimmerText('abcde', options);
    now.mockReturnValue(400);
    const second = shimmerText('abcde', options);

    expect(first).toContain(chalk.hex(darkColors.primaryShimmer).bold('a'));
    expect(second).toContain(chalk.hex(darkColors.warningShimmer).bold('a'));
  });

  it('keeps the primary peak token when no alternate is set', () => {
    const now = vi.spyOn(Date, 'now');
    const options = {
      baseToken: 'primary' as const,
      shimmerToken: 'primaryShimmer' as const,
      bandHalfWidth: 1,
    };

    now.mockReturnValue(50);
    const first = shimmerText('abcde', options);
    now.mockReturnValue(400);
    const second = shimmerText('abcde', options);

    expect(first).toContain(chalk.hex(darkColors.primaryShimmer).bold('a'));
    expect(second).toContain(chalk.hex(darkColors.primaryShimmer).bold('a'));
  });

  it('advances the band at twenty cells per second', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);

    const output = shimmerText('abcdefghijklmno', {
      baseToken: 'primary',
      shimmerToken: 'primaryShimmer',
      bandHalfWidth: 1,
    });

    expect(output).toContain(chalk.hex(darkColors.primaryShimmer).bold('b'));
    expect(output).not.toContain(chalk.hex(darkColors.primaryShimmer).bold('c'));
  });
});
