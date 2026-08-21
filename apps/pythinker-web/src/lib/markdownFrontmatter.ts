// apps/pythinker-web/src/lib/markdownFrontmatter.ts
// YAML frontmatter splitter, ported from the reference web UI (bundle `zBe`):
// a leading `---` line, a `---` closing line, and the block between them is
// rendered as a `<pre class="md-frontmatter">` before the body. Anything
// else (including an immediate `---\n---`) renders as normal markdown.

export interface FrontmatterSplit {
  frontmatter: string | null;
  body: string;
}

const OPEN_RE = /^---[ \t]*(?:\r\n|\n)/;
const CLOSE_RE = /^---[ \t]*$/;

export function splitFrontmatter(text: string): FrontmatterSplit {
  const open = OPEN_RE.exec(text);
  if (open === null) return { frontmatter: null, body: text };

  let lineStart = open[0].length;
  const bodyStart = lineStart;
  for (; lineStart <= text.length; ) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    let line = text.slice(lineStart, lineEnd);
    if (line.endsWith('\r')) line = line.slice(0, -1);

    if (CLOSE_RE.test(line)) {
      const frontmatter = text.slice(bodyStart, lineStart);
      if (frontmatter === '') return { frontmatter: null, body: text };
      const body = lineEnd < text.length ? text.slice(lineEnd + 1) : '';
      return { frontmatter, body };
    }
    if (lineEnd === text.length) break;
    lineStart = lineEnd + 1;
  }
  return { frontmatter: null, body: text };
}