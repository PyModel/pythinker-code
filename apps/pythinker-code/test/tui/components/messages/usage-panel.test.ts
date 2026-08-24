import { visibleWidth } from '@pymodel/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';

import { buildUsageReportLines, UsagePanelComponent } from '#/tui/components/messages/usage-panel';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

afterEach(() => {
  currentTheme.setPalette(darkColors);
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UsagePanelComponent', () => {
  it('formats session and context usage', () => {
    const lines = buildUsageReportLines({
      sessionUsage: {
        byModel: {
          example: {
            inputOther: 1000,
            inputCacheRead: 500,
            inputCacheCreation: 500,
            output: 250,
          },
        },
      },
      contextUsage: 0.25,
      contextTokens: 2500,
      maxContextTokens: 10000,
    }).map(strip);

    expect(lines).toContain('Session usage');
    expect(lines).toContain('  example  input 2k  output 250  total 2.2k');
    expect(lines).toContain('Context window');
    expect(lines.join('\n')).toContain('25%');
  });

  it('wraps usage lines in a bordered panel', () => {
    const output = new UsagePanelComponent(() => ['Session usage'], 'primary').render(80).map(strip);
    expect(output[0]).toContain(' Usage ');
    expect(output[1]).toContain('Session usage');
  });

  it('keeps the panel inside terminal widths', () => {
    const component = new UsagePanelComponent(() => ['error: ' + 'x'.repeat(200)], 'primary');
    for (const width of [60, 24, 10, 4, 1]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('rebuilds its body from the active palette on invalidate', () => {
    const component = new UsagePanelComponent(() => [`text=${currentTheme.color('text')}`], 'primary');
    const body = (): string => component.render(80).map(strip).find((line) => line.includes('text='))!;

    expect(body()).toContain(darkColors.text);
    currentTheme.setPalette(lightColors);
    component.invalidate();
    expect(body()).toContain(lightColors.text);
  });
});
