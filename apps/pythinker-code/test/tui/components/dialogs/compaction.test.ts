import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompactionComponent } from '#/tui/components/dialogs/compaction';
import { BRAILLE_SPINNER_INTERVAL_MS } from '#/tui/constant/rendering';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

afterEach(() => {
  vi.useRealTimers();
  currentTheme.setPalette(darkColors);
});

function strip(text: string | undefined): string {
  return text?.replaceAll(/\u001B\[[0-9;]*m/gu, '') ?? '';
}

function ansiCodes(text: string | undefined): string[] {
  return text?.match(/\u001B\[[0-9;]*m/gu) ?? [];
}

describe('CompactionComponent', () => {
  it('renders the custom instruction below the compacting label', () => {
    const component = new CompactionComponent(undefined, 'keep the recent files only');

    try {
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compacting conversation…');
      expect(text).toContain('  keep the recent files only');
    } finally {
      component.dispose();
    }
  });

  it('renders a progress bar while compacting and drops it when finished', () => {
    const component = new CompactionComponent();

    try {
      const bar = component.render(120).map(strip).find((l) => l.includes('▱'));
      expect(bar).toBeDefined();
      // Two-space indent, a 40-cell bar, then the percentage.
      expect(bar).toMatch(/^ {2}[▰]*[▱]* \d+% *$/u);
      expect(Array.from(bar ?? '').filter((c) => c === '▰' || c === '▱')).toHaveLength(40);

      component.markDone(1000, 200);
      const afterLines = component.render(120).map(strip);
      expect(afterLines.join('\n')).not.toContain('▱');
      expect(afterLines.join('\n')).toContain('└ Compacted (1000 → 200 tokens)');
    } finally {
      component.dispose();
    }
  });

  it('shows elapsed seconds and advances the percentage once per second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const component = new CompactionComponent();

    try {
      vi.advanceTimersByTime(27_000);
      const lines = component.render(120).map(strip);
      expect(lines.map((line) => line.trimEnd())).toContain('Compacting conversation… (27s)');
      const bar = lines.find((line) => line.includes('▱'));
      expect(bar?.trimEnd()).toBe(`  ${'▰'.repeat(11)}${'▱'.repeat(29)} 27%`);
    } finally {
      component.dispose();
    }
  });

  it('keeps the progress bar static while header shimmer and elapsed time update', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    chalk.level = 3;
    const component = new CompactionComponent();

    try {
      vi.advanceTimersByTime(27_000);
      const firstRender = component.render(120);
      const firstHeader = firstRender.find((line) => strip(line).includes('Compacting conversation…'));
      const firstBar = firstRender.find((line) => strip(line).includes('▱'));

      expect(firstHeader).toBeDefined();
      expect(firstBar).toBeDefined();

      const headerSamples = [firstHeader];
      const barSamples = [firstBar];
      const shimmerSampleCount = 12;
      for (let sample = 0; sample < shimmerSampleCount; sample++) {
        vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS);
        const render = component.render(120);
        headerSamples.push(
          render.find((line) => strip(line).includes('Compacting conversation…')),
        );
        barSamples.push(render.find((line) => strip(line).includes('▱')));
      }

      expect(headerSamples.every((header) => header !== undefined)).toBe(true);
      expect(barSamples.every((bar) => bar !== undefined)).toBe(true);
      expect(new Set(headerSamples.map(strip))).toEqual(new Set([strip(firstHeader)]));
      expect(new Set(headerSamples).size).toBeGreaterThan(1);
      expect(new Set(barSamples)).toEqual(new Set([firstBar]));
      expect(strip(firstBar).trimEnd()).toBe(`  ${'▰'.repeat(11)}${'▱'.repeat(29)} 27%`);
      expect(firstBar).toContain(currentTheme.fg('primary', '▰'.repeat(11)));
      expect(firstBar).not.toContain(currentTheme.fg('progressFill', '▰'.repeat(11)));
      expect(firstBar).toContain(currentTheme.fg('progressEmpty', '▱'.repeat(29)));

      vi.advanceTimersByTime(
        1_000 - BRAILLE_SPINNER_INTERVAL_MS * shimmerSampleCount,
      );
      const elapsedRender = component.render(120);
      const elapsedHeader = elapsedRender.find((line) =>
        strip(line).includes('Compacting conversation…'),
      );
      const elapsedBar = elapsedRender.find((line) => strip(line).includes('▱'));

      expect(strip(elapsedHeader).trimEnd()).toBe('Compacting conversation… (28s)');
      expect(strip(elapsedBar).trimEnd()).toBe(`  ${'▰'.repeat(11)}${'▱'.repeat(29)} 28%`);
      expect(ansiCodes(elapsedBar)).toEqual(ansiCodes(firstBar));
    } finally {
      chalk.level = previousLevel;
      component.dispose();
    }
  });

  it('narrows the progress bar to fit a small terminal', () => {
    const component = new CompactionComponent();

    try {
      const bar = component.render(30).map(strip).find((l) => l.includes('▱'));
      expect(bar).toBeDefined();
      expect(Array.from(bar ?? '').filter((c) => c === '▰' || c === '▱')).toHaveLength(20);
    } finally {
      component.dispose();
    }
  });

  it('collapses to a ctrl+o hint and expands to the full summary', () => {
    const component = new CompactionComponent();

    try {
      component.markDone(1000, 200, 'First summary line.\nSecond summary line.');
      const collapsed = component.render(120).map(strip).join('\n');
      expect(collapsed).toContain('└ Compacted (ctrl+o to see full summary)');
      expect(collapsed).not.toContain('First summary line.');

      component.setExpanded(true);
      const expanded = component.render(120).map(strip).join('\n');
      // Expanded trades the hint for the token counts and shows the body.
      expect(expanded).toContain('└ Compacted (1000 → 200 tokens)');
      expect(expanded).toContain('First summary line.');
      expect(expanded).toContain('Second summary line.');

      component.setExpanded(false);
      expect(component.render(120).map(strip).join('\n')).not.toContain('First summary line.');
    } finally {
      component.dispose();
    }
  });

  it('omits the ctrl+o hint when compaction reported no summary', () => {
    const component = new CompactionComponent();

    try {
      component.markDone(1000, 200);
      const text = component.render(120).map(strip).join('\n');
      expect(text).toContain('└ Compacted (1000 → 200 tokens)');
      expect(text).not.toContain('ctrl+o');
    } finally {
      component.dispose();
    }
  });

  it('renders a cancelled terminal state', () => {
    const component = new CompactionComponent();

    try {
      component.markCanceled();
      const lines = component.render(120).map(strip);
      const text = lines.join('\n');

      expect(text).toContain('Compaction cancelled');
      expect(text).not.toContain('Compacting conversation…');
    } finally {
      component.dispose();
    }
  });

  it('repaints the header with the active palette on invalidate', () => {
    // Force truecolor so palette differences surface as ANSI codes even when
    // the test runner has no TTY.
    const previousLevel = chalk.level;
    chalk.level = 3;
    const component = new CompactionComponent();

    try {
      const headerOf = (): string => {
        const line = component.render(120).find((l) => strip(l).includes('Compacting conversation…'));
        if (line === undefined) throw new Error('header line not found');
        return line;
      };
      const before = headerOf();

      currentTheme.setPalette(lightColors);
      component.invalidate();
      const after = headerOf();

      // Same visible text, different ANSI colour codes.
      expect(strip(after)).toBe(strip(before));
      expect(after).not.toBe(before);
    } finally {
      chalk.level = previousLevel;
      component.dispose();
    }
  });
});
