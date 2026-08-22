import { describe, expect, it } from 'vitest';

import { makeSnippet } from '../../src/search/snippet';

describe('makeSnippet', () => {
  it('centers the window on the first hit term', () => {
    const text = `${'a'.repeat(200)} needle ${'b'.repeat(200)}`;
    const snippet = makeSnippet(text, 'needle', 20);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(text.length);
  });

  it('matches case-insensitively', () => {
    expect(makeSnippet('Hello World', 'hello')).toBe('Hello World');
  });

  it('matches CJK terms', () => {
    const snippet = makeSnippet('\u6211\u4EEC\u9700\u8981\u91CD\u6784\u5168\u5C40\u641C\u7D22\u6A21\u5757\u4EE5\u652F\u6301\u4E2D\u6587', '\u641C\u7D22');
    expect(snippet).toContain('\u641C\u7D22');
  });

  it('uses the earliest occurrence across multiple terms', () => {
    const text = `${'x'.repeat(100)} beta ${'x'.repeat(100)} alpha`;
    const snippet = makeSnippet(text, 'alpha beta', 10);
    expect(snippet).toContain('beta');
  });

  it('falls back to the text head when no term matches', () => {
    const text = `start ${'y'.repeat(500)}`;
    const snippet = makeSnippet(text, 'absent', 40);
    expect(snippet.startsWith('start')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('does not add ellipses when the whole text fits', () => {
    expect(makeSnippet('short text', 'text')).toBe('short text');
  });

  it('collapses whitespace runs', () => {
    expect(makeSnippet('a\n\nb   c\tneedle', 'needle', 80)).toBe('a b c needle');
  });
});
