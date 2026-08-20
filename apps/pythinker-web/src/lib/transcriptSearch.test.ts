import { describe, expect, it } from 'vitest';
import { collectSearchRanges } from './transcriptSearch';

function rootWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('collectSearchRanges', () => {
  it('matches case-insensitively across an inline element boundary', () => {
    const root = rootWith('<p>Hello <span style="display: inline">WORLD</span></p>');

    const ranges = collectSearchRanges(root, 'lo world');

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe('lo WORLD');
    root.remove();
  });

  it('collapses whitespace while matching', () => {
    const root = rootWith('<p>foo   bar</p>');

    const ranges = collectSearchRanges(root, 'foo bar');

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe('foo   bar');
    root.remove();
  });

  it('excludes inert and top-sentinel subtrees', () => {
    const root = rootWith(`
      <p inert>needle</p>
      <div class="top-sentinel">needle</div>
      <p>visible needle</p>
    `);

    const ranges = collectSearchRanges(root, 'needle');

    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe('needle');
    root.remove();
  });

  it('returns no ranges for an empty query', () => {
    const root = rootWith('<p>text</p>');

    expect(collectSearchRanges(root, '')).toEqual([]);
    root.remove();
  });
});
