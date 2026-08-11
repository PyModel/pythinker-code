import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StatusBarComponent,
  type StatusBarStatus,
} from '#/tui/components/chrome/status-bar';
import { shimmerText } from '#/tui/utils/shimmer';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/gu, '');
}

function status(overrides: Partial<StatusBarStatus> = {}): StatusBarStatus {
  return {
    model: 'Model Alpha',
    thinkingLevel: 'high',
    cwd: '/Users/test/project',
    homeDir: '/Users/test',
    permissionMode: 'auto',
    planMode: true,
    dynamicWorkflowMode: true,
    sessionKey: 'session-alpha',
    ...overrides,
  };
}

describe('StatusBarComponent', () => {
  it('renders one line with the model and effort label', () => {
    const component = new StatusBarComponent();
    component.update(status());

    const lines = component.render(80);

    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0] ?? '')).toContain('Model Alpha · high');
  });

  it('drops the gap, modes, and cwd in that order as width shrinks', () => {
    const component = new StatusBarComponent();
    component.update(status());

    const wide = stripAnsi(component.render(60)[0] ?? '');
    const withoutGap = stripAnsi(component.render(53)[0] ?? '');
    const withoutModes = stripAnsi(component.render(45)[0] ?? '');
    const modelOnly = stripAnsi(component.render(25)[0] ?? '');

    expect(wide).toContain('─');
    expect(withoutGap).not.toContain('─');
    expect(withoutGap).toContain('workflow');
    expect(withoutGap).toContain('~/project');
    expect(withoutModes).not.toContain('workflow');
    expect(withoutModes).toContain('~/project');
    expect(modelOnly).toContain('Model Alpha');
    expect(modelOnly).not.toContain('~/project');
  });

  it('never renders past the available width', () => {
    const component = new StatusBarComponent();
    component.update(status());

    for (const width of [0, 1, 10, 25, 45, 53, 80]) {
      expect(visibleWidth(component.render(width)[0] ?? '')).toBeLessThanOrEqual(width);
    }
  });
});

describe('shimmerText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the input text when ANSI is removed', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const text = 'Thinking carefully';

    expect(
      stripAnsi(
        shimmerText(text, {
          baseToken: 'primary',
          shimmerToken: 'primaryShimmer',
          frame: 0,
        }),
      ),
    ).toBe(text);
  });

  it('moves the cosine band with wall-clock time', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(0);
      const first = shimmerText('abcdefghijklmno', {
        baseToken: 'primary',
        shimmerToken: 'primaryShimmer',
        frame: 0,
      });
      now.mockReturnValue(100);
      const second = shimmerText('abcdefghijklmno', {
        baseToken: 'primary',
        shimmerToken: 'primaryShimmer',
        frame: 0,
      });

      expect(second).not.toBe(first);
    } finally {
      chalk.level = previousLevel;
    }
  });
});
