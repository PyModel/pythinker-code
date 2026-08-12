import chalk from 'chalk';
import { visibleWidth, type TUI } from '@earendil-works/pi-tui';
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
import { currentTheme, darkColors } from '#/tui/theme';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const longThinking = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');

describe('getThinkingSpinnerLabel', () => {
  it('rotates labels at the configured interval', () => {
    expect(getThinkingSpinnerLabel(0)).toBe('thinking');
    expect(getThinkingSpinnerLabel(THINKING_SPINNER_LABEL_INTERVAL_MS - 1)).toBe('thinking');
    expect(getThinkingSpinnerLabel(THINKING_SPINNER_LABEL_INTERVAL_MS)).toBe('reasoning');
    expect(
      getThinkingSpinnerLabel(THINKING_SPINNER_LABELS.length * THINKING_SPINNER_LABEL_INTERVAL_MS),
    ).toBe('thinking');
  });
});

describe('ThinkingComponent', () => {
  it('shows the live spinner header before thinking content', () => {
    const component = new ThinkingComponent('working it out', true, 'live');
    const out = strip(component.render(80).join('\n'));
    const label = formatThinkingSpinnerLabel();

    expect(out).toContain(`⠋ ${label}`);
    expect(out).not.toContain(`  ⠋ ${label}`);
    expect(out).not.toContain(`${STATUS_BULLET}⠋`);
    expect(out).toContain('  working it out');
  });

  it('uses the primary activity color while thinking is live', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    const component = new ThinkingComponent('working it out', true, 'live');

    try {
      expect(component.render(80)[1]?.startsWith(currentTheme.fg('primary', '⠋ '))).toBe(true);
    } finally {
      component.dispose();
      chalk.level = previousLevel;
    }
  });

  it('keeps live thinking height-limited to the tail', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    const out = strip(component.render(80).join('\n'));

    expect(out).not.toContain('line1');
    expect(out).not.toContain('line4');
    expect(out).not.toContain('line5');
    expect(out).toContain('line6');
    expect(out).toContain('line7');
    expect(out).not.toContain('ctrl+o to expand');
  });

  it('animates the live spinner shimmer and stops on finalize', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const previousLevel = chalk.level;
    chalk.level = 3;
    const requestRender = vi.fn();
    const component = new ThinkingComponent('step', true, 'live', {
      requestRender,
    } as unknown as TUI);

    try {
      const firstHeader = component.render(80)[1];
      expect(strip(firstHeader ?? '')).toBe(`⠋ ${formatThinkingSpinnerLabel()}`);

      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS);
      expect(requestRender).toHaveBeenCalled();
      const secondHeader = component.render(80)[1];
      expect(strip(secondHeader ?? '')).toBe(`⠙ ${formatThinkingSpinnerLabel()}`);

      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS * (BRAILLE_SPINNER_FRAMES.length - 1));
      const fullCycleHeader = component.render(80)[1];
      expect(strip(fullCycleHeader ?? '')).toBe(strip(firstHeader ?? ''));

      const shimmerHeaders = [firstHeader, fullCycleHeader];
      for (let sample = 0; sample < 3; sample++) {
        vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS * BRAILLE_SPINNER_FRAMES.length);
        shimmerHeaders.push(component.render(80)[1]);
      }
      expect(shimmerHeaders.map((header) => strip(header ?? ''))).toEqual(
        shimmerHeaders.map(() => strip(firstHeader ?? '')),
      );
      expect(new Set(shimmerHeaders).size).toBeGreaterThan(1);

      component.finalize();
      requestRender.mockClear();
      vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS * 2);
      expect(requestRender).not.toHaveBeenCalled();
    } finally {
      component.dispose();
      chalk.level = previousLevel;
      vi.useRealTimers();
    }
  });

  it('finalizes in place into a collapsed preview', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');

    component.finalize();

    const out = strip(component.render(80).join('\n'));
    expect(out).toContain('line1');
    expect(out).toContain('line2');
    expect(out).not.toContain('line3');
    expect(out).not.toContain('line4');
    expect(out).toContain('... (5 more lines, ctrl+o to expand)');
  });

  it('expands and collapses after finalization', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    component.setExpanded(true);
    const expanded = strip(component.render(80).join('\n'));
    expect(expanded).toContain('line7');
    expect(expanded).not.toContain('ctrl+o to expand');

    component.setExpanded(false);
    const collapsed = strip(component.render(80).join('\n'));
    expect(collapsed).not.toContain('line7');
    expect(collapsed).toContain('ctrl+o to expand');
  });

  it('keeps the finalized truncation footer within the requested render width', () => {
    const component = new ThinkingComponent(longThinking, true, 'live');
    component.finalize();

    for (const line of component.render(37)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(37);
    }
  });
});
