import chalk from 'chalk';
import { visibleWidth, type TUI } from '@pymodel/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { ThinkingComponent } from '#/tui/components/messages/thinking';
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
  getThinkingSpinnerLabel,
  THINKING_SPINNER_LABEL_INTERVAL_MS,
  THINKING_SPINNER_LABELS,
} from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const longThinking = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');

describe('thinking labels', () => {
  it('rotates labels at the configured interval', () => {
    expect(getThinkingSpinnerLabel(0)).toBe('thinking');
    expect(getThinkingSpinnerLabel(THINKING_SPINNER_LABEL_INTERVAL_MS - 1)).toBe('thinking');
    expect(getThinkingSpinnerLabel(THINKING_SPINNER_LABEL_INTERVAL_MS)).toBe('reasoning');
    expect(
      getThinkingSpinnerLabel(THINKING_SPINNER_LABELS.length * THINKING_SPINNER_LABEL_INTERVAL_MS),
    ).toBe('thinking');
    expect(formatThinkingSpinnerLabel(0)).toBe('thinking…');
  });
});

describe('ThinkingComponent', () => {
  it('shows only the live spinner header while collapsed', () => {
    const component = new ThinkingComponent('working it out', true, 'live');
    const out = strip(component.render(80).join('\n'));
    const label = formatThinkingSpinnerLabel();

    expect(out).toContain(`⣷ ${label}`);
    expect(out).not.toContain(`  ⣷ ${label}`);
    expect(out).not.toContain(`${STATUS_BULLET}⣷`);
    expect(out).not.toContain('working it out');
  });

  it('keeps expanded live thinking height-limited to the tail', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.setExpanded(true);
    const out = strip(component.render(80).join('\n'));

    expect(out).not.toContain('line1');
    expect(out).not.toContain('line4');
    expect(out).not.toContain('line5');
    expect(out).toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('refreshes the live indicator and stops on finalize', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    const requestRender = vi.fn();
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender,
    } as unknown as TUI);

    try {
      const firstHeader = component.render(80)[1];
      expect(strip(firstHeader ?? '')).toBe(`⣷ ${formatThinkingSpinnerLabel(0)}`);
      expect(firstHeader).toContain(chalk.hex(darkColors.primary)('⣷ '));

      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS);
      expect(requestRender).toHaveBeenCalled();
      const secondHeader = component.render(80)[1];
      expect(strip(secondHeader ?? '')).toBe(
        `${BRAILLE_SPINNER_FRAMES[1]} ${formatThinkingSpinnerLabel(0)}`,
      );

      component.finalize();
      requestRender.mockClear();
      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS * 2);
      expect(requestRender).not.toHaveBeenCalled();
    } finally {
      component.dispose();
      currentTheme.setPalette(previousPalette);
      chalk.level = previousLevel;
      vi.useRealTimers();
    }
  });

  it('finalizes in place into a hint while collapsed', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');

    component.finalize();

    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('more lines, ctrl+o to expand');
    expect(out).not.toContain('line1');
  });

  it('shows the finalized content line count only while collapsed', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    const collapsed = strip(component.render(80).join('\n'));
    expect(collapsed).toContain('(7 more lines, ctrl+o to expand)');

    component.setExpanded(true);
    const expanded = strip(component.render(80).join('\n'));
    expect(expanded).not.toContain('ctrl+o to expand');
  });

  it('expands and collapses after finalization', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    component.setExpanded(true);
    const expanded = strip(component.render(80).join('\n'));
    expect(expanded).toContain('line1');
    expect(expanded).toContain('line7');
    expect(expanded).not.toContain('ctrl+o to expand');

    component.setExpanded(false);
    expect(strip(component.render(80).join('\n'))).toContain('ctrl+o to expand');
  });

  it('keeps expanded finalized lines within the requested render width', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();
    component.setExpanded(true);

    for (const line of component.render(37)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
  });

  it('reapplies the active theme after finalized content is invalidated', () => {
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    const component = new ThinkingComponent('final text', true, 'live');
    component.finalize();
    component.setExpanded(true);
    const dark = component.render(80).join('');

    currentTheme.setPalette(lightColors);
    component.invalidate();
    const light = component.render(80).join('');

    try {
      expect(strip(dark)).toBe(strip(light));
      expect(dark).not.toBe(light);
    } finally {
      component.dispose();
      currentTheme.setPalette(previousPalette);
      chalk.level = previousLevel;
    }
  });
});
