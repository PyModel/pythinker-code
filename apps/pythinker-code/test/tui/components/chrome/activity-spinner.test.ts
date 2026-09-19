import type { TUI } from '@pymodel/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActivitySpinner } from '#/tui/components/chrome/activity-spinner';
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
} from '#/tui/constant/rendering';

// ActivitySpinner starts a real setInterval in its constructor, so every spinner
// created in these tests must be stopped to avoid leaving live timers behind.
const loaders: ActivitySpinner[] = [];

function createLoader(): ActivitySpinner {
  const ui = { requestRender() {} } as unknown as TUI;
  const loader = new ActivitySpinner(ui);
  loaders.push(loader);
  return loader;
}

afterEach(() => {
  for (const loader of loaders) loader.stop();
  loaders.length = 0;
  vi.useRealTimers();
});

describe('ActivitySpinner', () => {
  it('keeps the tip out of renderInline so it does not squeeze against the dynamic_workflow progress bar', () => {
    const loader = createLoader();
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const inline = loader.renderInline();
    expect(inline).not.toContain('Tip');
    expect(inline).not.toContain('steer');
    expect(inline.trim().length).toBeGreaterThan(0);
  });

  it('still shows the tip on its own row when width allows', () => {
    const loader = createLoader();
    loader.setTip(' · Tip: ctrl+s: steer mid-turn');
    loader.setAvailableWidth(80);

    const row = loader.render(80).join('\n');
    expect(row).toContain('Tip: ctrl+s: steer mid-turn');
  });

  it('uses the shared Braille mark for the waiting state', () => {
    expect(createLoader().renderInline()).toBe(BRAILLE_SPINNER_FRAMES[0]);
  });

  it('uses the shared Braille mark and shimmer verb labels while allowing retry text to win', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ui = { requestRender() {} } as unknown as TUI;
    const loader = new ActivitySpinner(ui, undefined, '', { verbLabels: true });
    loaders.push(loader);
    const stripAnsi = (text: string): string => text.replaceAll(/\u001B\[[0-9;]*m/g, '');

    expect(stripAnsi(loader.renderInline())).toBe(
      `${BRAILLE_SPINNER_FRAMES[0]} ${formatThinkingSpinnerLabel(0)}`,
    );
    vi.advanceTimersByTime(BRAILLE_SPINNER_INTERVAL_MS);
    expect(stripAnsi(loader.renderInline())).toBe(
      `${BRAILLE_SPINNER_FRAMES[1]} ${formatThinkingSpinnerLabel(0)}`,
    );

    loader.setLabel('Retrying in 1s');
    expect(stripAnsi(loader.renderInline())).toBe(`${BRAILLE_SPINNER_FRAMES[1]} Retrying in 1s`);
    expect(stripAnsi(loader.renderInline())).not.toContain('thinking');

    loader.setVerbLabels(true);
    expect(stripAnsi(loader.renderInline())).toContain(`${BRAILLE_SPINNER_FRAMES[1]} ${formatThinkingSpinnerLabel(0)}`);
  });
});
