const EXCLUDED_SUBTREE_SELECTOR = 'script, style, noscript, template, [inert], .top-sentinel';
const SEARCH_HIGHLIGHT = 'pythinker-transcript-search';
const CURRENT_SEARCH_HIGHLIGHT = 'pythinker-transcript-search-current';
const MAX_MATCHES = 1000;

type WhitespaceMode = 'preserve' | 'pre-line' | 'collapse';

interface TextSegment {
  text: string;
  gapBefore: boolean;
  node: Text;
  block: Element;
  whitespaceMap: number[];
}

interface FoldedText {
  folded: string;
  map: Array<{ start: number; length: number }>;
}

interface SegmentMatch {
  startSegment: number;
  startOffset: number;
  endSegment: number;
  endOffset: number;
}

function whitespaceMode(whiteSpace: string): WhitespaceMode {
  if (whiteSpace === 'pre' || whiteSpace === 'pre-wrap' || whiteSpace === 'break-spaces') {
    return 'preserve';
  }
  return whiteSpace === 'pre-line' ? 'pre-line' : 'collapse';
}

function collapseText(text: string, mode: WhitespaceMode): { text: string; map: number[] } {
  if (mode === 'preserve') {
    return { text, map: Array.from({ length: text.length }, (_, index) => index) };
  }
  const collapsible = mode === 'collapse' ? /[\t\n\f\r ]/ : /[\t ]/;
  let collapsed = '';
  const map: number[] = [];
  let inWhitespace = false;
  for (let index = 0; index < text.length; index += 1) {
    if (collapsible.test(text[index]!)) {
      if (!inWhitespace) {
        collapsed += ' ';
        map.push(index);
        inWhitespace = true;
      }
    } else {
      collapsed += text[index];
      map.push(index);
      inWhitespace = false;
    }
  }
  return { text: collapsed, map };
}

function foldText(text: string): FoldedText {
  let folded = '';
  const map: FoldedText['map'] = [];
  let sourceOffset = 0;
  for (const character of text) {
    const value = character.toLowerCase();
    folded += value;
    for (let index = 0; index < value.length; index += 1) {
      map.push({ start: sourceOffset, length: character.length });
    }
    sourceOffset += character.length;
  }
  return { folded, map };
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function queryPattern(query: string): string | null {
  const parts: string[] = [];
  let offset = 0;
  while (offset < query.length) {
    const whitespace = /^\s+/.exec(query.slice(offset));
    if (whitespace) {
      parts.push('\\s+');
      offset += whitespace[0].length;
      continue;
    }
    const text = /^[^\s]+/.exec(query.slice(offset));
    if (!text) break;
    parts.push(text[0].replaceAll(REGEXP_SPECIAL, '\\$&'));
    offset += text[0].length;
  }
  return parts.length === 0 ? null : parts.join('');
}

function* matchSegments(segments: TextSegment[], query: string): Generator<SegmentMatch> {
  if (query.length === 0 || segments.length === 0) return;
  const foldedSegments = segments.map((segment) => foldText(segment.text));
  const segmentOffsets: number[] = [];
  let text = '';
  for (let index = 0; index < segments.length; index += 1) {
    if (index > 0 && segments[index]!.gapBefore) text += '\0';
    segmentOffsets[index] = text.length;
    text += foldedSegments[index]!.folded;
  }
  const pattern = queryPattern(foldText(query).folded);
  if (pattern === null) return;
  const regexp = new RegExp(pattern, 'g');

  function segmentAt(offset: number): number {
    let low = 0;
    let high = segmentOffsets.length - 1;
    let result = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (segmentOffsets[middle]! <= offset) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  }

  let previous: SegmentMatch | undefined;
  for (;;) {
    const match = regexp.exec(text);
    if (match === null) return;
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length - 1;
    const startSegment = segmentAt(startIndex);
    const endSegment = segmentAt(endIndex);
    const start = foldedSegments[startSegment]!.map[startIndex - segmentOffsets[startSegment]!]!;
    const end = foldedSegments[endSegment]!.map[endIndex - segmentOffsets[endSegment]!]!;
    const current = {
      startSegment,
      startOffset: start.start,
      endSegment,
      endOffset: end.start + end.length,
    };
    if (
      previous?.startSegment !== current.startSegment ||
      previous.startOffset !== current.startOffset ||
      previous.endSegment !== current.endSegment ||
      previous.endOffset !== current.endOffset
    ) {
      previous = current;
      yield current;
    }
  }
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY',
  'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
const INLINE_DISPLAYS = new Set([
  'inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents', 'ruby',
]);

function isBlock(element: Element, cache: WeakMap<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const block = BLOCK_TAGS.has(element.tagName) || !INLINE_DISPLAYS.has(getComputedStyle(element).display);
  cache.set(element, block);
  return block;
}

function blockAncestor(node: Node, root: Element, cache: WeakMap<Element, boolean>): Element {
  let element = node.parentElement;
  while (element !== null && element !== root && !isBlock(element, cache)) {
    element = element.parentElement;
  }
  return element ?? root;
}

function collectSegments(root: Element): TextSegment[] {
  const document = root.ownerDocument;
  const nodeFilter = document.defaultView?.NodeFilter ?? NodeFilter;
  const walker = document.createTreeWalker(
    root,
    nodeFilter.SHOW_ELEMENT | nodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return nodeFilter.FILTER_ACCEPT;
        const element = node as Element;
        if (element.matches(EXCLUDED_SUBTREE_SELECTOR)) return nodeFilter.FILTER_REJECT;
        if (element.matches('br, hr, wbr') && !element.closest(EXCLUDED_SUBTREE_SELECTOR)) {
          return nodeFilter.FILTER_ACCEPT;
        }
        return nodeFilter.FILTER_SKIP;
      },
    },
  );
  const blockCache = new WeakMap<Element, boolean>();
  const whitespaceCache = new WeakMap<Element, WhitespaceMode>();
  const segments: TextSegment[] = [];
  let gapBefore = false;

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      gapBefore = true;
      continue;
    }
    const value = node.nodeValue ?? '';
    if (value.length === 0) continue;
    const parent = node.parentElement;
    if (parent === null) continue;
    let mode = whitespaceCache.get(parent);
    if (mode === undefined) {
      mode = whitespaceMode(getComputedStyle(parent).whiteSpace);
      whitespaceCache.set(parent, mode);
    }
    let { text, map } = collapseText(value, mode);
    if (text.length === 0) continue;
    const block = blockAncestor(node, root, blockCache);
    const previous = segments.at(-1);
    const separated = gapBefore || previous === undefined || previous.block !== block;
    if (!separated && previous.text.endsWith(' ') && text.startsWith(' ')) {
      text = text.slice(1);
      map = map.slice(1);
      if (text.length === 0) continue;
    }
    segments.push({ text, gapBefore: separated, node: node as Text, block, whitespaceMap: map });
    gapBefore = false;
  }
  return segments;
}

