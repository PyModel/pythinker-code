import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLogoHeaderRows,
  LOGO_EYES_OPEN,
  PYTHINKER_LOGO_LINES,
  PYTHINKER_LOGO_WIDTH,
  renderPythinkerLogo,
  renderPythinkerLogoEyeRow,
  renderPythinkerLogoLine,
  renderPythinkerLogoWithEyes,
} from '#/tui/components/chrome/pythinker-logo';

const TRUECOLOR_PATTERN = /\u001B\[38;2;(\d+);(\d+);(\d+)m/g;

function truecolorCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(TRUECOLOR_PATTERN)) {
    codes.add(`${match[1]},${match[2]},${match[3]}`);
  }
  return codes;
}

describe('pythinker logo', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('renders five logo rows with stable plain widths', () => {
    const lines = renderPythinkerLogo();
    expect(lines).toHaveLength(5);
    for (let index = 0; index < PYTHINKER_LOGO_LINES.length; index++) {
      const renderedLine = lines[index];
      const plainLine = PYTHINKER_LOGO_LINES[index];
      if (renderedLine === undefined || plainLine === undefined) {
        throw new Error(`Missing logo row ${index}`);
      }
      expect(visibleWidth(renderedLine)).toBe(visibleWidth(plainLine));
    }
    expect(PYTHINKER_LOGO_WIDTH).toBeGreaterThan(0);
  });

  it('uses multiple brand colors from the SVG palette', () => {
    const codes = new Set<string>();
    for (let index = 0; index < PYTHINKER_LOGO_LINES.length; index++) {
      for (const code of truecolorCodes(renderPythinkerLogoLine(index))) {
        codes.add(code);
      }
    }
    expect(codes.size).toBeGreaterThanOrEqual(3);
  });

  it('renders installer-style closed and glance eye phases', () => {
    const closed = renderPythinkerLogoEyeRow({ left: 'closed', right: 'open' });
    expect(closed).toContain('─');
    expect(closed).toContain('◉');

    const glance = renderPythinkerLogoEyeRow({ left: 'glance', right: 'open' });
    expect(glance).toContain('◉');
    expect(visibleWidth(glance)).toBe(visibleWidth(PYTHINKER_LOGO_LINES[3]));
  });

  it('keeps logo width stable across eye blink states', () => {
    const lines = renderPythinkerLogoWithEyes({ left: 'open-shine', right: 'closed' });
    expect(lines).toHaveLength(5);
    for (let index = 0; index < PYTHINKER_LOGO_LINES.length; index++) {
      const renderedLine = lines[index];
      const plainLine = PYTHINKER_LOGO_LINES[index];
      if (renderedLine === undefined || plainLine === undefined) {
        throw new Error(`Missing logo row ${index}`);
      }
      expect(visibleWidth(renderedLine)).toBe(visibleWidth(plainLine));
    }
  });

  it('anchors welcome copy to the logo face rows', () => {
    const plain = buildLogoHeaderRows(
      40,
      {
        eyebrow: '',
        title: 'Welcome headline',
        tagline: 'Review · Secure · Diagnose',
        prompt: 'Type /help for commands.',
      },
      (index) => renderPythinkerLogoLine(index),
    ).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));

    expect(plain[0]).not.toContain('Welcome headline');
    expect(plain[1]).not.toContain('Welcome headline');
    expect(plain[2]).toContain('Welcome headline');
    expect(plain[3]).toContain('Review · Secure · Diagnose');
    expect(plain[4]).toContain('/help');
  });

  it('keeps eyebrow-led headers starting on the antenna row', () => {
    const plain = buildLogoHeaderRows(
      40,
      {
        eyebrow: 'PYTHINKER CODE',
        title: 'Server ready',
        tagline: 'Local web UI is available.',
        prompt: '',
      },
      (index) => renderPythinkerLogoLine(index),
    ).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));

    expect(plain[0]).toContain('PYTHINKER CODE');
    expect(plain[1]).toContain('Server ready');
    expect(plain[2]).toContain('Local web UI is available.');
  });
});
