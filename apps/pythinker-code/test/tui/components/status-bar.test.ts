import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import {
  StatusBarComponent,
  type StatusBarStatus,
} from '#/tui/components/chrome/status-bar';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { currentTheme, darkColors } from '#/tui/theme';

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
    fastMode: false,
    dynamicWorkflowMode: true,
    extras: [],
    sessionKey: 'session-alpha',
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
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

  it('omits the effort suffix when thinking is off', () => {
    const component = new StatusBarComponent();
    component.update(status({ thinkingLevel: 'off' }));

    const line = stripAnsi(component.render(80)[0] ?? '');

    expect(line).toContain('Model Alpha');
    expect(line).not.toContain('· off');
  });

  it('hides the model chip when showModel is false', () => {
    const component = new StatusBarComponent();
    component.update(status({
      statusLine: { ...DEFAULT_STATUS_LINE_CONFIG, showModel: false },
    }));

    expect(stripAnsi(component.render(80)[0] ?? '')).not.toContain('Model Alpha');
  });

  it('hides the modes chip when showModes is false', () => {
    const component = new StatusBarComponent();
    component.update(status({
      statusLine: { ...DEFAULT_STATUS_LINE_CONFIG, showModes: false },
    }));

    const line = stripAnsi(component.render(80)[0] ?? '');

    expect(line).not.toContain('plan');
    expect(line).not.toContain('auto');
    expect(line).not.toContain('workflow');
  });

  it('hides only the effort suffix when showEffort is false', () => {
    const component = new StatusBarComponent();
    component.update(status({
      statusLine: { ...DEFAULT_STATUS_LINE_CONFIG, showEffort: false },
    }));

    const line = stripAnsi(component.render(80)[0] ?? '');

    expect(line).toContain('Model Alpha');
    expect(line).not.toContain('· high');
  });

  it('renders yolo with the error colour', () => {
    const previousLevel = chalk.level;
    const previousPalette = currentTheme.palette;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);

    try {
      const component = new StatusBarComponent();
      component.update(status({ permissionMode: 'yolo' }));

      expect(component.render(80)[0] ?? '').toContain(chalk.hex(darkColors.error)('yolo'));
    } finally {
      chalk.level = previousLevel;
      currentTheme.setPalette(previousPalette);
    }
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
      const lines = component.render(width);
      expect(lines).toHaveLength(1);
      expect(visibleWidth(lines[0]!)).toBeLessThanOrEqual(width);
    }
  });

  it('renders fast mode', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;
    const component = new StatusBarComponent();
    component.update(status({ fastMode: true }));

    try {
      expect(stripAnsi(component.render(80)[0] ?? '')).toContain('↯ fast');
    } finally {
      chalk.level = previousLevel;
    }
  });

  it('renders extras in order between modes and cwd', () => {
    const component = new StatusBarComponent();
    component.update(status({ extras: ['6% · 55.6k/1M', 'main ± [PR#1]'] }));

    const line = stripAnsi(component.render(160)[0] ?? '');

    expect(line.indexOf('workflow')).toBeLessThan(line.indexOf('6% · 55.6k/1M'));
    expect(line.indexOf('6% · 55.6k/1M')).toBeLessThan(line.indexOf('main ± [PR#1]'));
    expect(line.indexOf('main ± [PR#1]')).toBeLessThan(line.indexOf('~/project'));
  });

  it('drops extras from the tail before the modes and cwd chips', () => {
    const component = new StatusBarComponent();
    component.update(status({ extras: ['first', 'second'] }));

    const line = stripAnsi(component.render(62)[0] ?? '');

    expect(line).toContain('Model Alpha');
    expect(line).toContain('first');
    expect(line).not.toContain('second');
    expect(line).toContain('workflow');
    expect(line).toContain('~/project');
  });

  it.each([
    [
      '/Users/test/Projects/active/pythinker-code-tsc/apps/pythinker-code',
      '/Users/test',
      '…/apps/pythinker-code',
    ],
    ['/Users/test/Projects/active', '/Users/test', '~/Projects/active'],
    ['/Users/test', '/Users/test', '~'],
    ['/a/b/c/d', '/Users/test', '…/c/d'],
  ])('shortens cwd %s to %s', (cwd, homeDir, expected) => {
    const component = new StatusBarComponent();
    component.update(status({ cwd, homeDir }));

    expect(stripAnsi(component.render(240)[0] ?? '')).toContain(expected);
  });
});