export function collectSearchRanges(root: Element, query: string): Range[] {
  if (query.length === 0) return [];
  const segments = collectSegments(root);
  const ranges: Range[] = [];
  for (const match of matchSegments(segments, query)) {
    const start = segments[match.startSegment]!;
    const end = segments[match.endSegment]!;
    const range = root.ownerDocument.createRange();
    range.setStart(start.node, start.whitespaceMap[match.startOffset]!);
    range.setEnd(end.node, end.whitespaceMap[match.endOffset - 1]! + 1);
    ranges.push(range);
  }
  return ranges;
}

export function findMatches(
  root: Element,
  query: string,
  isVisible: (range: Range) => boolean = (range) => range.getClientRects().length !== 0,
): { ranges: Range[]; truncated: boolean } {
  const ranges: Range[] = [];
  for (const range of collectSearchRanges(root, query)) {
    if (!isVisible(range)) continue;
    if (ranges.length >= MAX_MATCHES) return { ranges, truncated: true };
    ranges.push(range);
  }
  return { ranges, truncated: false };
}

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
}

function highlights(): HighlightRegistry | null {
  return (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights ?? null;
}

export function setSearchHighlights(ranges: Range[], currentIndex: number): void {
  const registry = highlights();
  const HighlightConstructor = globalThis.Highlight;
  if (!registry || !HighlightConstructor) return;
  if (ranges.length === 0) {
    clearSearchHighlights();
    return;
  }
  const matches = new HighlightConstructor();
  for (const range of ranges) matches.add(range);
  registry.set(SEARCH_HIGHLIGHT, matches);
  const current = ranges[currentIndex];
  if (current) {
    const active = new HighlightConstructor();
    active.add(current);
    registry.set(CURRENT_SEARCH_HIGHLIGHT, active);
  } else {
    registry.delete(CURRENT_SEARCH_HIGHLIGHT);
  }
}

export function clearSearchHighlights(): void {
  const registry = highlights();
  registry?.delete(SEARCH_HIGHLIGHT);
  registry?.delete(CURRENT_SEARCH_HIGHLIGHT);
}
