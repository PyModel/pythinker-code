import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import { codeHighlightTheme } from '#/tui/theme/highlight-theme';

import { captureProcessWrite } from '../../../helpers/process';

const ESC = String.fromCodePoint(27);

describe('code-highlight', () => {
  it('maps known file extensions to supported highlight languages', () => {
    expect(langFromPath('src/foo.ts')).toBe('typescript');
    expect(langFromPath('src/foo.TS')).toBe('typescript');
  });

  it('treats unsupported file extensions as plain text', () => {
    expect(langFromPath('src/foo.abcxyz')).toBeUndefined();
  });

  it('does not call cli-highlight for unsupported languages', () => {
    const stderr = captureProcessWrite('stderr');
    try {
      expect(highlightLines('hello\nworld', 'abcxyz')).toEqual(['hello', 'world']);
      expect(stderr.text()).not.toContain('Could not find the language');
    } finally {
      stderr.restore();
    }
  });

  it('resets red tokens to plain styling', () => {
    for (const token of ['string', 'regexp', 'deletion'] as const) {
      expect(codeHighlightTheme[token]?.('code')).toBe('code');
    }
  });

  it('emits no red SGR for strings, regexps, and diff deletions', () => {
    const req = createRequire(import.meta.url);
    const chalkV4 = req(
      req.resolve('chalk', { paths: [dirname(req.resolve('cli-highlight'))] }),
    ) as { level: number };
    const previousLevel = chalkV4.level;
    chalkV4.level = 1;
    try {
      const javascript = highlightLines(
        "const string = 'value';\nconst regexp = /value+/g;",
        'javascript',
      ).join('\n');
      expect(javascript).not.toContain(`${ESC}[31m`);
      expect(javascript).toContain(`${ESC}[34m`);

      const diff = highlightLines('+ added\n- removed', 'diff').join('\n');
      expect(diff).not.toContain(`${ESC}[31m`);
      expect(diff).toContain(`${ESC}[32m`);
    } finally {
      chalkV4.level = previousLevel;
    }
  });
});
