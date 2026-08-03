import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { describe, expect, it } from 'vitest';

import { UserMessageComponent } from '#/tui/components/messages/user-message';
import { darkColors } from '#/tui/theme/colors';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('UserMessageComponent', () => {
  it('renders video placeholders as plain text, not inline image escapes', () => {
    const component = new UserMessageComponent(
      'please inspect [video #1 sample.mov]',
      [],
    );

    const out = stripAnsi(component.render(80).join('\n'));

    expect(out).toContain('[video #1 sample.mov]');
    expect(out).not.toContain('\u001B_G');
    expect(out).not.toContain('\u001B]1337;File=');
  });

  it('keeps user lines within very narrow widths', () => {
    const component = new UserMessageComponent('please inspect the attached output', []);

    for (const width of [1, 2, 4, 10, 39]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('renders user rows with strong neutral text on the highlighted surface', () => {
    const previousLevel = chalk.level;
    chalk.level = 3;

    try {
      const component = new UserMessageComponent('please inspect the attached output', []);
      const out = component.render(60).join('\n');

      expect(out).toContain(chalk.hex(darkColors.textStrong)('please inspect the attached output'));
      expect(out).toContain(`\u001B[48;2;28;34;56m`);
      expect(out).not.toContain(chalk.hex(darkColors.roleUser)('please inspect the attached output'));
    } finally {
      chalk.level = previousLevel;
    }
  });
});
