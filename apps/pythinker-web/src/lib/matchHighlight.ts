// apps/pythinker-web/src/lib/matchHighlight.ts
// Pure TS — no Vue, no side effects. Match highlighting for the composer's
// @-mention and /-command menus.
//
// Two position models are supported:
//   - Mention menus highlight from *character positions*: `matchPositions` is
//     the index of every matching character (contiguous runs collapse into one
//     highlighted span). Positions are relative to the item's searchable text
//     (for files: the full path; for skills: the name).
//   - The slash menu highlights from *ranges*: `[start, end)` pairs per field
//     (name / description), optionally passed in by the caller or computed
//     locally from the typed query.

export interface HighlightPiece {
  text: string;
  hit: boolean;
}

/**
 * Build a lowercase map for `text`: `lower` is
 * the case-folded string, `map` translates a lower-string index back to the
 * original string index. Handles characters whose lowercase form is longer
 * than the original (e.g. `İ` → `i̇`).
 */
export function lowerCaseMap(text: string): { lower: string; map: number[] } {
  const lower = text.toLowerCase();
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const foldedLength = ch.toLowerCase().length;
    for (let r = 0; r < foldedLength; r++) map.push(i + Math.min(r, ch.length - 1));
    i += ch.length;
  }
  return { lower, map };
}

/**
 * Collect the character positions of every (case-insensitive) occurrence of
 * `query` in `text`. Returns [] for an empty query or no match. Positions are
 * original-string indices, so contiguous hits render as one highlighted span.
 */
export function matchPositions(query: string, text: string): number[] {
  if (!query) return [];
  const { lower, map } = lowerCaseMap(text);
  const q = query.toLowerCase();
  const positions: number[] = [];
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    for (let i = 0; i < q.length; i++) positions.push(map[idx + i] ?? idx + i);
    idx = lower.indexOf(q, idx + 1);
  }
  return positions;
}

/**
 * Split `text` into highlighted/non-highlighted pieces from `positions` —
 * indices in the original text. `offset` is
 * subtracted from each position before clamping (used when the positions are
 * relative to a longer string, e.g. a file name inside its path).
 */
export function splitHits(text: string, positions: number[] | undefined, offset = 0): HighlightPiece[] {
  if (positions === undefined || positions.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }
  const set = new Set<number>();
  for (const p of positions) {
    const i = p - offset;
    if (i >= 0 && i < text.length) set.add(i);
  }
  if (set.size === 0) return [{ text, hit: false }];
  const pieces: HighlightPiece[] = [];
  let start = 0;
  let hit = set.has(0);
  for (let i = 1; i < text.length; i++) {
    const next = set.has(i);
    if (next !== hit) {
      pieces.push({ text: text.slice(start, i), hit });
      start = i;
      hit = next;
    }
  }
  pieces.push({ text: text.slice(start), hit });
  return pieces;
}

/** Merge overlapping/adjacent `[start, end)` ranges. */
export function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range] as [number, number]);
  }
  return merged;
}

/**
 * Split `text` into highlighted/non-highlighted pieces from `[start, end)`
 * ranges. Ranges are clamped to
 * the text length; overlapping ranges are merged first.
 */
export function splitByRanges(text: string, ranges?: Array<[number, number]>): HighlightPiece[] {
  if (!ranges || ranges.length === 0 || text.length === 0) {
    return [{ text, hit: false }];
  }
  const pieces: HighlightPiece[] = [];
  let cursor = 0;
  for (const [start, end] of mergeRanges(ranges)) {
    const from = Math.max(0, Math.min(start, text.length));
    const to = Math.max(from, Math.min(end, text.length));
    if (to <= from) continue; // skip empty/clamped-away ranges
    if (from > cursor) pieces.push({ text: text.slice(cursor, from), hit: false });
    pieces.push({ text: text.slice(from, to), hit: true });
    cursor = to;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), hit: false });
  return pieces.length > 0 ? pieces : [{ text, hit: false }];
}

/**
 * First contiguous occurrence of `query` in `text` (case-insensitive), as a
 * `[start, end)` range.
 */
function contiguousRange(text: string, query: string): [number, number] | undefined {
  const idx = text.toLowerCase().indexOf(query);
  return idx < 0 ? undefined : [idx, idx + query.length];
}

/**
 * First subsequence occurrence of `query` in `text` (case-insensitive, chars
 * in order but not necessarily contiguous): a range covering the first
 * matched char through the last one.
 */
function subsequenceRange(text: string, query: string): [number, number] | undefined {
  const lower = text.toLowerCase();
  let first = -1;
  let last = -1;
  let i = 0;
  for (let r = 0; r < lower.length && i < query.length; r++) {
    if (lower[r] === query[i]) {
      if (i === 0) first = r;
      last = r;
      i++;
    }
  }
  return i === query.length ? [first, last + 1] : undefined;
}

/**
 * Compute the highlight ranges for a slash item from the typed `query`
 * (no pinyin path — this app is
 * English-only). Name matches fall back to subsequence; the description only
 * highlights contiguous matches.
 */
export function computeSlashRanges(
  query: string,
  name: string,
  desc: string,
): { name?: Array<[number, number]>; desc?: Array<[number, number]> } {
  const q = query.trim().replace(/^\//, '').toLowerCase();
  if (!q) return {};
  const nameRange = contiguousRange(name, q) ?? subsequenceRange(name, q);
  const descRange = contiguousRange(desc, q);
  return {
    name: nameRange ? [nameRange] : undefined,
    desc: descRange ? [descRange] : undefined,
  };
}