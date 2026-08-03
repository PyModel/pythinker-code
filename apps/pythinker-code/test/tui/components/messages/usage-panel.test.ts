import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildContextUsageReportLines,
  buildCostReportLines,
  buildUsageReportLines,
  UsagePanelComponent,
} from '#/tui/components/messages/usage-panel';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';

afterEach(() => {
  currentTheme.setPalette(darkColors);
});

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UsagePanelComponent', () => {
  it('formats the model-visible context breakdown and active tools', () => {
    const lines = buildContextUsageReportLines({
      model: 'mock-model',
      estimatedTokens: 2_500,
      maxTokens: 10_000,
      percentage: 25,
      messageCount: 4,
      categories: [
        { name: 'System prompt', tokens: 1_000, percentage: 10 },
        { name: 'Tools', tokens: 500, percentage: 5 },
        { name: 'User messages', tokens: 250, percentage: 2.5 },
        { name: 'Free space', tokens: 7_500, percentage: 75 },
      ],
      tools: [
        { name: 'Read', source: 'builtin', tokens: 300 },
        { name: 'mcp__docs__search', source: 'mcp', tokens: 200 },
      ],
    }).map(strip);

    expect(lines[0]).toBe('mock-model  2.4k / 9.8k tokens (25%)');
    expect(lines).toContain('Estimated usage by category');
    expect(lines.join('\n')).toContain('System prompt');
    expect(lines.join('\n')).toContain('Read');
    expect(lines.join('\n')).toContain('mcp__docs__search');
  });

  it('formats session spend and current model token rates', () => {
    const text = buildCostReportLines({
      model: 'priced-model',
      totalCostUsd: 0.125,
      modelCostRates: {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    })
      .map(strip)
      .join('\n');

    expect(text).toContain('Session spend  $0.125');
    expect(text).toContain('Current model  priced-model');
    expect(text).toContain('Rates per 1M tokens');
    expect(text).toContain('$3 / 1M tokens');
    expect(text).toContain('$15 / 1M tokens');
    expect(text).toContain('$0.3 / 1M tokens');
    expect(text).toContain('$3.75 / 1M tokens');
  });

  it('reports unavailable spend and pricing without inventing zero values', () => {
    const text = buildCostReportLines({ model: 'unpriced-model' })
      .map(strip)
      .join('\n');

    expect(text).toContain('Session spend  unavailable');
    expect(text).toContain('Pricing unavailable for this model.');
    expect(text).not.toContain('$0');
  });

  it('formats session, context, and managed usage sections', () => {
    const lines = buildUsageReportLines({
      sessionUsage: {
        byModel: {
          pythinker: {
            inputOther: 1000,
            inputCacheRead: 500,
            inputCacheCreation: 500,
            output: 250,
          },
        },
      } as never,
      contextUsage: 0.25,
      contextTokens: 2500,
      maxContextTokens: 10000,
      managedUsage: {
        summary: {
          label: 'daily',
          used: 20,
          limit: 100,
          resetHint: 'resets tomorrow',
        },
        limits: [],
      },
    }).map(strip);

    expect(lines).toContain('Session usage');
    expect(lines).toContain('  pythinker  input 2k  output 250  total 2.2k');
    expect(lines).toContain('Context window');
    expect(lines.join('\n')).toContain('25%');
    expect(lines).toContain('Plan usage');
    expect(lines.join('\n')).toContain('20% used');
    expect(lines.join('\n')).toContain('resets tomorrow');
  });

  it('wraps preformatted usage lines in a bordered panel', () => {
    const component = new UsagePanelComponent(() => ['Session usage'], 'primary');
    const output = component.render(80).map(strip);

    expect(output[0]).toContain(' Usage ');
    expect(output[1]).toContain('Session usage');
  });

  it('truncates lines wider than the terminal so the panel never overflows', () => {
    const longLine = 'error: ' + 'x'.repeat(200);
    const component = new UsagePanelComponent(() => [longLine], 'primary');
    const width = 60;

    const output = component.render(width);

    for (const line of output) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it('keeps the bordered panel within narrow terminal widths', () => {
    const component = new UsagePanelComponent(() => ['Session usage', '  pythinker  input 2.0k'], 'primary');

    for (const width of [39, 24, 20, 10, 4, 1]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('rebuilds its body from the active palette on invalidate', () => {
    // Emit the resolved palette value as visible text so the assertion holds
    // regardless of chalk's colour level in the test environment.
    const component = new UsagePanelComponent(() => [`text=${currentTheme.color('text')}`], 'primary');
    const bodyOf = (): string => {
      const line = component.render(80).map(strip).find((l) => l.includes('text='));
      if (line === undefined) throw new Error('body line not found');
      return line;
    };

    expect(bodyOf()).toContain(darkColors.text);
    currentTheme.setPalette(lightColors);
    component.invalidate();
    expect(bodyOf()).toContain(lightColors.text);
  });
});
