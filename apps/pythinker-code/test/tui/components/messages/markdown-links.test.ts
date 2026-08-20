import {
  Markdown,
  resetCapabilitiesCache,
  setCapabilities,
  type MarkdownTheme,
} from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it } from 'vitest';

const plainTheme: MarkdownTheme = {
  heading: (text) => text,
  link: (text) => text,
  linkUrl: (text) => text,
  code: (text) => text,
  codeBlock: (text) => text,
  codeBlockBorder: (text) => text,
  quote: (text) => text,
  quoteBorder: (text) => text,
  hr: (text) => text,
  listBullet: (text) => text,
  bold: (text) => text,
  italic: (text) => text,
  strikethrough: (text) => text,
  underline: (text) => text,
};

function render(text: string): string {
  setCapabilities({ images: null, trueColor: false, hyperlinks: true });
  return new Markdown(text, 0, 0, plainTheme).render(100).join('');
}

describe('Markdown bare links', () => {
  afterEach(resetCapabilitiesCache);

  it('stops at CJK punctuation while keeping valid CJK URL paths', () => {
    const wrapped = render('See https://example.com/item/232\uFF08local notes\uFF09');
    expect(wrapped).toContain('\u001B]8;;https://example.com/item/232\u001B\\');
    expect(wrapped).not.toMatch(/\u001B\]8;;[^\u001B]*\uFF08/u);

    const balanced = render(
      'See https://example.com/wiki/\u4E2D\u56FD\uFF08\u5317\u4EAC\uFF0C1949\u5E74\uFF09 for details',
    );
    expect(balanced).toContain(
      '\u001B]8;;https://example.com/wiki/\u4E2D\u56FD\uFF08\u5317\u4EAC\uFF0C1949\u5E74\uFF09\u001B\\',
    );
  });
});
