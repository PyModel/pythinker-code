import chalk from 'chalk';
import { beforeAll, describe, expect, it } from 'vitest';

import { highlightFirstSlashToken } from '#/tui/components/editor/custom-editor';
import { currentTheme } from '#/tui/theme';

beforeAll(() => {
  chalk.level = 3;
});

function strip(s: string): string {
  return s.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function cursorLine(text: string, cursorCol: number): string {
  const before = text.slice(0, cursorCol);
  const after = text.slice(cursorCol);
  if (after.length === 0) return `${before}\u001B[7m \u001B[0m`;
  return `${before}\u001B[7m${after[0]}\u001B[0m${after.slice(1)}`;
}

describe('highlightFirstSlashToken', () => {
  it('colours /cmd when the cursor is inside a leading slash token', () => {
    const input = cursorLine('  /help rest of input', '  /he'.length);
    const out = highlightFirstSlashToken(input, 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe(strip(input));
    expect(out!).toContain('/he');
  });

  it('supports a text-strong white highlight for the active composer command', () => {
    const input = cursorLine('/help', '/help'.length);
    const out = highlightFirstSlashToken(input, 'textStrong');

    expect(out).toContain(currentTheme.boldFg('textStrong', '/help'));
  });

  it('reapplies the text-strong highlight after an in-token cursor reset', () => {
    const input = cursorLine('/help', 2);
    const out = highlightFirstSlashToken(input, 'textStrong');

    expect(out).toContain(`\u001B[0m${currentTheme.boldFg('textStrong', 'lp')}`);
  });

  it('colours slash commands in the middle of the prompt', () => {
    const input = cursorLine('ship with /help later', 'ship with /he'.length);
    const out = highlightFirstSlashToken(input, 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe(strip(input));
    expect(out!).toContain('/he');
  });

  it('colours next in /goal next', () => {
    const input = cursorLine('/goal next Ship feature X', '/goal next'.length);
    const out = highlightFirstSlashToken(input, 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe(strip(input));
    expect(out!).toContain('/goal');
    expect(out!).toContain('next');
    expect(strip(out!)).toContain(' Ship feature X');
  });

  it('colours manage in /goal next manage', () => {
    const input = cursorLine('/goal next manage', '/goal next manage'.length);
    const out = highlightFirstSlashToken(input, 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe(strip(input));
    expect(out!).toContain('/goal');
    expect(out!).toContain('next');
    expect(out!).toContain('manage');
  });

  it('returns undefined when the line has no slash', () => {
    expect(highlightFirstSlashToken(cursorLine('hello world', 5), 'primary')).toBeUndefined();
  });

  it('returns undefined for path-like slash tokens', () => {
    expect(highlightFirstSlashToken(cursorLine('/user/desktop/ foo', 5), 'primary')).toBeUndefined();
  });

  it('handles /token at end of line (no trailing whitespace)', () => {
    const out = highlightFirstSlashToken(cursorLine('/exit', '/exit'.length), 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe('/exit ');
  });

  it('passes through pre-existing ANSI (e.g. cursor inverse) in the tail', () => {
    const line = cursorLine('/help x', '/he'.length).replace('x', '\u001B[36mx\u001B[0m');
    const out = highlightFirstSlashToken(line, 'primary');
    expect(out).toBeDefined();
    expect(strip(out!)).toBe(strip(line));
    expect(out!.includes('\u001B[36m')).toBe(true);
  });
});
