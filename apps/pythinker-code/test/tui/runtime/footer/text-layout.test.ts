import {
  truncateToWidth as piTruncateToWidth,
  visibleWidth as piVisibleWidth,
} from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';

import {
  truncateToWidth,
  visibleWidth,
} from '#/tui/runtime/footer/text-layout';

const ELLIPSIS = '…';

const DISPLAY_CASES = [
  { name: 'ascii', value: 'hello world', width: 11 },
  { name: 'emoji-sequence', value: '😀😃😄😆', width: 8 },
  { name: 'emoji-mixed', value: 'hello😀😃test', width: 13 },
  { name: 'emoji-simple', value: '😀', width: 2 },
  { name: 'emoji-zwj-family', value: '👨‍👩‍👧‍👦', width: 2 },
  { name: 'emoji-skin-tone', value: '👍🏽', width: 2 },
  { name: 'flag-us', value: '🇺🇸', width: 2 },
  { name: 'combining-accent', value: 'e\u0301', width: 1 },
  {
    name: 'ansi-colored',
    value: '\u001B[31mred\u001B[39m',
    width: 3,
  },
  { name: 'ansi-wide', value: '\u001B[32m😀😃\u001B[39m', width: 4 },
  { name: 'box-drawing', value: '┌──┐', width: 4 },
  { name: 'latin-accent', value: 'café', width: 4 },
  { name: 'tab', value: 'a\tb', width: 5 },
  { name: 'tab-only', value: '\t', width: 3 },
  { name: 'tab-after-two', value: 'ab\tc', width: 6 },
  { name: 'tab-after-three', value: 'abc\td', width: 7 },
  { name: 'tab-after-four', value: 'abcd\te', width: 8 },
] as const;

const OSC_BEL = '\u001B]0;title\u0007';
const OSC_ST = '\u001B]8;;https://example.test\u001B\\';
const OSC_CLOSE = '\u001B]8;;\u001B\\';

describe('OpenTUI text layout parity', () => {
  // pi-tui is the parity oracle, even where its behavior is arguably not
  // abstractly correct: changing shipping layout during the cutover is worse.
  describe.each(DISPLAY_CASES)('$name', ({ value }) => {
    it('matches pi-tui display width', () => {
      expect(visibleWidth(value)).toBe(piVisibleWidth(value));
    });

    it('matches pi-tui truncated display width', () => {
      const oracleWidth = piVisibleWidth(value);
      const widths = new Set([
        0,
        1,
        Math.max(1, oracleWidth - 1),
        oracleWidth,
        oracleWidth + 1,
      ]);

      for (const width of widths) {
        expect(piVisibleWidth(truncateToWidth(value, width))).toBe(
          piVisibleWidth(piTruncateToWidth(value, width, ELLIPSIS)),
        );
      }
    });
  });

  it.each([
    {
      name: 'ANSI-wrapped text where a code-unit slice would cut an escape',
      value: '\u001B[31mred\u001B[39m',
      width: 2,
    },
    {
      name: 'ANSI-wrapped text cut before a wide grapheme',
      value: '\u001B[32m😀😃😄\u001B[39m',
      width: 4,
    },
    {
      name: 'pure CSI and OSC escapes',
      value: `\u001B[31m\u001B[39m${OSC_BEL}${OSC_ST}${OSC_CLOSE}`,
      width: 1,
    },
    { name: 'empty string at width zero', value: '', width: 0 },
    { name: 'empty string at width one', value: '', width: 1 },
  ])(
    'matches pi-tui truncation byte-for-byte for $name',
    ({ value, width }: Readonly<{ value: string; width: number }>) => {
      expect(truncateToWidth(value, width)).toBe(
        piTruncateToWidth(value, width, ELLIPSIS),
      );
    },
  );
});

describe('display-width table', () => {
  it.each(DISPLAY_CASES)(
    'measures $name as $width terminal cells',
    ({ value, width }) => {
      expect(visibleWidth(value)).toBe(width);
    },
  );

  it.each([
    { name: 'OSC terminated by BEL', value: `${OSC_BEL}link`, width: 4 },
    {
      name: 'OSC terminated by string terminator',
      value: `${OSC_ST}link${OSC_CLOSE}`,
      width: 4,
    },
    {
      name: 'pure escapes',
      value: `\u001B[31m\u001B[39m${OSC_BEL}${OSC_ST}${OSC_CLOSE}`,
      width: 0,
    },
  ])(
    'measures $name as $width terminal cells',
    ({ value, width }: Readonly<{ value: string; width: number }>) => {
      expect(visibleWidth(value)).toBe(width);
    },
  );
});

describe('visible-width memo', () => {
  it('returns the same result for cached and uncached calls', () => {
    const value = 'memo-👨‍👩‍👧‍👦-\u001B[31mred\u001B[39m';

    expect(visibleWidth(value)).toBe(11);
    expect(visibleWidth(value)).toBe(11);
  });

  it('does not change results when the cache cap is exceeded', () => {
    const retainedValue = 'cache-cap-😀😃';
    expect(visibleWidth(retainedValue)).toBe(14);

    for (let index = 0; index <= 1_000; index += 1) {
      const value = `cache-entry-${String(index)}-👍🏽`;
      expect(visibleWidth(value)).toBe(
        `cache-entry-${String(index)}-`.length + 2,
      );
    }

    expect(visibleWidth(retainedValue)).toBe(14);
  });
});
