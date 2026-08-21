// apps/pythinker-web/src/lib/markdownFrontmatter.test.ts
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from './markdownFrontmatter';

describe('splitFrontmatter', () => {
  it('splits a leading --- block from the body', () => {
    // The block keeps its last line's EOL, mirroring the reference splitter.
    const split = splitFrontmatter('---\nauthor: Ada\n---\n\nBody text');
    expect(split.frontmatter).toBe('author: Ada\n');
    expect(split.body).toBe('\nBody text');
  });

  it('keeps the body when there is no frontmatter', () => {
    expect(splitFrontmatter('plain text')).toEqual({ frontmatter: null, body: 'plain text' });
    expect(splitFrontmatter('a\n---\nb')).toEqual({ frontmatter: null, body: 'a\n---\nb' });
  });

  it('requires a closing --- line', () => {
    expect(splitFrontmatter('---\nnever closes')).toEqual({ frontmatter: null, body: '---\nnever closes' });
  });

  it('rejects an empty frontmatter block', () => {
    expect(splitFrontmatter('---\n---\nbody')).toEqual({ frontmatter: null, body: '---\n---\nbody' });
  });

  it('accepts trailing spaces/tabs on the closing fence and CRLF newlines', () => {
    const crlf = splitFrontmatter('---\r\na: 1\r\n---  \r\nbody');
    expect(crlf.frontmatter).toBe('a: 1\r\n');
    expect(crlf.body).toBe('body');
  });
});