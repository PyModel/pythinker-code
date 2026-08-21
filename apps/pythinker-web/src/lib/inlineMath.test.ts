// apps/pythinker-web/src/lib/inlineMath.test.ts
import { describe, expect, it } from 'vitest';
import { buildInlineMathMatcher } from './inlineMath';

/** First match at/before `pos` (scan candidates forward for a match). */
function matchAt(text: string, pos: number): { content: string; end: number } | null {
  const matcher = buildInlineMathMatcher(text);
  return matcher(pos);
}

/** True when the `$` at `pos` opens a math span (and it closes before EOL). */
function isMath(text: string, pos: number): boolean {
  const m = matchAt(text, pos);
  return m !== null && text.charAt(m.end - 1) === '$';
}

describe('buildInlineMathMatcher', () => {
  it('renders plain inline math', () => {
    expect(isMath('$x^2$', 0)).toBe(true);
    expect(matchAt('$x^2$', 0)).toEqual({ content: 'x^2', end: 5 });
    expect(isMath('$E=mc^2$', 0)).toBe(true);
    expect(isMath('value $\\alpha$ here', 6)).toBe(true);
    expect(matchAt('value $\\alpha$ here', 6)).toEqual({ content: '\\alpha', end: 14 });
  });

  it('rejects prices and numbers', () => {
    expect(isMath('$5', 0)).toBe(false);
    expect(isMath('price is $10.99', 9)).toBe(false);
    expect(isMath('$5.99 and $7.50', 0)).toBe(false);
    expect(isMath('($5.99)', 1)).toBe(false);
    expect(isMath('5$10', 1)).toBe(false);
    expect(isMath('100 to 200 $', 0)).toBe(false);
  });

  it('rejects env vars and shell-style tokens', () => {
    expect(isMath('$PATH', 0)).toBe(false);
    expect(isMath('$HOME/bin', 0)).toBe(false);
    expect(isMath('run $cmd --flag', 4)).toBe(false);
    expect(isMath('$5 $10', 0)).toBe(false);
    expect(isMath('scope $includes', 6)).toBe(false);
  });

  it('rejects currency codes before or after the dollar', () => {
    expect(isMath('US$5', 2)).toBe(false);
    expect(isMath('$HK', 0)).toBe(false);
    expect(isMath('$10USD$', 0)).toBe(false);
  });

  it('rejects template-literal style spans', () => {
    expect(isMath('${NAME}', 0)).toBe(false);
    expect(isMath('a ${b} c', 2)).toBe(false);
  });

  it('skips dollars inside display math', () => {
    expect(isMath('$$x^2$$', 0)).toBe(false);
    expect(isMath('...$$x^2$$...', 3)).toBe(false);
  });

  it('refuses a backtick between the opening and closing dollar', () => {
    // A real `` `$x$` `` code span never reaches the inline rule (the backtick
    // rule consumes it first); the detector's own guard covers the residual
    // case of a backtick inside a candidate math span.
    expect(isMath('$x `y` z$', 0)).toBe(false);
  });

  it('leaves display math pairs untouched', () => {
    expect(isMath('$$a$$', 1)).toBe(false);
    expect(isMath('$$a$$', 0)).toBe(false);
  });

  it('accepts adjacent pairs and mid-sentence math', () => {
    const text = 'given $a$ and $b$';
    expect(matchAt(text, 6)).toEqual({ content: 'a', end: 9 });
    expect(matchAt(text, 14)).toEqual({ content: 'b', end: 17 });
  });

  it('ignores dollars inside URLs and link destinations', () => {
    expect(isMath('see https://x.test/$foo$ now', 17)).toBe(false);
    expect(isMath('[src](a/$b$)', 8)).toBe(false);
  });
});