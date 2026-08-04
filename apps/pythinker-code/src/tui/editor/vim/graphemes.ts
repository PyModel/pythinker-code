/**
 * Grapheme-cluster text helpers for the Vim engine.
 *
 * The engine tracks cursor columns and edit ranges in grapheme units (a user
 * perceives a combining sequence or emoji ZWJ cluster as one character),
 * while pi-tui and raw strings work in UTF-16 offsets. `Intl.Segmenter` is
 * used instead of `Array.from` so that combining marks, flags, and ZWJ emoji
 * are never split.
 */
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

function clamp(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), maximum));
}

/** Splits a string into its grapheme clusters. */
export function graphemes(value: string): readonly string[] {
  return Array.from(
    graphemeSegmenter.segment(value),
    ({ segment }) => segment,
  );
}

/** Counts grapheme clusters without materializing the split array. */
export function graphemeLength(value: string): number {
  let length = 0;
  for (const _segment of graphemeSegmenter.segment(value)) {
    length += 1;
  }
  return length;
}

/** True when `value` is exactly one grapheme cluster (possibly multi-codepoint). */
export function isSingleGrapheme(value: string): boolean {
  if (value.length === 0) return false;
  const segments = graphemeSegmenter.segment(value)[Symbol.iterator]();
  return !segments.next().done && segments.next().done === true;
}

/** Converts a UTF-16 offset into a grapheme column, clamped to the string. */
export function graphemeColumnAtUtf16Offset(
  value: string,
  offset: number,
): number {
  const target = clamp(offset, value.length);
  let column = 0;
  for (const { index, segment } of graphemeSegmenter.segment(value)) {
    if (index + segment.length > target) break;
    column += 1;
  }
  return column;
}

/** Converts a grapheme column into the UTF-16 offset of that cluster's start. */
export function utf16OffsetAtGraphemeColumn(
  value: string,
  column: number,
): number {
  const target = Math.max(0, Math.trunc(Number.isFinite(column) ? column : 0));
  let currentColumn = 0;
  for (const { index } of graphemeSegmenter.segment(value)) {
    if (currentColumn >= target) return index;
    currentColumn += 1;
  }
  return value.length;
}
