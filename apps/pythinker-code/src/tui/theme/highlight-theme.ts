/**
 * cli-highlight's default theme paints string, regexp, and deletion tokens
 * red. Reset those token classes to plain text so ordinary code never inherits
 * the TUI's error color.
 */

import { plain, type Theme } from 'cli-highlight';

export const codeHighlightTheme: Theme = {
  string: plain,
  regexp: plain,
  deletion: plain,
};
